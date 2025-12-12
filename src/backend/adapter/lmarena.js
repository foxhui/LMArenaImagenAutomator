/**
 * @fileoverview LMArena 适配器
 * @description 通过自动化方式驱动 LMArena 网页端生成图片（或解析文本），并将结果转换为统一的后端返回结构。
 */

import { initBrowserBase } from '../../browser/launcher.js';
import {
    sleep,
    safeClick,
    pasteImages
} from '../../browser/utils.js';
import {
    fillPrompt,
    submit,
    waitApiResponse,
    normalizePageError,
    normalizeHttpError,
    downloadImage,
    moveMouseAway
} from '../utils.js';
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
 * 初始化浏览器会话
 * @param {object} config - 全局配置对象
 * @returns {Promise<{browser: object, page: object, client: object}>} 初始化后的浏览器上下文
 */
async function initBrowser(config) {
    // 输入框验证逻辑
    const waitInputValidator = async (page) => {
        const textareaSelector = 'textarea';
        await page.waitForSelector(textareaSelector, { timeout: 60000 });
        await safeClick(page, textareaSelector, { bias: 'input' });
        await sleep(500, 1000);
    };

    const base = await initBrowserBase(config, {
        userDataDir: config.paths.userDataDir,
        targetUrl: TARGET_URL,
        productName: 'LMArena',
        waitInputValidator
    });
    return { ...base, config };
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
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const textareaSelector = 'textarea';

    try {
        logger.info('适配器', '开启新会话...', meta);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 1. 等待输入框加载 (waitInput)
        await page.waitForSelector(textareaSelector, { timeout: 30000 });
        await sleep(1500, 2500);

        // 2. 上传图片 (uploadImages)
        if (imgPaths && imgPaths.length > 0) {
            await pasteImages(page, textareaSelector, imgPaths);
        }

        // 3. 填写提示词 (fillPrompt)
        await safeClick(page, textareaSelector, { bias: 'input' });
        await fillPrompt(page, textareaSelector, prompt, meta);

        // 4. 配置请求拦截 (用于修改模型 ID)
        await page.unroute('**/*').catch(() => { });

        if (modelId) {
            logger.debug('适配器', `准备拦截请求`, meta);
            await page.route(url => url.href.includes('/nextjs-api/stream'), async (route) => {
                const request = route.request();
                if (request.method() !== 'POST') return route.continue();

                try {
                    const postData = request.postDataJSON();
                    if (postData && postData.modelAId) {
                        logger.info('适配器', `已拦截请求并修改模型: ${postData.modelAId} -> ${modelId}`, meta);
                        postData.modelAId = modelId;
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
            logger.info('适配器', '已获取结果，正在下载图片...', meta);
            const result = await downloadImage(img, config);
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
        if (modelId) await page.unroute('**/*').catch(() => { });

        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

export { initBrowser, generateImage };
