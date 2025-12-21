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
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// Zenmux AI 输入框选择器
const INPUT_SELECTOR = '.chat-input-container textarea';
const SEND_BUTTON_SELECTOR = '.input-actions-send button';

/**
 * 生成文本
 * @param {object} context - 浏览器上下文 { page, client, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 参考图片路径数组
 * @param {string} modelId - 模型 ID
 * @returns {Promise<{text?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    try {
        const targetUrl = 'https://zenmux.ai/settings/chat';

        // 解析模型ID
        const modelConfig = manifest.models.find(m => m.id === modelId);
        const { codeName, providers } = modelConfig;

        // 导航到目标页面
        logger.info('适配器', '开启新会话', meta);
        await gotoWithCheck(page, targetUrl);

        // 点击 New Chat 按钮开启新对话
        try {
            const newChatBtn = page.locator('span').filter({ hasText: /New Chat/ }).locator('..').first();
            // 等待按钮出现（最多等待 5 秒）
            await newChatBtn.waitFor({ state: 'visible', timeout: 5000 });
            await safeClick(page, newChatBtn, { bias: 'button' });
            logger.debug('适配器', '已点击 New Chat 按钮', meta);
            await sleep(500, 1000);
        } catch (e) {
            logger.debug('适配器', `New Chat 按钮未找到或已在新会话中: ${e.message}`, meta);
        }

        // 1. 等待输入框加载
        logger.debug('适配器', '正在寻找输入框...', meta);
        await waitForInput(page, INPUT_SELECTOR, { click: false });
        await sleep(1000, 1500);

        // 2. 上传图片 (如果有)
        if (imgPaths && imgPaths.length > 0) {
            const expectedUploads = imgPaths.length;
            let uploadedCount = 0;

            logger.info('适配器', `准备上传 ${expectedUploads} 张图片`, meta);

            await pasteImages(page, INPUT_SELECTOR, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    // 监听 oss/upload POST 请求
                    if (response.request().method() === 'POST' && url.includes('oss/upload')) {
                        if (response.status() === 200) {
                            uploadedCount++;
                            logger.info('适配器', `图片上传进度: ${uploadedCount}/${expectedUploads}`, meta);

                            // 所有图片上传完成
                            if (uploadedCount >= expectedUploads) {
                                return true;
                            }
                        }
                    }
                    return false;
                }
            });

            await sleep(1000, 2000);
            logger.info('适配器', '图片上传完成', meta);
        }

        // 3. 填写提示词
        await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
        await fillPrompt(page, INPUT_SELECTOR, prompt, meta);
        await sleep(500, 1000);

        // 4. 设置请求拦截器（修改模型ID和providers）
        logger.debug('适配器', '已启用请求拦截', meta);
        await page.unroute('**/*').catch(() => { });

        await page.route(url => url.href.includes('v1/chat/completions'), async (route) => {
            const request = route.request();
            if (request.method() !== 'POST') return route.continue();

            try {
                const postData = request.postDataJSON();
                if (postData) {
                    let modified = false;

                    // 修改模型 ID（使用 codeName）
                    if (postData.model) {
                        logger.info('适配器', `已拦截请求，修改模型 ID: ${postData.model} -> ${codeName}`, meta);
                        postData.model = codeName;
                        modified = true;
                    }

                    // 修改 providers（如果模型配置中有 providers）
                    if (providers && providers.length > 0) {
                        if (!postData.provider) postData.provider = {};
                        if (!postData.provider.routing) postData.provider.routing = {};

                        logger.info('适配器', `已拦截请求，修改 providers: ${JSON.stringify(postData.provider.routing.providers)} -> ${JSON.stringify(providers)}`, meta);
                        postData.provider.routing.providers = providers;
                        modified = true;
                    }

                    if (modified) {
                        await route.continue({ postData: JSON.stringify(postData) });
                        return;
                    }
                }
            } catch (e) {
                logger.error('适配器', '请求拦截处理失败', { ...meta, error: e.message });
            }
            await route.continue();
        });

        // 5. 提交
        logger.debug('适配器', '点击发送...', meta);
        await submit(page, {
            btnSelector: SEND_BUTTON_SELECTOR,
            inputTarget: INPUT_SELECTOR,
            meta
        });

        logger.info('适配器', '等待生成结果中...', meta);

        // 5. 等待 API 响应
        let apiResponse;
        try {
            apiResponse = await waitApiResponse(page, {
                urlMatch: 'v1/chat/completions',
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

        // 6. 解析流式响应
        const content = await apiResponse.text();
        logger.debug('适配器', `收到响应，长度: ${content.length}`, meta);

        // 解析 EventStream 格式响应
        let fullText = '';
        try {
            const lines = content.split('\n');

            for (const line of lines) {
                // 跳过空行和 [DONE] 标记
                if (!line.trim() || line.includes('[DONE]')) {
                    continue;
                }

                // 解析 data: 开头的行
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6); // 去掉 "data: " 前缀

                    try {
                        const parsed = JSON.parse(jsonStr);

                        // 提取 choices 中的 content
                        if (parsed.choices && Array.isArray(parsed.choices)) {
                            for (const choice of parsed.choices) {
                                const content = choice?.delta?.content;

                                // 只提取有内容的文本（跳过空字符串和思考过程）
                                if (content && content.trim()) {
                                    fullText += content;
                                }
                            }
                        }
                    } catch (parseErr) {
                        // 单个 JSON 解析失败不影响整体
                        logger.debug('适配器', `解析单个数据块失败: ${parseErr.message}`, meta);
                    }
                }
            }
        } catch (e) {
            logger.error('适配器', '解析响应失败', { ...meta, error: e.message });
            return { error: `解析响应失败: ${e.message}` };
        }

        if (fullText) {
            logger.info('适配器', `获取文本成功，长度: ${fullText.length}`, meta);
            return { text: fullText };
        } else {
            logger.warn('适配器', '未解析到有效文本内容', { ...meta, preview: content.substring(0, 200) });
            return { error: '未解析到有效文本内容' };
        }

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
    id: 'zenmux_ai',
    displayName: 'Zenmux AI',

    // 无需额外配置
    configSchema: [],

    // 入口 URL
    getTargetUrl() {
        return 'https://zenmux.ai/settings/chat';
    },

    // 模型列表（仅支持非会员账户可用的模型）
    models: [
        { id: 'gemini-3-flash-preview', codeName: 'google/gemini-3-flash-preview-free', imagePolicy: 'optional', type: 'text', providers: ["google-vertex"] },
        { id: 'mimo-v2-flash', codeName: 'xiaomi/mimo-v2-flash', imagePolicy: 'forbidden', type: 'text', providers: ["xiaomi"] },
        { id: 'glm-4.6v-flash', codeName: 'z-ai/glm-4.6v-flash', imagePolicy: 'optional', type: 'text', providers: ["z-ai"] },
        { id: 'mistral-large-2512', codeName: 'mistralai/mistral-large-2512', imagePolicy: 'optional', type: 'text', providers: ["azure"] },
        { id: 'deepseek-v3.2', codeName: 'deepseek/deepseek-chat', imagePolicy: 'forbidden', type: 'text', providers: ["deepseek"] },
        { id: 'deepseek-v3.2-thinking', codeName: 'deepseek/deepseek-reasoner', imagePolicy: 'forbidden', type: 'text', providers: ["deepseek"] },
        { id: 'grok-4.1-fast', codeName: 'x-ai/grok-4.1-fast', imagePolicy: 'optional', type: 'text', providers: ["x-ai"] },
        { id: 'grok-4.1-fast-non-reasoning', codeName: 'x-ai/grok-4.1-fast-non-reasoning', imagePolicy: 'optional', type: 'text', providers: ["x-ai"] },
        { id: 'gpt-5.1-codex-mini', codeName: 'openai/gpt-5.1-codex-mini', imagePolicy: 'optional', type: 'text', providers: ["openai"] },
        { id: 'ernie-5.0-thinking-preview', codeName: 'baidu/ernie-5.0-thinking-preview', imagePolicy: 'optional', type: 'text', providers: ["baidu"] },
        { id: 'doubao-seed-code', codeName: 'volcengine/doubao-seed-code', imagePolicy: 'optional', type: 'text', providers: ["volcengine"] },
        { id: 'kimi-k2-thinking', codeName: 'moonshotai/kimi-k2-thinking', imagePolicy: 'forbidden', type: 'text', providers: ["moonshotai"] },
        { id: 'minimax-m2', codeName: 'minimax/minimax-m2', imagePolicy: 'forbidden', type: 'text', providers: ["minimax"] },
        { id: 'kat-coder-pro-v1', codeName: 'kuaishou/kat-coder-pro-v1', imagePolicy: 'forbidden', type: 'text', providers: ["streamlake"] },
        { id: 'glm-4.6', codeName: 'z-ai/glm-4.6', imagePolicy: 'forbidden', type: 'text', providers: ["z-ai"] },
        { id: 'claude-sonnet-4.5', codeName: 'anthropic/claude-sonnet-4.5', imagePolicy: 'optional', type: 'text', providers: ["anthropic"] },
        { id: 'qwen3-max', codeName: 'qwen/qwen3-max', imagePolicy: 'forbidden', type: 'text', providers: ["alibaba"] },
        { id: 'grok-4-fast', codeName: 'x-ai/grok-4-fast', imagePolicy: 'optional', type: 'text', providers: ["x-ai"] },
        { id: 'grok-4-fast-non-reasoning', codeName: 'x-ai/grok-4-fast-non-reasoning', imagePolicy: 'optional', type: 'text', providers: ["x-ai"] },
        { id: 'grok-code-fast-1', codeName: 'x-ai/grok-code-fast-1', imagePolicy: 'forbidden', type: 'text', providers: ["x-ai"] },
        { id: 'deepseek-v3.1', codeName: 'deepseek/deepseek-chat-v3.1', imagePolicy: 'forbidden', type: 'text', providers: ["theta"] },
        { id: 'gpt-5-mini', codeName: 'openai/gpt-5-mini', imagePolicy: 'optional', type: 'text', providers: ["openai"] },
        { id: 'gpt-5-nano', codeName: 'openai/gpt-5-nano', imagePolicy: 'optional', type: 'text', providers: ["openai"] },
        { id: 'glm-4.5-air', codeName: 'z-ai/glm-4.5-air', imagePolicy: 'forbidden', type: 'text', providers: ["z-ai"] },
        { id: 'gemini-2.5-flash-lite', codeName: 'google/gemini-2.5-flash-lite', imagePolicy: 'optional', type: 'text', providers: ["google-vertex"] },
        { id: 'gemini-2.5-flash', codeName: 'google/gemini-2.5-flash', imagePolicy: 'optional', type: 'text', providers: ["google-vertex"] },
        { id: 'deepseek-r1-0528', codeName: 'deepseek/deepseek-r1-0528', imagePolicy: 'forbidden', type: 'text', providers: ["theta"] },
        { id: 'claude-sonnet-4', codeName: 'anthropic/claude-sonnet-4', imagePolicy: 'optional', type: 'text', providers: ["anthropic"] },
        { id: 'qwen3-14b', codeName: 'qwen/qwen3-14b', imagePolicy: 'optional', type: 'text', providers: ["theta"] },
        { id: 'o4-mini', codeName: 'openai/o4-mini', imagePolicy: 'optional', type: 'text', providers: ["openai"] },
        { id: 'gpt-4.1-mini', codeName: 'openai/gpt-4.1-mini', imagePolicy: 'optional', type: 'text', providers: ["openai"] },
        { id: 'gpt-4.1-nano', codeName: 'openai/gpt-4.1-nano', imagePolicy: 'optional', type: 'text', providers: ["openai"] },
        { id: 'gemini-2.0-flash-lite', codeName: 'google/gemini-2.0-flash-lite-001', imagePolicy: 'optional', type: 'text', providers: ["google-vertex"] },
        { id: 'claude-3.7-sonnet', codeName: 'anthropic/claude-3.7-sonnet', imagePolicy: 'optional', type: 'text', providers: ["anthropic"] },
        { id: 'gemini-2.0-flash', codeName: 'google/gemini-2.0-flash', imagePolicy: 'optional', type: 'text', providers: ["google-vertex"] },
        { id: 'claude-3.5-sonnet', codeName: 'anthropic/claude-3.5-sonnet', imagePolicy: 'optional', type: 'text', providers: ["anthropic"] },
    ],


    // 无需导航处理器
    navigationHandlers: [],

    // 核心生成方法
    generate
};
