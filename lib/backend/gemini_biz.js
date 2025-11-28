import fs from 'fs';
import path from 'path';
import { initBrowserBase } from '../browser/launcher.js';
import {
    random,
    sleep,
    getRealViewport,
    clamp,
    queryDeep,
    safeClick,
    humanType,
    pasteImages
} from '../browser/utils.js';
import { logger } from '../logger.js';

// --- 配置常量 ---
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'chromeUserDataGeminiBiz');
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 查找 Shadow DOM 中的输入框
 * @param {import('puppeteer').Page} page 
 * @returns {Promise<ElementHandle|null>}
 */
async function findInput(page) {
    return await page.evaluateHandle(() => {
        function queryDeep(root, selector) {
            let found = root.querySelector(selector);
            if (found) return found;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.shadowRoot) {
                    found = queryDeep(node.shadowRoot, selector);
                    if (found) return found;
                }
            }
            return null;
        }
        const editor = queryDeep(document.body, 'ucs-prosemirror-editor');
        if (!editor) return null;
        return queryDeep(editor.shadowRoot, '.ProseMirror');
    });
}

/**
 * 初始化浏览器
 * @param {object} config - 配置对象
 * @param {object} [config.chrome] - Chrome 配置
 * @param {boolean} [config.chrome.headless] - 是否开启 Headless 模式
 * @param {string} [config.chrome.path] - Chrome 可执行文件路径
 * @param {object} [config.chrome.proxy] - 代理配置
 * @param {object} [config.backend] - 后端配置
 * @param {object} [config.backend.geminiBiz] - Gemini Biz 配置
 * @param {string} config.backend.geminiBiz.entryUrl - Gemini entry URL (必需)
 * @returns {Promise<{browser: import('puppeteer').Browser, page: import('puppeteer').Page, client: import('puppeteer').CDPSession}>}
 */
async function initBrowser(config) {
    // 从配置读取 Gemini Biz entry URL
    const backendCfg = config.backend || {};
    const geminiCfg = backendCfg.geminiBiz || {};
    const targetUrl = geminiCfg.entryUrl;

    if (!targetUrl) {
        throw new Error('GeminiBiz backend missing entry URL: backend.geminiBiz.entryUrl');
    }

    // Gemini Biz 特定的输入框验证
    const waitInputValidator = async (page) => {
        let inputHandle = null;
        let retries = 0;
        const maxRetries = 20;

        logger.info('适配器', '正在寻找输入框 (如果您需要登录，请使用登录模式)...');

        while (retries < maxRetries) {
            try {
                inputHandle = await findInput(page);
                if (inputHandle && inputHandle.asElement()) {
                    logger.info('适配器', '已找到输入框');
                    break;
                }
            } catch (err) {
                if (err.message.includes('Execution context was destroyed')) {
                    logger.info('适配器', '页面跳转中，继续等待...');
                }
            }
            await sleep(1000, 1500);
            retries++;
            if (retries % 10 === 0) logger.info('适配器', `仍在寻找输入框... (${retries}/${maxRetries})`);
        }

        if (!inputHandle || !inputHandle.asElement()) {
            logger.error('适配器', '等待超时，未找到输入框');
        }

        if (inputHandle && inputHandle.asElement()) {
            const box = await inputHandle.boundingBox();
            if (box) {
                if (page.cursor) {
                    await page.cursor.moveTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
                }
                await sleep(500, 1000);
            }
        }
    };

    return await initBrowserBase(config, {
        userDataDir: USER_DATA_DIR,
        targetUrl,
        productName: 'Gemini Enterprise Business',
        reuseExistingTab: false,
        waitInputValidator
    });
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
    const { page, client } = context;
    let fetchPausedHandler = null;

    try {
        // 获取配置 (通过闭包或全局)
        // 这里需要从 context 或其他方式获取 config
        const { loadConfig } = await import('../config.js');
        const config = loadConfig();
        const targetUrl = config.backend?.geminiBiz?.entryUrl;

        if (!targetUrl) {
            throw new Error('GeminiBiz backend missing entry URL');
        }

        // 开启新对话
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

        // 1. 查找输入框
        logger.debug('适配器', '正在寻找输入框...', meta);

        let inputHandle = await findInput(page);
        let retries = 0;
        while ((!inputHandle || !inputHandle.asElement()) && retries < 15) {
            await sleep(1000, 1500);
            inputHandle = await findInput(page);
            retries++;
        }

        if (!inputHandle || !inputHandle.asElement()) {
            throw new Error('未找到输入框 (.ProseMirror)');
        }

        // 2. 粘贴图片 (使用自定义验证器)
        if (imgPaths && imgPaths.length > 0) {
            const expectedUploads = imgPaths.length;
            let uploadedCount = 0;
            let metadataCount = 0;

            await pasteImages(page, inputHandle, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    if (response.status() === 200) {
                        if (url.includes('global/widgetAddContextFile')) {
                            uploadedCount++;
                            logger.debug('适配器', `图片上传进度 (Add): ${uploadedCount}/${expectedUploads}`, meta);
                            return false; // 未完成,继续等待
                        } else if (url.includes('global/widgetListSessionFileMetadata')) {
                            metadataCount++;
                            logger.info('适配器', `图片上传进度: ${metadataCount}/${expectedUploads}`, meta);

                            // 两个检查都满足才算完成
                            if (uploadedCount >= expectedUploads && metadataCount >= expectedUploads) {
                                return true;
                            }
                        }
                    }
                    return false;
                }
            });
            await sleep(1000, 2000); // 额外缓冲
        }

        // 3. 输入文字
        logger.info('适配器', '正在输入提示词...', meta);
        await humanType(page, inputHandle, prompt);
        await sleep(1000, 2000);

        // 4. 设置拦截器
        logger.debug('适配器', '已启用请求拦截', meta);
        await client.send('Fetch.enable', {
            patterns: [{
                urlPattern: '*global/widgetStreamAssist*',
                requestStage: 'Request'
            }]
        });

        fetchPausedHandler = async (event) => {
            const { requestId, request } = event;
            if (request.method === 'POST' && request.postData) {
                try {
                    let rawBody = request.postData;
                    let data;
                    try {
                        data = JSON.parse(rawBody);
                    } catch (e) {
                        try {
                            rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
                            data = JSON.parse(rawBody);
                        } catch (e2) { }
                    }

                    if (data) {
                        logger.debug('适配器', '已拦截请求，正在修改...', meta);
                        if (!data.streamAssistRequest) data.streamAssistRequest = {};
                        if (!data.streamAssistRequest.assistGenerationConfig) data.streamAssistRequest.assistGenerationConfig = {};
                        //data.streamAssistRequest.assistGenerationConfig.modelId = "gemini-3-pro-preview";
                        data.streamAssistRequest.toolsSpec = { imageGenerationSpec: {} };

                        const newBody = JSON.stringify(data);
                        const newBodyBase64 = Buffer.from(newBody).toString('base64');
                        logger.info('适配器', '已拦截请求，强制使用 Nano Banana Pro', meta);
                        await client.send('Fetch.continueRequest', {
                            requestId,
                            postData: newBodyBase64
                        });
                        return;
                    }
                } catch (e) {
                    logger.error('适配器', '请求拦截处理失败', { ...meta, error: e.message });
                }
            }
            try {
                await client.send('Fetch.continueRequest', { requestId });
            } catch (e) { }
        };
        client.on('Fetch.requestPaused', fetchPausedHandler);

        // 5. 点击发送
        logger.debug('适配器', '点击发送...', meta);
        const sendBtnHandle = await page.evaluateHandle(() => {
            function queryDeep(root, selector) {
                let found = root.querySelector(selector);
                if (found) return found;
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
                while (walker.nextNode()) {
                    const node = walker.currentNode;
                    if (node.shadowRoot) {
                        found = queryDeep(node.shadowRoot, selector);
                        if (found) return found;
                    }
                }
                return null;
            }
            // 精准匹配发送按钮
            return queryDeep(document.body, 'md-icon-button.send-button.submit, button[aria-label="提交"], button[aria-label="Send"], .send-button');
        });

        if (sendBtnHandle && sendBtnHandle.asElement()) {
            await safeClick(page, sendBtnHandle);
        } else {
            logger.warn('适配器', '未找到发送按钮，尝试回车提交', meta);
            await inputHandle.focus();
            await page.keyboard.press('Enter');
        }

        logger.info('适配器', '等待生成结果中...', meta);

        // 6. 等待结果
        const result = await new Promise((resolve, reject) => {
            const requestMethods = new Map(); // Store request methods by requestId

            const cleanup = () => {
                client.off('Network.requestWillBeSent', onRequest);
                client.off('Network.responseReceived', onRes);
                client.off('Network.loadingFinished', onLoad);
                if (fetchPausedHandler) {
                    client.off('Fetch.requestPaused', fetchPausedHandler);
                    client.send('Fetch.disable').catch(() => { });
                }
            };

            let targetRequestId = null;

            const onRequest = (e) => {
                requestMethods.set(e.requestId, e.request.method);
            };

            const onRes = (e) => {
                // 1. 监听生图接口错误 (如 429 Too Many Requests)
                if (e.response.url.includes('global/widgetStreamAssist')) {
                    if (e.response.status !== 200) {
                        logger.error('适配器', `请求返回错误状态码: ${e.response.status}`, meta);
                        cleanup();
                        resolve({ error: `API Error: ${e.response.status}` });
                        return;
                    }
                }

                if (e.response.url.includes('download/v1alpha/projects')) {
                    const method = requestMethods.get(e.requestId);
                    if (method === 'GET') {
                        logger.info('适配器', '捕获到图片下载亲求', meta);
                        targetRequestId = e.requestId;
                    } else {
                        logger.debug('适配器', `忽略非 GET 请求: ${method} - ${e.response.url}`, meta);
                    }
                }
            };

            const onLoad = async (e) => {
                if (e.requestId === targetRequestId) {
                    try {
                        const { body } = await client.send('Network.getResponseBody', { requestId: targetRequestId });
                        // GeminiBiz 返回的 body 已经是不带前缀的 base64 字符串,直接使用
                        const dataUri = `data:image/png;base64,${body}`;

                        logger.info('适配器', '生图成功', meta);
                        cleanup();
                        resolve({ image: dataUri });
                    } catch (err) {
                        logger.error('适配器', '生图失败 (提取图片失败)', { ...meta, error: err.message });
                        cleanup();
                        resolve({ error: err.message });
                    }
                }
            };

            client.on('Network.requestWillBeSent', onRequest);
            client.on('Network.responseReceived', onRes);
            client.on('Network.loadingFinished', onLoad);

            // 超时保护 (180秒)
            setTimeout(() => {
                cleanup();
                resolve({ error: 'Timeout' });
            }, 180000);
        });

        // 任务结束,移开鼠标
        if (page.cursor) {
            const currentVp = await getRealViewport(page);
            const relativeX = currentVp.safeWidth * random(0.85, 0.95);
            const relativeY = currentVp.height * random(0.3, 0.7);
            const finalX = clamp(relativeX, 0, currentVp.safeWidth);
            const finalY = clamp(relativeY, 0, currentVp.safeHeight);
            await page.cursor.moveTo({ x: finalX, y: finalY });
        }

        return result;

    } catch (err) {
        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: err.message };
    } finally {
        if (fetchPausedHandler) {
            client.off('Fetch.requestPaused', fetchPausedHandler);
            try {
                await client.send('Fetch.disable');
            } catch (e) { }
        }
    }
}

export { initBrowser, generateImage, TEMP_DIR };
