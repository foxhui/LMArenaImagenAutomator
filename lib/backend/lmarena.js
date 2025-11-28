import fs from 'fs';
import path from 'path';
import { gotScraping } from 'got-scraping';
import { initBrowserBase } from '../browser/launcher.js';
import {
    random,
    sleep,
    getRealViewport,
    clamp,
    safeClick,
    humanType,
    pasteImages
} from '../browser/utils.js';
import { logger } from '../logger.js';

// --- 配置常量 ---
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'chromeUserData');
const TARGET_URL = 'https://lmarena.ai/c/new?mode=direct&chat-modality=image';
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 从响应文本中提取图片 URL
 * @param {string} text 响应文本
 * @returns {string|null} 图片 URL 或 null
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
 * 初始化浏览器
 * @param {object} config 配置对象 (包含 chrome 配置)
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
async function initBrowser(config) {
    // LMArena 特定的输入框验证
    const waitInputValidator = async (page) => {
        const textareaSelector = 'textarea';
        await page.waitForSelector(textareaSelector, { timeout: 60000 });

        // 移动鼠标到输入框
        const box = await (await page.$(textareaSelector)).boundingBox();
        if (box) {
            if (page.cursor) {
                await page.cursor.moveTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
            }
            await sleep(500, 1000);
        }
    };

    return await initBrowserBase(config, {
        userDataDir: USER_DATA_DIR,
        targetUrl: TARGET_URL,
        productName: 'LMArena',
        reuseExistingTab: true,
        waitInputValidator
    });
}

/**
 * 执行生图任务
 * @param {object} context 浏览器上下文 {page, client}
 * @param {string} prompt 提示词
 * @param {string[]} imgPaths 图片路径数组
 * @param {string|null} modelId 模型 UUID (可选)
 * @returns {Promise<{image?: string, text?: string, error?: string}>}
 */
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, client } = context;
    const textareaSelector = 'textarea';
    let fetchPausedHandler = null;

    try {
        // 1. 强制开启新会话 (通过URL跳转)
        logger.info('适配器', '开启新会话', meta);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 等待输入框出现
        await page.waitForSelector(textareaSelector, { timeout: 30000 });
        await sleep(1500, 2500); // 等页面稳一点

        // 2. 粘贴图片
        if (imgPaths && imgPaths.length > 0) {
            await pasteImages(page, textareaSelector, imgPaths);
            // 如果没有图片,也点击一下输入框获取焦点
            await safeClick(page, textareaSelector);
        }

        // 3. 输入 Prompt
        logger.info('适配器', '正在输入提示词...', meta);
        await humanType(page, textareaSelector, prompt);
        await sleep(800, 1500);

        // 注入 CDP 拦截器 
        if (modelId) {
            // 1. 启用 Fetch 域拦截,仅拦截特定 URL
            await client.send('Fetch.enable', {
                patterns: [{
                    urlPattern: '*nextjs-api/stream*',
                    requestStage: 'Request'
                }]
            });

            // 2. 定义拦截处理函数
            fetchPausedHandler = async (event) => {
                const { requestId, request } = event;

                if (request.method === 'POST' && request.postData) {
                    try {
                        // 尝试解码可能是 Base64 编码的postData
                        let rawBody = request.postData;
                        // 尝试解析 JSON
                        let data;
                        try {
                            data = JSON.parse(rawBody);
                        } catch (e) {
                            // 尝试 Base64 解码
                            try {
                                rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
                                data = JSON.parse(rawBody);
                            } catch (e2) {
                                // 无法解析,跳过
                            }
                        }

                        if (data && data.modelAId) {
                            logger.debug('适配器', `已拦截请求，原始模型UUID: ${data.modelAId}`, meta);

                            // 修改 modelAId
                            data.modelAId = modelId;

                            // 重新序列化并转为 Base64 (Fetch.continueRequest 需要 base64)
                            const newBody = JSON.stringify(data);
                            const newBodyBase64 = Buffer.from(newBody).toString('base64');
                            logger.debug('适配器', `已拦截请求，修改模型UUID为: ${data.modelAId}`, meta);
                            logger.info('适配器', '已拦截请求，修改为指定模型', meta);

                            await client.send('Fetch.continueRequest', {
                                requestId,
                                postData: newBodyBase64
                            });
                            return;
                        }
                    } catch (e) {
                        logger.error('适配器', '请求拦截处理出错', { ...meta, error: e.message });
                    }
                }

                // 如果不匹配或出错,直接放行
                try {
                    await client.send('Fetch.continueRequest', { requestId });
                } catch (e) { }
            };

            // 3. 监听拦截事件
            client.on('Fetch.requestPaused', fetchPausedHandler);
            logger.debug('适配器', `已启用请求拦截`, meta);
        }

        // 4. 发送
        logger.debug('适配器', '点击发送...', meta);
        const btnSelector = 'button[type="submit"]';
        await safeClick(page, btnSelector);

        logger.info('适配器', '等待生成结果中...', meta);

        // 5. 监听网络响应
        let targetRequestId = null;
        const result = await new Promise((resolve) => {
            const cleanup = () => {
                client.off('Network.responseReceived', onRes);
                client.off('Network.loadingFinished', onLoad);
            };
            const onRes = (e) => {
                // 监听流式响应接口
                if (e.response.url.includes('/nextjs-api/stream/')) targetRequestId = e.requestId;
            };
            const onLoad = async (e) => {
                if (e.requestId === targetRequestId) {
                    try {
                        const { body, base64Encoded } = await client.send('Network.getResponseBody', { requestId: targetRequestId });
                        const content = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;

                        // 检查是否包含 reCAPTCHA 错误
                        if (content.includes('recaptcha validation failed')) {
                            cleanup();
                            resolve({ error: 'recaptcha validation failed' });
                            return;
                        }

                        const img = extractImage(content);
                        if (img) {
                            logger.info('适配器', '已获取生图结果，正在下载图片...', meta);

                            // 下载图片并转换为 Base64
                            try {
                                const response = await gotScraping({
                                    url: img,
                                    responseType: 'buffer',
                                    http2: true,
                                    headerGeneratorOptions: {
                                        browsers: [{ name: 'chrome', minVersion: 110 }],
                                        devices: ['desktop'],
                                        locales: ['en-US'],
                                        operatingSystems: ['windows'],
                                    }
                                });
                                const base64 = response.body.toString('base64');
                                const dataUri = `data:image/png;base64,${base64}`;
                                logger.info('适配器', '生图成功', meta);

                                cleanup();
                                resolve({ image: dataUri });
                            } catch (e) {
                                logger.error('适配器', '图片下载失败', { ...meta, error: e.message });
                                cleanup();
                                resolve({ error: `Image download failed: ${e.message}` });
                            }
                        } else {
                            logger.info('适配器', 'AI 返回文本回复', { ...meta, preview: content.substring(0, 150) });
                            cleanup();
                            resolve({ text: content });
                        }
                    } catch (err) {
                        cleanup();
                        resolve({ error: err.message });
                    }
                }
            };
            client.on('Network.responseReceived', onRes);
            client.on('Network.loadingFinished', onLoad);

            // 超时保护 (120秒)
            setTimeout(() => {
                cleanup();
                resolve({ error: 'Timeout' });
            }, 120000);
        });

        // 任务结束,基于当前窗口比例智能移开鼠标
        if (page.cursor) {
            // 1. 再次获取最新窗口大小 (用户可能在生成过程中改变了窗口大小)
            const currentVp = await getRealViewport(page);

            // 2. 计算相对坐标:停靠在屏幕右侧 85% ~ 95% 的位置
            const relativeX = currentVp.safeWidth * random(0.85, 0.95);
            const relativeY = currentVp.height * random(0.3, 0.7); // 高度居中随机

            // 3. 再次检查
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
