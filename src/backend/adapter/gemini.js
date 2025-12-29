/**
 * @fileoverview Google Gemini 图片、视频生成适配器
 */

import {
    sleep,
    safeClick,
    safeScroll,
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

        // 4. 点击 Tools 按钮启用图片/视频生成
        logger.debug('适配器', '点击 Tools 按钮...', meta);
        const toolsBtn = page.getByRole('button', { name: 'Tools' });
        await safeClick(page, toolsBtn, { bias: 'button' });
        await sleep(500, 1000);

        // 检测是否是视频模型
        const isVideoModel = modelId && modelId.startsWith('veo-');

        // 5. 点击 Create images / Create videos 按钮
        if (isVideoModel) {
            logger.debug('适配器', '点击 Create videos 按钮...', meta);
            const createVideosBtn = page.getByRole('button', { name: /^Create videos/ });

            // 检查按钮是否存在（有些账号可能没有视频生成功能）
            const btnCount = await createVideosBtn.count();
            if (btnCount === 0) {
                logger.error('适配器', '未找到 Create videos 按钮，该账号可能不支持视频生成', meta);
                return { error: '该账号不支持视频生成功能 (未找到 Create videos 按钮)' };
            }

            await safeClick(page, createVideosBtn, { bias: 'button' });
        } else {
            logger.debug('适配器', '点击 Create images 按钮...', meta);
            const createImagesBtn = page.getByRole('button', { name: 'Create images' });
            await safeClick(page, createImagesBtn, { bias: 'button' });
        }
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

        // 8. 等待图片/视频响应
        if (isVideoModel) {
            // 视频模式：等待视频下载链接
            logger.info('适配器', '生成请求成功，等待视频...', meta);

            let videoResponse;
            try {
                videoResponse = await waitApiResponse(page, {
                    urlMatch: 'contribution.usercontent.google.com/download',
                    urlContains: 'filename=video.mp4',
                    method: 'GET',
                    timeout: 180000,  // 视频生成可能更慢
                    meta
                });
            } catch (e) {
                const pageError = normalizePageError(e, meta);
                if (pageError) return pageError;
                throw e;
            }

            // 获取视频数据
            const buffer = await videoResponse.body();
            const base64 = buffer.toString('base64');
            const contentType = videoResponse.headers()['content-type'] || 'video/mp4';
            const videoData = `data:${contentType};base64,${base64}`;

            logger.info('适配器', '已获取视频，任务完成', meta);
            return { image: videoData };

        } else {
            // 图片模式
            logger.info('适配器', '生成请求成功，等待图片...', meta);

            let imageResponse;
            try {
                // 先启动监听器，再滚动触发懒加载，避免错过请求
                const imageResponsePromise = waitApiResponse(page, {
                    urlMatch: 'googleusercontent.com/rd-gg-dl',
                    urlContains: '=s1024-rj',
                    method: 'GET',
                    timeout: 60000,
                    meta
                });

                // 等待图片元素出现，然后在chat-history上滚动触发懒加载
                await page.locator('generated-image').waitFor({ state: 'attached', timeout: 120000 });
                await safeScroll(page, '#chat-history', { deltaY: 700 });
                imageResponse = await imageResponsePromise;
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

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'gemini',
    displayName: 'Google Gemini (图片、视频生成)',
    description: '使用 Google Gemini 官网生成图片和视频，支持参考图片上传。需要已登录的 Google 账户，免费账户图片生成有速率限制，视频生成必须为会员账户才可使用。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'gemini-3-pro-image-preview', imagePolicy: 'optional' },
        { id: 'veo-3.1-generate-preview', imagePolicy: 'optional' }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心生图方法
    generate
};