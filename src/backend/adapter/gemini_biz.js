/**
 * @fileoverview Gemini Business 文本生成适配器
 */

import {
    sleep,
    safeClick,
    pasteImages
} from '../engine/utils.js';
import {
    fillPrompt,
    submit,
    normalizePageError,
    normalizeHttpError,
    waitApiResponse,
    moveMouseAway,
    waitForPageAuth,
    lockPageAuth,
    unlockPageAuth,
    isPageAuthLocked,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// Gemini Biz 输入框选择器
const INPUT_SELECTOR = 'ucs-prosemirror-editor .ProseMirror';

/**
 * 处理账户选择页面跳转
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {string} targetUrl - 目标 URL，用于判断跳转完成
 * @returns {Promise<boolean>} 是否处理了跳转
 */
async function handleAccountChooser(page) {
    // 防止重复处理
    if (isPageAuthLocked(page)) return false;

    try {
        const currentUrl = page.url();
        if (currentUrl.includes('auth.business.gemini.google/account-chooser')) {
            lockPageAuth(page);
            logger.info('适配器', '[登录器(gemini_biz)] 检测到账户选择页面，尝试自动确认...');

            // 尝试查找提交按钮 (通常是标准的 button[type="submit"])
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) {
                // 确保按钮在可视区域
                await submitBtn.scrollIntoViewIfNeeded();
                await sleep(300, 500);

                // 使用 safeClick 模拟人类点击行为
                logger.info('适配器', '[登录器(gemini_biz)] 正在点击确认按钮...');
                await safeClick(page, submitBtn, { bias: 'button' });

                // 点击后等待跳转回目标页面
                logger.info('适配器', '[登录器(gemini_biz)] 等待跳转回目标页面...');
                try {
                    await page.waitForFunction(() => {
                        const href = window.location.href;
                        return !href.includes('accounts.google.com') &&
                            !href.includes('auth.business.gemini.google') &&
                            href.includes('business.gemini.google');
                    }, { timeout: 60000, polling: 1000 });

                    logger.info('适配器', `[登录器(gemini_biz)] 已跳转回目标页面`);
                } catch (timeoutErr) {
                    const finalUrl = page.url();
                    logger.warn('适配器', `[登录器(gemini_biz)] 等待跳转回目标页面超时，尝试继续... 当前URL: ${finalUrl}`);
                }

                // 额外缓冲时间，确保页面完全加载
                await sleep(2000, 3000);
                unlockPageAuth(page);
                return true;
            } else {
                // 按钮还没加载出来，保持锁，等待下次检查
                logger.debug('适配器', '[登录器(gemini_biz)] 按钮尚未加载，等待中...');
                await sleep(500, 1000);
                unlockPageAuth(page); // 释放锁让下次尝试
                return true; // 返回 true 表示"仍在处理中"
            }
        }
    } catch (err) {
        logger.warn('适配器', `[登录器(gemini_biz)] 处理账户选择页面失败: ${err.message}`);
        unlockPageAuth(page);
    }
    return false;
}


/**
 * 生成图片
 * @param {object} context - 浏览器上下文 { page, client, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 参考图片路径数组
 * @param {string} modelId - 模型 ID (目前未使用,固定为 gemini-3-pro-preview)
 * @returns {Promise<{image?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;

    try {
        // 支持新路径 adapter.gemini_biz.entryUrl，向下兼容旧路径 geminiBiz.entryUrl
        const targetUrl = config.backend?.adapter?.gemini_biz?.entryUrl || config.backend?.geminiBiz?.entryUrl;

        if (!targetUrl) {
            throw new Error('GeminiBiz backend missing entry URL');
        }

        // 开启新对话 - 先等待可能正在进行的登录处理完成
        await waitForPageAuth(page);

        logger.info('适配器', '开启新会话', meta);
        await gotoWithCheck(page, targetUrl);

        // 如果触发了账户选择跳转，等待全局处理器完成
        await waitForPageAuth(page);

        // 1. 等待输入框加载
        logger.debug('适配器', '正在寻找输入框...', meta);
        await waitForInput(page, INPUT_SELECTOR, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片 (uploadImages - 使用自定义验证器)
        if (imgPaths && imgPaths.length > 0) {
            const expectedUploads = imgPaths.length;
            let uploadedCount = 0;
            let metadataCount = 0;

            await pasteImages(page, INPUT_SELECTOR, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    if (response.status() === 200) {
                        if (url.includes('global/widgetAddContextFile')) {
                            uploadedCount++;
                            logger.debug('适配器', `图片上传进度 (Add): ${uploadedCount}/${expectedUploads}`, meta);
                            return false;
                        } else if (url.includes('global/widgetListSessionFileMetadata')) {
                            metadataCount++;
                            logger.info('适配器', `图片上传进度: ${metadataCount}/${expectedUploads}`, meta);

                            if (uploadedCount >= expectedUploads && metadataCount >= expectedUploads) {
                                return true;
                            }
                        }
                    }
                    return false;
                }
            });

            await sleep(1000, 2000);
        }

        // 3. 填写提示词 (fillPrompt)
        await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
        await fillPrompt(page, INPUT_SELECTOR, prompt, meta);
        await sleep(500, 1000);

        // 4. 设置拦截器
        logger.debug('适配器', '已启用请求拦截', meta);
        await page.unroute('**/*').catch(() => { });

        await page.route(url => url.href.includes('global/widgetStreamAssist'), async (route) => {
            const request = route.request();
            if (request.method() !== 'POST') return route.continue();

            try {
                const postData = request.postDataJSON();
                if (postData) {
                    logger.debug('适配器', '已拦截请求，正在修改...', meta);
                    if (!postData.streamAssistRequest) postData.streamAssistRequest = {};
                    if (!postData.streamAssistRequest.assistGenerationConfig) postData.streamAssistRequest.assistGenerationConfig = {};

                    // 根据模型 ID 选择 toolsSpec
                    if (modelId && modelId.startsWith('veo-')) {
                        postData.streamAssistRequest.toolsSpec = { videoGenerationSpec: {} };
                        logger.info('适配器', '已拦截请求，使用视频生成规格', meta);
                    } else {
                        postData.streamAssistRequest.toolsSpec = { imageGenerationSpec: {} };
                        logger.info('适配器', '已拦截请求，使用图片生成规格', meta);
                    }

                    await route.continue({ postData: JSON.stringify(postData) });
                    return;
                }
            } catch (e) {
                logger.error('适配器', '请求拦截处理失败', { ...meta, error: e.message });
            }
            await route.continue();
        });

        // 5. 提交 (submit - 使用公共函数)
        logger.debug('适配器', '点击发送...', meta);
        await submit(page, {
            btnSelector: 'md-icon-button.send-button.submit, button[aria-label="提交"], button[aria-label="Send"], .send-button',
            inputTarget: INPUT_SELECTOR,
            meta
        });

        logger.info('适配器', '等待生成结果中...', meta);

        // 6. 等待 API 响应
        let apiResponse;
        try {
            apiResponse = await waitApiResponse(page, {
                urlMatch: 'global/widgetStreamAssist',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 检查 API 响应状态
        const httpError = normalizeHttpError(apiResponse);
        if (httpError) {
            logger.error('适配器', `请求生成时返回错误: ${httpError.error}`, meta);
            return { error: `请求生成时返回错误: ${httpError.error}` };
        }

        // 7. 等待图片下载响应 
        logger.info('适配器', '已获取结果，正在下载图片...', meta);

        let imageResponse;
        try {
            imageResponse = await waitApiResponse(page, {
                urlMatch: 'download/v1alpha/projects',
                method: 'GET',
                timeout: 120000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) {
                if (e.name === 'TimeoutError') {
                    return { error: '已获取结果, 但图片下载时超时 (120秒)' };
                }
                return pageError;
            }
            throw e;
        }


        const base64 = await imageResponse.text();

        // 从响应头获取内容类型
        const contentType = imageResponse.headers()['x-goog-safety-content-type'] || 'image/png';
        logger.info('适配器', `已下载内容，类型: ${contentType}`, meta);

        const dataUri = `data:${contentType};base64,${base64}`;
        return { image: dataUri };


    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally {
        // 清理拦截器
        await page.unroute('**/*').catch(() => { });
        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'gemini_biz',
    displayName: 'Gemini Business (图片、视频生成)',

    // 配置表单定义
    configSchema: [
        {
            key: 'entryUrl',
            label: '入口 URL',
            type: 'string',
            required: true,
            placeholder: 'https://business.gemini.google/home/cid/8888a888-b6e0-88be-86e1-888cf3ee8cf4'
        }
    ],

    // 入口 URL (从配置读取，支持新旧路径)
    getTargetUrl(config, workerConfig) {
        return config?.backend?.adapter?.gemini_biz?.entryUrl || config?.backend?.geminiBiz?.entryUrl || null;
    },

    // 模型列表
    models: [
        { id: 'gemini-3-pro-image-preview', imagePolicy: 'optional' },
        { id: 'veo-3.1-generate-preview', imagePolicy: 'optional' },
    ],

    // 导航处理器
    navigationHandlers: [handleAccountChooser],

    // 核心生图方法
    generate
};
