import { initBrowserBase } from '../../browser/launcher.js';
import {
    sleep,
    safeClick,
    pasteImages
} from '../../browser/utils.js';
import {
    fillPrompt,
    submit,
    normalizePageError,
    normalizeHttpError,
    waitApiResponse,
    moveMouseAway
} from '../utils.js';
import { logger } from '../../utils/logger.js';

// Gemini Biz 输入框选择器
const INPUT_SELECTOR = 'ucs-prosemirror-editor .ProseMirror';

/**
 * 处理账户选择页面跳转
 * @param {import('puppeteer').Page} page
 * @param {string} targetUrl - 目标 URL，用于判断跳转完成
 * @returns {Promise<boolean>} 是否处理了跳转
 */
let isHandlingAuth = false;

/** 等待登录处理完成 */
async function waitForAuthComplete() {
    while (isHandlingAuth) {
        await sleep(500, 1000);
    }
}

async function handleAccountChooser(page) {
    // 防止重复处理
    if (isHandlingAuth) return false;

    try {
        const currentUrl = page.url();
        if (currentUrl.includes('auth.business.gemini.google/account-chooser')) {
            isHandlingAuth = true;
            logger.info('适配器', '[登录器] 检测到账户选择页面，尝试自动确认...');

            // 尝试查找提交按钮 (通常是标准的 button[type="submit"])
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) {
                // 确保按钮在可视区域
                await submitBtn.scrollIntoViewIfNeeded();
                await sleep(300, 500);

                // 使用 safeClick 模拟人类点击行为
                logger.info('适配器', '[登录器] 正在点击确认按钮...');
                await safeClick(page, submitBtn, { bias: 'button' });

                // 点击后等待跳转回目标页面
                logger.info('适配器', '[登录器] 等待跳转回目标页面...');
                try {
                    await page.waitForFunction(() => {
                        const href = window.location.href;
                        return !href.includes('accounts.google.com') &&
                            !href.includes('auth.business.gemini.google') &&
                            href.includes('business.gemini.google');
                    }, { timeout: 60000, polling: 1000 });

                    logger.info('适配器', `[登录器] 已跳转回目标页面`);
                } catch (timeoutErr) {
                    const finalUrl = page.url();
                    logger.warn('适配器', `[登录器] 等待跳转回目标页面超时，尝试继续... 当前URL: ${finalUrl}`);
                }

                // 额外缓冲时间，确保页面完全加载
                await sleep(2000, 3000);
                isHandlingAuth = false;
                return true;
            } else {
                // 按钮还没加载出来，保持锁，等待下次检查
                // 不要释放 isHandlingAuth，让全局监听器下次再试
                logger.debug('适配器', '[登录器] 按钮尚未加载，等待中...');
                await sleep(500, 1000);
                isHandlingAuth = false; // 释放锁让下次尝试
                return true; // 返回 true 表示"仍在处理中"
            }
        }
    } catch (err) {
        logger.warn('适配器', `[登录器] 处理账户选择页面失败: ${err.message}`);
        isHandlingAuth = false;
    }
    return false;
}

/**
 * 等待输入框出现，同时自动处理账户选择页面跳转
 * 
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {object} [options={}] - 选项
 * @param {number} [options.timeout=60000] - 超时时间（毫秒）
 * @param {boolean} [options.click=true] - 是否点击输入框
 * @returns {Promise<void>}
 */
async function waitForInputWithAccountChooser(page, options = {}) {
    const { timeout = 60000, click = true } = options;

    // 先检查一次当前页面 (全局监听器也会处理，但显式调用确保首次检查)
    await handleAccountChooser(page);

    // 轮询等待输入框
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        // 如果正在处理跳转，暂停检测输入框
        if (isHandlingAuth) {
            await sleep(500, 1000);
            continue;
        }

        let inputHandle = null;
        try {
            inputHandle = await page.$(INPUT_SELECTOR);
        } catch (e) {
            // 忽略执行上下文销毁错误
            if (e.message.includes('Execution context was destroyed')) {
                inputHandle = null;
            } else {
                throw e;
            }
        }

        if (inputHandle) break;

        await sleep(1000, 1500);
    }

    // 最终确认输入框存在
    await page.waitForSelector(INPUT_SELECTOR, { timeout: 5000 }).catch(() => {
        throw new Error('未找到输入框 (.ProseMirror)');
    });

    if (click) {
        await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
        await sleep(500, 1000);
    }
}

/**
 * 初始化浏览器
 * @param {object} config - 配置对象
 * @param {object} [config.browser] - Browser 配置
 * @param {boolean} [config.browser.headless] - 是否开启 Headless 模式
 * @param {string} [config.browser.path] - Browser 可执行文件路径
 * @param {object} [config.browser.proxy] - 代理配置
 * @param {object} [config.backend] - 后端配置
 * @param {object} [config.backend.geminiBiz] - Gemini Biz 配置
 * @param {string} config.backend.geminiBiz.entryUrl - Gemini entry URL (必需)
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
async function initBrowser(config) {
    // 从配置读取 Gemini Biz entry URL
    const backendCfg = config.backend || {};
    const geminiCfg = backendCfg.geminiBiz || {};
    const targetUrl = geminiCfg.entryUrl;

    if (!targetUrl) {
        logger.error('适配器', '未找到GeminiBiz的入口URL, 请在配置文件中配置后再启动', meta);
        throw new Error('GeminiBiz backend missing entry URL: backend.geminiBiz.entryUrl');
    }

    // 输入框验证逻辑（使用公共函数）
    const waitInputValidator = async (page) => {
        await waitForInputWithAccountChooser(page);
    };

    const base = await initBrowserBase(config, {
        userDataDir: config.paths.userDataDir,
        targetUrl,
        productName: 'Gemini Enterprise Business',
        waitInputValidator,
        navigationHandler: handleAccountChooser
    });
    return { ...base, config };
}

/**
 * 生成图片
 * @param {object} context - 浏览器上下文 { page, client, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 参考图片路径数组
 * @param {string} modelId - 模型 ID (目前未使用,固定为 gemini-3-pro-preview)
 * @returns {Promise<{image?: string, error?: string}>} 生成结果
 */
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;

    try {
        const targetUrl = config.backend?.geminiBiz?.entryUrl;

        if (!targetUrl) {
            throw new Error('GeminiBiz backend missing entry URL');
        }

        // 开启新对话 - 先等待可能正在进行的登录处理完成
        await waitForAuthComplete();

        logger.info('适配器', '开启新会话', meta);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

        // 如果触发了账户选择跳转，等待全局处理器完成
        await waitForAuthComplete();

        // 1. 等待输入框加载（使用公共函数处理账户选择）
        logger.debug('适配器', '正在寻找输入框...', meta);
        await waitForInputWithAccountChooser(page, { click: false });
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
                    postData.streamAssistRequest.toolsSpec = { imageGenerationSpec: {} };

                    logger.info('适配器', '已拦截请求，强制使用 Nano Banana Pro', meta);
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
        logger.info('适配器', '已下载图片，任务完成', meta);
        const dataUri = `data:image/png;base64,${base64}`;
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

export { initBrowser, generateImage, handleAccountChooser };

