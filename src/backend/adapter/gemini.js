/**
 * @fileoverview Gemini（消费者版）适配器
 */

import {
    sleep,
    safeClick,
    uploadFilesViaChooser
} from '../engine/utils.js';
import {
    fillPrompt,
    normalizePageError,
    normalizeHttpError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck,
    waitApiResponse
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://gemini.google.com/app?hl=en';


/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID (此适配器未使用)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;
    const inputLocator = page.getByRole('textbox');
    const sendBtnLocator = page.getByRole('button', { name: 'Send message' });

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        await waitForInput(page, inputLocator, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片 (使用 filechooser 事件，因为 Firefox 不会创建 DOM input 元素)
        if (imgPaths && imgPaths.length > 0) {
            // 点击加号按钮打开菜单
            logger.debug('适配器', '点击加号按钮...', meta);
            const uploadMenuBtn = page.getByRole('button', { name: 'Open upload file menu' });
            await safeClick(page, uploadMenuBtn, { bias: 'button' });
            await sleep(500, 1000);

            // 使用公共函数上传文件
            const uploadFilesBtn = page.getByRole('button', { name: /Upload files/ });
            await uploadFilesViaChooser(page, uploadFilesBtn, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    return response.status() === 200 &&
                        url.includes('google.com/upload/') &&
                        url.includes('upload_id=');
                }
            });

            await sleep(1000, 2000);
        }

        // 3. 填写提示词
        await safeClick(page, inputLocator, { bias: 'input' });
        await fillPrompt(page, inputLocator, prompt, meta);
        await sleep(500, 1000);

        // 4. 点击 Tools 按钮启用图片生成
        logger.debug('适配器', '点击 Tools 按钮...', meta);
        const toolsBtn = page.getByRole('button', { name: 'Tools' });
        await safeClick(page, toolsBtn, { bias: 'button' });
        await sleep(500, 1000);

        // 5. 点击 Create images 按钮
        logger.debug('适配器', '点击 Create images 按钮...', meta);
        const createImagesBtn = page.getByRole('button', { name: 'Create images' });
        await safeClick(page, createImagesBtn, { bias: 'button' });
        await sleep(500, 1000);

        // 6. 点击发送
        logger.debug('适配器', '点击发送...', meta);
        await safeClick(page, sendBtnLocator, { bias: 'button' });

        logger.info('适配器', '等待生成结果...', meta);

        // 7. 等待 StreamGenerate API
        let streamApiResponse;
        try {
            streamApiResponse = await waitApiResponse(page, {
                urlMatch: 'assistant.lamda.BardFrontendService/StreamGenerate',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 检查 HTTP 错误
        const httpError = normalizeHttpError(streamApiResponse);
        if (httpError) {
            logger.error('适配器', `API 返回错误: ${httpError.error}`, meta);
            return { error: `API 返回错误: ${httpError.error}` };
        }

        logger.info('适配器', '生成请求成功，等待图片...', meta);

        // 8. 等待图片响应
        let imageResponse;
        try {
            imageResponse = await waitApiResponse(page, {
                urlMatch: 'googleusercontent.com/rd-gg-dl',
                urlContains: '=s1024-rj',
                method: 'GET',
                timeout: 60000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 获取图片数据
        const buffer = await imageResponse.body();
        const base64 = buffer.toString('base64');
        const contentType = imageResponse.headers()['content-type'] || 'image/jpeg';
        const imageData = `data:${contentType};base64,${base64}`;

        logger.info('适配器', '已获取图片，任务完成', meta);
        return { image: imageData };

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

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'gemini',
    displayName: 'Gemini (Consumer)',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'gemini-3-pro-image-preview', imagePolicy: 'optional' }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心生图方法
    generate
};