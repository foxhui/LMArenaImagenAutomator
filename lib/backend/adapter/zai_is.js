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
    moveMouseAway,
    downloadImage
} from '../utils.js';
import { logger } from '../../utils/logger.js';

// zai.is 输入框选择器
const INPUT_SELECTOR = '.tiptap.ProseMirror';

// 入口 URL
const TARGET_URL = 'https://zai.is/';

// 防止重复处理登录的锁
let isHandlingAuth = false;

/**
 * 处理 Discord OAuth2 登录流程
 * @param {import('playwright-core').Page} page
 * @returns {Promise<boolean>} 是否处理了登录
 */
async function handleDiscordAuth(page) {
    // 防止重复处理
    if (isHandlingAuth) return false;

    const currentUrl = page.url();

    // 1. 检查是否在 zai.is/auth 页面
    if (currentUrl.includes('zai.is/auth')) {
        isHandlingAuth = true;
        logger.info('适配器', '[登录器] 检测到登录页面，正在处理 Discord 登录...');

        try {
            // 等待页面加载完成，点击唯一的 button 标签
            await page.waitForSelector('button', { timeout: 30000 });
            await sleep(1000, 1500);
            await safeClick(page, 'button', { bias: 'button' });
            logger.info('适配器', '[登录器] 已点击登录按钮，等待跳转到 Discord...');

            // 2. 等待跳转到 Discord OAuth2 授权页面
            await page.waitForURL(url => url.href.includes('discord.com/oauth2/authorize'), { timeout: 60000 });
            logger.info('适配器', '[登录器] 已到达 Discord 授权页面');
            await sleep(2000, 3000);

            // 3. 使用鼠标滚轮滚动 main 元素，直到授权按钮可用
            // 授权按钮选择器: data-align="stretch" 的 div 中的最后一个按钮 (授权按钮在右边)
            const authorizeBtnSelector = 'div[data-align="stretch"] button:last-child';

            for (let i = 0; i < 15; i++) {
                const authorizeBtn = await page.$(authorizeBtnSelector);
                if (authorizeBtn) {
                    const isDisabled = await authorizeBtn.evaluate(el => el.disabled).catch(() => true);
                    if (!isDisabled) {
                        logger.info('适配器', '[登录器] 授权按钮已可用，正在点击...');
                        await sleep(500, 1000);
                        await safeClick(page, authorizeBtn, { bias: 'button' });
                        break;
                    }
                }
                // 使用鼠标滚轮在 main 元素中滚动
                const mainElement = await page.$('main');
                if (mainElement) {
                    const box = await mainElement.boundingBox();
                    if (box) {
                        // 将鼠标移动到 main 元素中心并滚动
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                        await page.mouse.wheel(0, 200);
                    }
                }
                await sleep(800, 1200);
            }

            // 4. 等待跳转回 zai.is (不包含 auth 和 discord)
            logger.info('适配器', '[登录器] 等待跳转回目标页面...');
            await page.waitForURL(url => {
                const href = url.href;
                return href.includes('zai.is') &&
                    !href.includes('/auth') &&
                    !href.includes('discord.com');
            }, { timeout: 60000 });

            logger.info('适配器', '[登录器] Discord 登录完成');
            await sleep(2000, 3000);
            isHandlingAuth = false;
            return true;
        } catch (err) {
            logger.warn('适配器', `[登录器] Discord 登录处理失败: ${err.message}`);
            isHandlingAuth = false;
        }
    }


    return false;
}

/**
 * 等待输入框出现，同时自动处理 Discord 登录
 * @param {import('playwright-core').Page} page
 * @param {object} [options={}]
 * @param {number} [options.timeout=60000]
 * @param {boolean} [options.click=true]
 */
async function waitForInputWithAuth(page, options = {}) {
    const { timeout = 60000, click = true } = options;

    // 设置导航监听器，自动处理登录页面跳转
    const navigationHandler = async () => {
        await handleDiscordAuth(page);
    };
    page.on('framenavigated', navigationHandler);

    try {
        // 先检查一次当前页面
        await handleDiscordAuth(page);

        // 轮询等待输入框，同时处理登录
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            if (await handleDiscordAuth(page)) {
                continue;
            }

            const inputHandle = await page.$(INPUT_SELECTOR);
            if (inputHandle) break;

            await sleep(1000, 1500);
        }

        // 最终确认输入框存在
        await page.waitForSelector(INPUT_SELECTOR, { timeout: 5000 }).catch(() => {
            throw new Error('未找到输入框 (.tiptap.ProseMirror)');
        });

        if (click) {
            await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
            await sleep(500, 1000);
        }
    } finally {
        page.off('framenavigated', navigationHandler);
    }
}

/**
 * 初始化浏览器
 * @param {object} config - 配置对象
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
async function initBrowser(config) {
    // 输入框验证逻辑（使用公共函数）
    const waitInputValidator = async (page) => {
        await waitForInputWithAuth(page);
    };

    const base = await initBrowserBase(config, {
        userDataDir: config.paths.userDataDir,
        targetUrl: TARGET_URL,
        productName: 'Zai.is',
        waitInputValidator
    });
    return { ...base, config };
}

/**
 * 生成图片
 * @param {object} context - 浏览器上下文 { page, client, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 参考图片路径数组
 * @param {string} modelId - 模型 ID
 * @param {object} meta - 日志元数据
 * @returns {Promise<{image?: string, error?: string}>} 生成结果
 */
async function generateImage(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;

    try {
        // 开启新对话
        logger.info('适配器', '开启新会话', meta);
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 1. 等待输入框加载（使用公共函数处理登录）
        logger.debug('适配器', '正在寻找输入框...', meta);
        await waitForInputWithAuth(page, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片 (如果有多张图片，会一张一张上传，每次都是 v1/files POST 请求)
        if (imgPaths && imgPaths.length > 0) {
            const expectedUploads = imgPaths.length;
            let uploadedCount = 0;

            await pasteImages(page, INPUT_SELECTOR, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    if (response.status() === 200 && url.includes('v1/files')) {
                        uploadedCount++;
                        logger.info('适配器', `图片上传进度: ${uploadedCount}/${expectedUploads}`, meta);
                        if (uploadedCount >= expectedUploads) {
                            return true;
                        }
                    }
                    return false;
                }
            });

            await sleep(1000, 2000);
        }

        // 3. 填写提示词
        await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
        await fillPrompt(page, INPUT_SELECTOR, prompt, meta);
        await sleep(500, 1000);

        // 4. 设置请求拦截器 - 修改 chat/completions 请求中的 model 参数
        logger.debug('适配器', '已启用请求拦截', meta);
        await page.unroute('**/*').catch(() => { });

        await page.route(url => url.href.includes('chat/completions'), async (route) => {
            const request = route.request();
            if (request.method() !== 'POST') return route.continue();

            try {
                const postData = request.postDataJSON();
                if (postData) {
                    logger.debug('适配器', '已拦截 chat/completions 请求，正在修改 model...', meta);
                    postData.model = modelId;
                    logger.info('适配器', `已拦截请求，使用模型: ${modelId}`, meta);
                    await route.continue({ postData: JSON.stringify(postData) });
                    return;
                }
            } catch (e) {
                logger.error('适配器', '请求拦截处理失败', { ...meta, error: e.message });
            }
            await route.continue();
        });

        // 5. 提交
        logger.debug('适配器', '点击发送...', meta);
        await submit(page, {
            btnSelector: 'button[type="submit"]',
            inputTarget: INPUT_SELECTOR,
            meta
        });

        logger.info('适配器', '等待生成结果中...', meta);

        // 6. 等待 v1/chats/new 响应 (状态码 200 且响应体中有 id)
        let chatsNewResponse;
        try {
            chatsNewResponse = await waitApiResponse(page, {
                urlMatch: 'v1/chats/new',
                method: 'POST',
                timeout: 60000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 检查 chats/new 响应
        const httpError = normalizeHttpError(chatsNewResponse);
        if (httpError) {
            logger.error('适配器', `创建对话失败: ${httpError.error}`, meta);
            return { error: `创建对话失败: ${httpError.error}` };
        }

        try {
            const chatsNewBody = await chatsNewResponse.json();
            if (!chatsNewBody.id) {
                logger.error('适配器', '创建对话响应中没有无 id', meta);
                return { error: '创建对话响应中没有 id' };
            }
            logger.debug('适配器', `对话创建成功, id: ${chatsNewBody.id}`, meta);
        } catch (e) {
            logger.error('适配器', '解析 chats/new 响应失败', { ...meta, error: e.message });
            return { error: '解析对话响应失败' };
        }

        // 7. 等待 chat/completions 响应 (状态码 200 且 status: true)
        let completionsResponse;
        try {
            completionsResponse = await waitApiResponse(page, {
                urlMatch: 'chat/completions',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        const completionsHttpError = normalizeHttpError(completionsResponse);
        if (completionsHttpError) {
            logger.error('适配器', `生成请求失败: ${completionsHttpError.error}`, meta);
            return { error: `生成请求失败: ${completionsHttpError.error}` };
        }

        try {
            const completionsBody = await completionsResponse.json();
            if (!completionsBody.status) {
                logger.error('适配器', '生成响应 status 不为 true', meta);
                return { error: '生成失败，响应状态异常' };
            }
            logger.debug('适配器', '生成请求成功', meta);
        } catch (e) {
            logger.error('适配器', '解析 completions 响应失败', { ...meta, error: e.message });
            return { error: '解析生成响应失败' };
        }

        // 8. 等待并捕获图片下载响应 (zai.is/media/ GET 链接)
        logger.debug('适配器', '已获取结果，正在等待图片...', meta);

        let imageResponse;
        try {
            imageResponse = await waitApiResponse(page, {
                urlMatch: 'zai.is/media/',
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

        // 下载图片
        const imageUrl = imageResponse.url();
        logger.info('适配器', '已获取结果，正在下载图片...', meta);

        const downloadResult = await downloadImage(imageUrl, config);
        if (downloadResult.error) {
            return downloadResult;
        }

        logger.info('适配器', '已下载图片，任务完成', meta);
        return { image: downloadResult.image };

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

export { initBrowser, generateImage };
