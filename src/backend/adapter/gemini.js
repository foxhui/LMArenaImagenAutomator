/**
 * @fileoverview Gemini（消费者版）适配器
 * @description 通过自动化方式驱动 Gemini 网页端生成图片，并将结果转换为统一的后端返回结构。
 */

import { initBrowserBase } from '../../browser/launcher.js';
import {
    sleep,
    safeClick,
    uploadFilesViaChooser
} from '../../browser/utils.js';
import {
    fillPrompt,
    normalizePageError,
    moveMouseAway
} from '../utils.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://gemini.google.com/app?hl=en';

/**
 * 初始化浏览器会话
 * @param {object} config - 全局配置对象
 * @returns {Promise<{browser: object, page: object, config: object}>}
 */
async function initBrowser(config) {
    // 输入框验证逻辑
    const waitInputValidator = async (page) => {
        await page.getByRole('textbox').waitFor({ timeout: 60000 });
        await safeClick(page, page.getByRole('textbox'), { bias: 'input' });
        await sleep(500, 1000);
    };

    const base = await initBrowserBase(config, {
        userDataDir: config.paths.userDataDir,
        targetUrl: TARGET_URL,
        productName: 'Gemini',
        waitInputValidator
    });
    return { ...base, config };
}

/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID (此适配器未使用)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, error?: string}>}
 */
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;
    const inputLocator = page.getByRole('textbox');
    const sendBtnLocator = page.getByRole('button', { name: 'Send message' });

    try {
        logger.info('适配器', '开启新会话...', meta);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 1. 等待输入框加载
        await inputLocator.waitFor({ timeout: 30000 });
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

        // 6. 设置响应监听 - 等待 StreamGenerate 成功后捕获图片
        let imageData = null;

        const imagePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('等待图片响应超时 (120秒)'));
            }, 120000);

            let streamGenerateSuccess = false;

            const onResponse = async (response) => {
                const url = response.url();

                // 先等待 StreamGenerate 成功
                if (!streamGenerateSuccess &&
                    url.includes('assistant.lamda.BardFrontendService/StreamGenerate') &&
                    response.request().method() === 'POST' &&
                    response.status() === 200) {
                    streamGenerateSuccess = true;
                    logger.info('适配器', '生成请求成功，等待图片...', meta);
                }

                // StreamGenerate 成功后，捕获图片响应
                if (streamGenerateSuccess &&
                    url.includes('googleusercontent.com/rd-gg-dl') &&
                    url.includes('=s1024-rj') &&
                    response.request().method() === 'GET' &&
                    response.status() === 200) {
                    try {
                        // 直接获取图片二进制数据
                        const buffer = await response.body();
                        const base64 = buffer.toString('base64');

                        // 根据 Content-Type 确定图片格式
                        const contentType = response.headers()['content-type'] || 'image/jpeg';
                        imageData = `data:${contentType};base64,${base64}`;

                        logger.info('适配器', '已捕获图片数据', meta);
                        cleanup();
                        resolve(imageData);
                    } catch (e) {
                        logger.warn('适配器', `捕获图片失败: ${e.message}`, meta);
                    }
                }
            };

            const cleanup = () => {
                clearTimeout(timeout);
                page.off('response', onResponse);
            };

            page.on('response', onResponse);
        });

        // 7. 点击发送
        logger.debug('适配器', '点击发送...', meta);
        await safeClick(page, sendBtnLocator, { bias: 'button' });

        logger.info('适配器', '等待生成结果...', meta);

        // 7. 等待图片响应
        const image = await imagePromise;

        if (image) {
            logger.info('适配器', '已获取图片，任务完成', meta);
            return { image };
        } else {
            return { error: '未能获取图片' };
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
