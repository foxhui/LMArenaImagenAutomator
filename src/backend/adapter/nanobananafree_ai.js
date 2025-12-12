/**
 * @fileoverview NanoBananaFree AI 适配器
 * @description 通过自动化方式驱动 nanobananafree.ai 网页端生成图片，并将结果转换为统一的后端返回结构。
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
    moveMouseAway
} from '../utils.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://nanobananafree.ai/';

/**
 * 初始化浏览器
 * @param {object} config - 配置对象
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
async function initBrowser(config) {
    // NanoBananaFree AI 特定的输入框验证逻辑
    const waitInputValidator = async (page) => {
        const textareaSelector = 'textarea';
        await page.waitForSelector(textareaSelector, { timeout: 60000 });
        await safeClick(page, textareaSelector, { bias: 'input' });
        await sleep(500, 1000);
    };

    const base = await initBrowserBase(config, {
        userDataDir: config.paths.userDataDir,
        targetUrl: TARGET_URL,
        productName: 'NanoBananaFree AI',
        waitInputValidator
    });
    return { ...base, config };
}

/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, client }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组 (仅取第一张)
 * @param {string} [modelId] - 指定的模型 ID (可选，目前未使用)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, text?: string, error?: string}>} 生成结果
 */
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;
    const textareaSelector = 'textarea';

    try {
        logger.info('适配器', '开启新会话', meta);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 1. 等待输入框加载 (waitInput)
        await page.waitForSelector(textareaSelector, { timeout: 30000 });
        await sleep(1500, 2500);

        // 2. 上传图片 (uploadImages - 仅取第一张)
        if (imgPaths && imgPaths.length > 0) {
            const singleImage = [imgPaths[0]];
            if (imgPaths.length > 1) {
                logger.warn('适配器', `此后端仅支持1张图片, 已丢弃 ${imgPaths.length - 1} 张`, meta);
            }
            await pasteImages(page, textareaSelector, singleImage);
        }

        // 3. 填写提示词 (fillPrompt)
        await safeClick(page, textareaSelector, { bias: 'input' });
        await fillPrompt(page, textareaSelector, prompt, meta);

        // 4. 提交表单 (submit)
        logger.debug('适配器', '点击发送...', meta);
        await submit(page, {
            btnSelector: 'div[class*="_sendButton_"]',
            inputTarget: textareaSelector,
            meta
        });

        logger.info('适配器', '等待生成结果...', meta);

        // 5. 等待 API 响应 (waitApiResponse)
        let response;
        try {
            response = await waitApiResponse(page, {
                urlMatch: 'v1/generateContent',
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

        // 6. 解析响应结果
        // 先尝试获取响应内容用于错误解析
        let content = null;
        try {
            content = await response.text();
        } catch (e) { }

        // 检查 HTTP 错误
        const httpError = normalizeHttpError(response, content);
        if (httpError) {
            logger.error('适配器', `请求生成时返回错误: ${httpError.error}`, meta);
            return { error: `请求生成时返回错误: ${httpError.error}` };
        }

        // 解析成功响应（使用已读取的 content）
        let body;
        try {
            body = JSON.parse(content);
        } catch (e) {
            logger.error('适配器', '解析响应JSON时出错', meta);
            return { error: '解析响应JSON时出错' };
        }

        // 7. 提取 base64 图片
        const inlineData = body?.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (inlineData) {
            logger.info('适配器', '已获取生结果, 且已获取图片数据', meta);
            return { image: `data:image/png;base64,${inlineData}` };
        } else {
            logger.info('适配器', 'AI 返回非图片响应', { ...meta, preview: JSON.stringify(body).substring(0, 150) });
            return { text: JSON.stringify(body) };
        }

    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally {
        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

export { initBrowser, generateImage };
