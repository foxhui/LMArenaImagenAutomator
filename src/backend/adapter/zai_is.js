/**
 * @fileoverview zAI 图片生成适配器
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
    useContextDownload,
    waitForPageAuth,
    lockPageAuth,
    unlockPageAuth,
    isPageAuthLocked,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// zai.is 输入框选择器
const INPUT_SELECTOR = '.tiptap.ProseMirror';

// 入口 URL
const TARGET_URL = 'https://zai.is/';

/**
 * 处理 Discord OAuth2 登录流程
 * @param {import('playwright-core').Page} page
 * @returns {Promise<boolean>} 是否处理了登录
 */
async function handleDiscordAuth(page) {
    // 防止重复处理
    if (isPageAuthLocked(page)) return false;

    const currentUrl = page.url();

    // 1. 检查是否在 zai.is/auth 页面
    if (currentUrl.includes('zai.is/auth')) {
        lockPageAuth(page);
        logger.info('适配器', '[登录器(zai_is)] 检测到登录页面，正在处理 Discord 登录...');

        try {
            // 等待页面加载完成，点击唯一的 button 标签
            await page.waitForSelector('button', { timeout: 30000 });
            await sleep(1000, 1500);
            await safeClick(page, 'button', { bias: 'button' });
            logger.info('适配器', '[登录器(zai_is)] 已点击登录按钮，等待跳转到 Discord...');

            // 2. 等待跳转到 Discord OAuth2 授权页面
            await page.waitForURL(url => url.href.includes('discord.com/oauth2/authorize'), { timeout: 60000 });
            logger.info('适配器', '[登录器(zai_is)] 已到达 Discord 授权页面');
            await sleep(2000, 3000);

            // 3. 使用鼠标滚轮滚动 main 元素，直到授权按钮可用
            // 授权按钮选择器: data-align="stretch" 的 div 中的最后一个按钮 (授权按钮在右边)
            const authorizeBtnSelector = 'div[data-align="stretch"] button:last-child';

            for (let i = 0; i < 15; i++) {
                const authorizeBtn = await page.$(authorizeBtnSelector);
                if (authorizeBtn) {
                    const isDisabled = await authorizeBtn.evaluate(el => el.disabled).catch(() => true);
                    if (!isDisabled) {
                        logger.info('适配器', '[登录器(zai_is)] 授权按钮已可用，正在点击...');
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
            logger.info('适配器', '[登录器(zai_is)] 等待跳转回目标页面...');
            await page.waitForURL(url => {
                const href = url.href;
                return href.includes('zai.is') &&
                    !href.includes('/auth') &&
                    !href.includes('discord.com');
            }, { timeout: 60000 });

            logger.info('适配器', '[登录器(zai_is)] Discord 登录完成');
            await sleep(2000, 3000);
            unlockPageAuth(page);
            return true;
        } catch (err) {
            logger.warn('适配器', `[登录器(zai_is)] Discord 登录处理失败: ${err.message}`);
            unlockPageAuth(page);
        }
    }


    return false;
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
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;

    try {
        // 开启新对话 - 先等待可能正在进行的登录处理完成
        await waitForPageAuth(page);

        logger.info('适配器', '开启新会话', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 如果触发了登录跳转，等待全局处理器完成
        await waitForPageAuth(page);

        // 1. 等待输入框加载
        logger.debug('适配器', '正在寻找输入框...', meta);
        await waitForInput(page, INPUT_SELECTOR, { click: false });
        await sleep(1500, 2500);

        // 2. 并行执行：上传图片 + 填写提示词
        const uploadTask = (imgPaths && imgPaths.length > 0) ? (async () => {
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
            await sleep(500, 1000);
        })() : Promise.resolve();

        const promptTask = (async () => {
            // 等待一小段时间，让图片上传先开始（pasteImages 会先点击输入框）
            if (imgPaths && imgPaths.length > 0) {
                await sleep(800, 1200);
            }
            await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
            await fillPrompt(page, INPUT_SELECTOR, prompt, meta);
        })();

        // 等待两个任务都完成
        await Promise.all([uploadTask, promptTask]);
        await sleep(500, 1000);

        // 4. 通过 UI 交互选择模型
        const modelConfig = manifest.models.find(m => m.id === modelId);
        const targetModel = modelConfig?.codeName || modelId;

        logger.debug('适配器', `正在选择模型: ${targetModel}`, meta);

        // 点击 "Select a models" 按钮
        const selectModelBtn = page.getByRole('button', { name: 'Select a model' });
        await selectModelBtn.waitFor({ timeout: 5000 });
        await sleep(300, 500);
        await safeClick(page, selectModelBtn, { bias: 'button' });
        await sleep(500, 800);

        // 在 "Search In Models" 文本框中输入模型名称
        const searchInput = page.getByRole('textbox', { name: 'Search In Models' });
        await searchInput.waitFor({ timeout: 5000 });
        await searchInput.fill(targetModel);
        await sleep(300, 500);

        // 按回车确认选择
        await searchInput.press('Enter');
        await sleep(500, 1000);

        logger.info('适配器', `已选择模型: ${targetModel}`, meta);

        // 5. 检查 GIF Generation 按钮状态，确保为 OFF
        const gifBtn = page.getByRole('button', { name: /^GIF Generation/ });
        const gifBtnExists = await gifBtn.count();
        if (gifBtnExists > 0) {
            const gifState = await gifBtn.evaluate(el => {
                const generic = el.querySelector('[role="generic"]') || el;
                return generic.textContent?.trim() || '';
            });

            if (!gifState.includes('OFF')) {
                logger.debug('适配器', `GIF Generation 当前为 ${gifState}，正在切换为 OFF`, meta);
                await safeClick(page, gifBtn, { bias: 'button' });
                await sleep(300, 500);
            }
        }

        // 6. 设置图片大小 (如果模型配置了 imageSize)
        if (modelConfig?.imageSize) {
            const targetSize = modelConfig.imageSize;  // 例如 "1K", "2K", "4K"
            logger.debug('适配器', `正在设置图片大小: ${targetSize}`, meta);

            const imageSizeBtn = page.getByRole('button', { name: /^Image Size/ });
            const btnExists = await imageSizeBtn.count();

            if (btnExists > 0) {
                // 最多点击 4 次切换
                for (let i = 0; i < 4; i++) {
                    // 获取当前图片大小 (从按钮下的 generic 元素中的 text leaf 获取)
                    const currentSize = await imageSizeBtn.evaluate(el => {
                        const generic = el.querySelector('[role="generic"]') || el;
                        return generic.textContent?.trim() || '';
                    });

                    if (currentSize.includes(targetSize)) {
                        logger.info('适配器', `图片大小已设置为: ${targetSize}`, meta);
                        break;
                    }

                    // 点击切换
                    await safeClick(page, imageSizeBtn, { bias: 'button' });
                    await sleep(300, 500);
                }
            } else {
                logger.debug('适配器', '未找到 Image Size 按钮', meta);
            }
        }

        // 7. 提交
        logger.debug('适配器', '点击发送...', meta);
        await submit(page, {
            btnSelector: 'button[type="submit"]',
            inputTarget: INPUT_SELECTOR,
            meta
        });

        logger.info('适配器', '等待生成结果中...', meta);

        // 8. 等待 v1/chats/new 响应 (状态码 200 且响应体中有 id)
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

        // 9. 等待 chat/completions 响应 (状态码 200 且 status: true)
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

        // 10. 等待 chat/completed 响应，从中提取图片链接
        logger.debug('适配器', '正在等待完成响应...', meta);

        let completedResponse;
        try {
            completedResponse = await waitApiResponse(page, {
                urlMatch: 'chat/completed',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) {
                if (e.name === 'TimeoutError') {
                    return { error: '等待完成响应超时 (120秒)' };
                }
                return pageError;
            }
            throw e;
        }

        // 解析 chat/completed 响应
        let completedBody;
        try {
            completedBody = await completedResponse.json();
        } catch (e) {
            logger.error('适配器', '解析 chat/completed 响应失败', { ...meta, error: e.message });
            return { error: '解析完成响应失败' };
        }

        // 在 messages 数组中查找匹配的消息 (id 与响应体的 id 相同)
        const targetMessage = (completedBody.messages || []).find(msg => msg.id === completedBody.id);
        if (!targetMessage) {
            logger.error('适配器', `未找到匹配的消息`, meta);
            return { error: '未找到匹配的消息' };
        }

        // 检查 content
        const content = targetMessage.content;
        if (!content || content.trim() === '') {
            logger.warn('适配器', '回复内容为空可能触发违规/限流', meta);
            return { error: '回复内容为空可能触发违规/限流' };
        }

        // 从 content 中提取图片链接 (格式: ![...](https://zai.is/...))
        const imageUrlMatch = content.match(/!\[.*?\]\((https:\/\/zai\.is\/[^)]+)\)/);
        if (!imageUrlMatch || !imageUrlMatch[1]) {
            logger.warn('适配器', '回复中未找到图片链接', meta);
            return { error: '回复中未找到图片链接' };
        }

        const imageUrl = imageUrlMatch[1];
        logger.info('适配器', `已提取图片链接: ${imageUrl}`, meta);

        // 下载图片
        const downloadResult = await useContextDownload(imageUrl, page);
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
        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'zai_is',
    displayName: 'zAI (图片生成)',
    description: '使用 zAI 平台生成图片，支持多种图片生成模型和分辨率选择。需要 Discord 账户登录授权。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'gemini-3-pro-image-preview', codeName: 'Nano Banana Pro', imagePolicy: 'optional', imageSize: '1K' },
        { id: 'gemini-3-pro-image-preview-2k', codeName: 'Nano Banana Pro', imagePolicy: 'optional', imageSize: '2K' },
        { id: 'gemini-3-pro-image-preview-4k', codeName: 'Nano Banana Pro', imagePolicy: 'optional', imageSize: '4K' },
        { id: 'gemini-2.5-flash-image', codeName: 'Nano Banana', imagePolicy: 'optional' }
    ],

    // 导航处理器
    navigationHandlers: [handleDiscordAuth],

    // 核心生图方法
    generate
};