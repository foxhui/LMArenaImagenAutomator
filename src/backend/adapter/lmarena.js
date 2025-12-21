/**
 * @fileoverview LMArena 图片生成适配器
 */

import {
    sleep,
    safeClick,
    pasteImages
} from '../engine/utils.js';
import {
    fillPrompt,
    submit,
    waitApiResponse,
    normalizePageError,
    normalizeHttpError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck,
    useContextDownload
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://lmarena.ai/c/new?mode=direct&chat-modality=image';

/**
 * 从响应文本中提取图片 URL
 * @param {string} text - 响应文本内容
 * @returns {string|null} 提取到的图片 URL，如果未找到则返回 null
 */
function extractImage(text) {
    if (!text) return null;
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('a2:')) {
            try {
                const data = JSON.parse(line.substring(3));
                if (data?.[0]?.image) return data[0].image;
            } catch (e) { }
        }
    }
    return null;
}


/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, client }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 指定的模型 ID (可选)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, text?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const textareaSelector = 'textarea';

    // Worker 已验证，直接解析模型配置
    const modelConfig = manifest.models.find(m => m.id === modelId);
    const codeName = modelConfig?.codeName;

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        await waitForInput(page, textareaSelector, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片 (uploadImages)
        if (imgPaths && imgPaths.length > 0) {
            await pasteImages(page, textareaSelector, imgPaths);
        }

        // 3. 填写提示词 (fillPrompt)
        await safeClick(page, textareaSelector, { bias: 'input' });
        await fillPrompt(page, textareaSelector, prompt, meta);

        // 4. 配置请求拦截 (用于修改模型 ID 为 codeName)
        await page.unroute('**/*').catch(() => { });

        if (codeName) {
            logger.debug('适配器', `准备拦截请求`, meta);
            await page.route(url => url.href.includes('/nextjs-api/stream'), async (route) => {
                const request = route.request();
                if (request.method() !== 'POST') return route.continue();

                try {
                    const postData = request.postDataJSON();
                    if (postData && postData.modelAId) {
                        logger.info('适配器', `已拦截请求并修改模型: ${postData.modelAId} -> ${codeName}`, meta);
                        postData.modelAId = codeName;
                        await route.continue({ postData: JSON.stringify(postData) });
                        return;
                    }
                } catch (e) {
                    logger.error('适配器', '拦截处理异常', { ...meta, error: e.message });
                }
                await route.continue();
            });
        }

        // 5. 提交表单 (submit)
        logger.debug('适配器', '点击发送...', meta);
        await submit(page, {
            btnSelector: 'button[type="submit"]',
            inputTarget: textareaSelector,
            meta
        });

        logger.info('适配器', '等待生成结果...', meta);

        // 6. 等待 API 响应 (waitApiResponse)
        let response;
        try {
            response = await waitApiResponse(page, {
                urlMatch: '/nextjs-api/stream',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            // 使用公共错误处理
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 7. 解析响应结果
        const content = await response.text();

        // 8. 检查 HTTP 错误 (normalizeHttpError)
        const httpError = normalizeHttpError(response, content);
        if (httpError) {
            logger.error('适配器', `请求生成时返回错误: ${httpError.error}`, meta);
            return { error: `请求生成时返回错误: ${httpError.error}` };
        }

        // 9. 提取图片 URL
        const img = extractImage(content);
        if (img) {
            // 检查是否配置了返回 URL
            const returnUrl = config?.backend?.adapter?.lmarena?.returnUrl || false;
            if (returnUrl) {
                logger.info('适配器', '已获取结果，返回 URL', meta);
                return { image: img };
            }

            logger.info('适配器', '已获取结果，正在下载图片...', meta);
            const result = await useContextDownload(img, page);
            if (result.image) {
                logger.info('适配器', '已下载图片，任务完成', meta);
            }
            return result;
        } else {
            logger.warn('适配器', '未获得结果，响应中无图片数据', { ...meta, preview: content.substring(0, 150) });
            return { text: `未获得结果，响应中无图片数据: ${content}` };
        }

    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally {
        // 清理拦截器
        if (codeName) await page.unroute('**/*').catch(() => { });

        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'lmarena',
    displayName: 'LMArena (图片生成)',

    // 配置项模式
    configSchema: [
        {
            key: 'returnUrl',
            label: '返回图片 URL',
            type: 'boolean',
            default: false,
            note: '开启后直接返回图片 URL (但其他不支持该选项的适配器仍然会返回 Base64)'
        }
    ],

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表（从 models.js 迁移）
    models: [
        { id: 'gemini-3-pro-image-preview-2k', codeName: '019abc10-e78d-7932-b725-7f1563ed8a12', imagePolicy: 'optional' },
        { id: 'gemini-3-pro-image-preview', codeName: '019aa208-5c19-7162-ae3b-0a9ddbb1e16a', imagePolicy: 'optional' },
        { id: 'flux-2-flex', codeName: '019abed6-d96e-7a2b-bf69-198c28bef281', imagePolicy: 'optional' },
        { id: 'gemini-2.5-flash-image-preview', codeName: '0199ef2a-583f-7088-b704-b75fd169401d', imagePolicy: 'optional' },
        { id: 'hunyuan-image-3.0', codeName: '7766a45c-1b6b-4fb8-9823-2557291e1ddd', imagePolicy: 'forbidden' },
        { id: 'flux-2-pro', codeName: '019abcf4-5600-7a8b-864d-9b8ab7ab7328', imagePolicy: 'optional' },
        { id: 'seedream-4.5', codeName: '019abd43-b052-7eec-aa57-e895e45c9723', imagePolicy: 'optional' },
        { id: 'seedream-4-high-res-fal', codeName: '32974d8d-333c-4d2e-abf3-f258c0ac1310', imagePolicy: 'optional' },
        { id: 'wan2.5-t2i-preview', codeName: '019a5050-2875-78ed-ae3a-d9a51a438685', imagePolicy: 'forbidden' },
        { id: 'gpt-image-1', codeName: '6e855f13-55d7-4127-8656-9168a9f4dcc0', imagePolicy: 'optional' },
        { id: 'gpt-image-mini', codeName: '0199c238-f8ee-7f7d-afc1-7e28fcfd21cf', imagePolicy: 'optional' },
        { id: 'mai-image-1', codeName: '1b407d5c-1806-477c-90a5-e5c5a114f3bc', imagePolicy: 'forbidden' },
        { id: 'seedream-3', codeName: 'd8771262-8248-4372-90d5-eb41910db034', imagePolicy: 'forbidden' },
        { id: 'qwen-image-prompt-extend', codeName: '9fe82ee1-c84f-417f-b0e7-cab4ae4cf3f3', imagePolicy: 'forbidden' },
        { id: 'flux-1-kontext-pro', codeName: '28a8f330-3554-448c-9f32-2c0a08ec6477', imagePolicy: 'optional' },
        { id: 'imagen-3.0-generate-002', codeName: '51ad1d79-61e2-414c-99e3-faeb64bb6b1b', imagePolicy: 'forbidden' },
        { id: 'ideogram-v3-quality', codeName: '73378be5-cdba-49e7-b3d0-027949871aa6', imagePolicy: 'forbidden' },
        { id: 'photon', codeName: 'e7c9fa2d-6f5d-40eb-8305-0980b11c7cab', imagePolicy: 'forbidden' },
        { id: 'recraft-v3', codeName: 'b88d5814-1d20-49cc-9eb6-e362f5851661', imagePolicy: 'forbidden' },
        { id: 'lucid-origin', codeName: '5a3b3520-c87d-481f-953c-1364687b6e8f', imagePolicy: 'forbidden' },
        { id: 'gemini-2.0-flash-preview-image-generation', codeName: '69bbf7d4-9f44-447e-a868-abc4f7a31810', imagePolicy: 'optional' },
        { id: 'dall-e-3', codeName: 'bb97bc68-131c-4ea4-a59e-03a6252de0d2', imagePolicy: 'forbidden' },
        { id: 'flux-1-kontext-dev', codeName: 'eb90ae46-a73a-4f27-be8b-40f090592c9a', imagePolicy: 'optional' },
        { id: 'vidu-q2-image', codeName: '019adb32-afa4-749e-9992-39653b52fe13', imagePolicy: 'optional' },
        { id: 'imagen-4.0-fast-generate-001', codeName: 'f44fd4f8-af30-480f-8ce2-80b2bdfea55e', imagePolicy: 'forbidden' },
        { id: 'imagen-4.0-ultra-generate-001', codeName: '019ae6da-6438-7077-9d2d-b311a35645f8', imagePolicy: 'forbidden' },
        { id: 'flux-2-dev', codeName: '019ae6a0-4773-77d5-8ffb-cc35813e063c', imagePolicy: 'optional' },
        { id: 'imagen-4.0-generate-001', codeName: '019ae6da-6788-761a-8253-e0bb2bf2e3a9', imagePolicy: 'forbidden' },
        { id: 'wan2.5-i2i-preview', codeName: '019aeb62-c6ea-788e-88f9-19b1b48325b5', imagePolicy: 'required' },
        { id: 'hunyuan-image-2.1', codeName: 'a9a26426-5377-4efa-bef9-de71e29ad943', imagePolicy: 'forbidden' },
        { id: 'qwen-image-edit', codeName: '995cf221-af30-466d-a809-8e0985f83649', imagePolicy: 'required' },
        { id: 'reve-v1', codeName: '0199e980-ba42-737b-9436-927b6e7ca73e', imagePolicy: 'required' },
        { id: 'reve-fast-edit', codeName: '019a5675-0a56-7835-abdd-1cb9e7870afa', imagePolicy: 'required' }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心生图方法
    generate
};
