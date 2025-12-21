/**
 * @fileoverview LMArena 文本生成适配器
 */

import {
    sleep,
    safeClick,
    pasteImages
} from '../engine/utils.js';
import {
    fillPrompt,
    submit,
    waitApiResponse,
    normalizePageError,
    normalizeHttpError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://lmarena.ai/c/new?mode=direct';
const TARGET_URL_SEARCH = 'https://lmarena.ai/zh/c/new?mode=direct&chat-modality=search';

/**
 * 执行生图任务
 * @param {object} context - 浏览器上下文 { page, client }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 指定的模型 ID (可选)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, text?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const textareaSelector = 'textarea';

    // Worker 已验证，直接解析模型配置
    const modelConfig = manifest.models.find(m => m.id === modelId);
    const { codeName, search } = modelConfig || {};
    const targetUrl = search ? TARGET_URL_SEARCH : TARGET_URL;

    try {
        logger.info('适配器', `开启新会话... (搜索模式: ${!!search})`, meta);
        await gotoWithCheck(page, targetUrl);

        // 1. 等待输入框加载
        await waitForInput(page, textareaSelector, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片 (uploadImages)
        if (imgPaths && imgPaths.length > 0) {
            await pasteImages(page, textareaSelector, imgPaths);
        }

        // 3. 填写提示词 (fillPrompt)
        await safeClick(page, textareaSelector, { bias: 'input' });
        await fillPrompt(page, textareaSelector, prompt, meta);

        // 4. 配置请求拦截 (用于修改模型 ID 为 codeName)
        await page.unroute('**/*').catch(() => { });

        if (codeName) {
            logger.debug('适配器', `准备拦截请求`, meta);
            await page.route(url => url.href.includes('/nextjs-api/stream'), async (route) => {
                const request = route.request();
                if (request.method() !== 'POST') return route.continue();

                try {
                    const postData = request.postDataJSON();
                    if (postData && postData.modelAId) {
                        logger.info('适配器', `已拦截请求并修改模型: ${postData.modelAId} -> ${codeName}`, meta);
                        postData.modelAId = codeName;
                        await route.continue({ postData: JSON.stringify(postData) });
                        return;
                    }
                } catch (e) {
                    logger.error('适配器', '拦截处理异常', { ...meta, error: e.message });
                }
                await route.continue();
            });
        }

        // 5. 提交表单 (submit)
        logger.debug('适配器', '点击发送...', meta);
        await submit(page, {
            btnSelector: 'button[type="submit"]',
            inputTarget: textareaSelector,
            meta
        });

        logger.info('适配器', '等待生成结果...', meta);

        // 6. 等待 API 响应 (waitApiResponse)
        let response;
        try {
            response = await waitApiResponse(page, {
                urlMatch: '/nextjs-api/stream',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            // 使用公共错误处理
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 7. 解析响应结果
        const content = await response.text();

        // 8. 检查 HTTP 错误
        const httpError = normalizeHttpError(response, content);
        if (httpError) {
            logger.error('适配器', `请求生成时返回错误: ${httpError.error}`, meta);
            return { error: `请求生成时返回错误: ${httpError.error}` };
        }

        // 9. 解析文本流
        // 格式示例:
        // a0:"Hello"
        // a0:" World"
        // d:{"finishReason":"stop"}
        let fullText = '';
        const lines = content.split('\n');

        for (const line of lines) {
            if (line.startsWith('a0:')) {
                try {
                    // 尝试解析 JSON 字符串内容
                    // line.substring(3) 应该是 JSON 字符串，如 "Hello"
                    const textPart = JSON.parse(line.substring(3));
                    fullText += textPart;
                } catch (e) {
                    // 如果解析失败，可能是原生文本或其他格式
                    logger.warn('适配器', `解析文本块失败: ${line}`, meta);
                }
            }
        }

        if (fullText) {
            logger.info('适配器', `获取文本成功，长度: ${fullText.length}`, meta);
            return { text: fullText };
        } else {
            logger.warn('适配器', '未解析到有效文本内容', { ...meta, preview: content.substring(0, 150) });
            // 如果没解析到 a0，尝试直接返回原始内容防空
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
        if (codeName) await page.unroute('**/*').catch(() => { });

        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'lmarena_text',
    displayName: 'LMArena (文本生成)',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表（从 models.js 迁移）
    models: [
        { id: 'claude-opus-4-5-20251101-thinking-32k', codeName: '019ab8b2-9bcf-79b5-9fb5-149a7c67b7c0', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-5-20251101', 'codeName': '019adbec-8396-71cc-87d5-b47f8431a6a6', 'imagePolicy': 'forbidden', "type": "text" },
        { id: 'gemini-3-pro', codeName: '019a98f7-afcd-779f-8dcb-856cc3b3f078', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4.1-thinking', codeName: '019a9389-a9d3-77a8-afbb-4fe4dd3d8630', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4.1', codeName: '019a9389-a4d8-748d-9939-b4640198302e', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5.1-high', codeName: '019a8548-a2b1-70ce-b1be-eba096d41f58', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-pro', codeName: '0199f060-b306-7e1f-aeae-0ebb4e3f1122', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-sonnet-4-5-20250929-thinking-32k', codeName: 'b0ea1407-2f92-4515-b9cc-b22a6d6c14f2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-1-20250805-thinking-16k', codeName: 'f1a2eb6f-fc30-4806-9e00-1efd0d73cbc4', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-5-20250929', codeName: '019a2d13-28a5-7205-908c-0a58de904617', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-1-20250805', codeName: '96ae95fd-b70d-49c3-91cc-b58c7da1090b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'chatgpt-4o-latest-20250326', codeName: '0199c1e0-3720-742d-91c8-787788b0a19b', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5.1', codeName: '019a7ebf-0f3f-7518-8899-fca13e32d9dc', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5-high', codeName: '983bc566-b783-4d28-b24c-3c8b08eb1086', imagePolicy: 'optional', type: 'text' },
        { id: 'o3-2025-04-16', codeName: 'cb0f1e24-e8e9-4745-aabc-b926ffde7475', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-max-preview', codeName: '812c93cc-5f88-4cff-b9ca-c11a26599b0e', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4-1-fast-reasoning', codeName: '019aa41a-0a13-714a-beb1-be4a918a4b56', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ernie-5.0-preview-1103', codeName: '019a4ca9-720d-75f5-9012-883ce8ff61df', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-thinking-turbo', codeName: '019a59bc-8bb8-7933-92eb-fe143770c211', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-chat', codeName: '4b11c78c-08c8-461c-938e-5fc97d56a40d', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.6', codeName: 'f595e6f1-6175-4880-a9eb-377e390819e4', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-max-2025-09-23', codeName: '98ad8b8b-12cd-46cd-98de-99edde7e03eb', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-20250514-thinking-16k', codeName: '3b5e9593-3dc0-4492-a3da-19784c4bde75', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-instruct-2507', codeName: 'ee7cb86e-8601-4585-b1d0-7c7380f8f6f4', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4-fast-chat', codeName: 'grok-4-fast-chat', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-v3.2-thinking', codeName: '019adb32-bb7a-77eb-882f-b8e3aaa2b2fd', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-0905-preview', codeName: 'b88e983b-9459-473d-8bf1-753932f1679a', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-0711-preview', codeName: '7a3626fc-4e64-4c9e-821f-b449a4b43b6a', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-v3.2', codeName: '019adb32-b716-7591-9a2f-c6882973e340', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-235b-a22b-instruct', codeName: '716aa8ca-d729-427f-93ab-9579e4a13e98', imagePolicy: 'optional', type: 'text' },
        { id: 'mistral-large-3', codeName: '019acbac-df7c-73dc-9716-ebe040daaa4e', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-4.1-2025-04-14', codeName: '14e9311c-94d2-40c2-8c54-273947e208b0', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-opus-4-20250514', codeName: 'ee116d12-64d6-48a8-88e5-b2d06325cdd2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-medium-2508', codeName: '27035fb8-a25b-4ec9-8410-34be18328afd', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4-0709', codeName: 'b9edb8e9-4e98-49e7-8aaf-ae67e9797a11', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.5', codeName: 'd079ef40-3b20-4c58-ab5e-243738dbada5', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-2.5-flash', codeName: '0199f059-3877-7cfe-bc80-e01b1a4a83de', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-flash-preview-09-2025', codeName: 'fc700d46-c4c1-4fec-88b5-f086876ae0bb', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-haiku-4-5-20251001', codeName: '0199e8e9-01ed-73e0-96ba-cf43b286bf10', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4-fast-reasoning', codeName: '19b3730a-0369-49ba-ad9c-09e7337937f0', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-next-80b-a3b-instruct', codeName: '351fe482-eb6c-4536-857b-909e16c0bf52', imagePolicy: 'forbidden', type: 'text' },
        { id: 'longcat-flash-chat', codeName: '6fcbe051-f521-4dc7-8986-c429eb6191bf', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-no-thinking', codeName: '1a400d9a-f61c-4bc2-89b4-a9b7e77dff12', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-thinking-2507', codeName: '16b8e53a-cc7b-4608-a29a-20d4dac77cf2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-235b-a22b-thinking', codeName: '03c511f5-0d35-4751-aae6-24f918b0d49e', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5-mini-high', codeName: '5fd3caa8-fe4c-41a5-a22c-0025b58f4b42', imagePolicy: 'optional', type: 'text' },
        { id: 'deepseek-v3-0324', codeName: '2f5253e4-75be-473c-bcfc-baeb3df0f8ad', imagePolicy: 'forbidden', type: 'text' },
        { id: 'hunyuan-vision-1.5-thinking', codeName: '6a3a1e04-050e-4cb4-9052-b9ac4bec0c38', imagePolicy: 'optional', type: 'text' },
        { id: 'o4-mini-2025-04-16', codeName: 'f1102bbf-34ca-468f-a9fc-14bcf63f315b', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-sonnet-4-20250514', codeName: 'ac44dd10-0666-451c-b824-386ccfea7bcc', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-7-sonnet-20250219-thinking-32k', codeName: 'be98fcfd-345c-4ae1-9a82-a19123ebf1d2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-coder-480b-a35b-instruct', codeName: 'af033cbd-ec6c-42cc-9afa-e227fc12efe8', imagePolicy: 'forbidden', type: 'text' },
        { id: 'hunyuan-t1-20250711', codeName: 'ba8c2392-4c47-42af-bfee-c6c057615a91', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-medium-2505', codeName: '27b9f8c6-3ee1-464a-9479-a8b3c2a48fd4', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-30b-a3b-instruct-2507', codeName: 'a8d1d310-e485-4c50-8f27-4bff18292a99', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-4.1-mini-2025-04-14', codeName: '6a5437a7-c786-467b-b701-17b0bc8c8231', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-flash-lite-preview-09-2025-no-thinking', codeName: '75555628-8c14-402a-8d6e-43c19cb40116', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-flash-lite-preview-06-17-thinking', codeName: '04ec9a17-c597-49df-acf0-963da275c246', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-235b-a22b', codeName: '2595a594-fa54-4299-97cd-2d7380d21c80', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-5-sonnet-20241022', codeName: 'f44e280a-7914-43ca-a25d-ecfcc5d48d09', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-7-sonnet-20250219', codeName: 'c5a11495-081a-4dc6-8d9a-64a4fd6f7bbc', imagePolicy: 'forbidden', type: 'text' },
        { id: 'glm-4.5-air', codeName: '7bfb254a-5d32-4ce2-b6dc-2c7faf1d5fe8', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-next-80b-a3b-thinking', codeName: '73cf8705-98c8-4b75-8d04-e3746e1c1565', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m1', codeName: '87e8d160-049e-4b4e-adc4-7f2511348539', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemma-3-27b-it', codeName: '789e245f-eafe-4c72-b563-d135e93988fc', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-3-mini-high', codeName: '149619f1-f1d5-45fd-a53e-7d790f156f20', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-2.0-flash-001', codeName: '7a55108b-b997-4cff-a72f-5aa83beee918', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-3-mini-beta', codeName: '7699c8d4-0742-42f9-a117-d10e84688dab', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-small-2506', codeName: 'bbad1d17-6aa5-4321-949c-d11fb6289241', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-oss-120b', codeName: '6ee9f901-17b5-4fbe-9cc2-13c16497c23b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'glm-4.5v', codeName: '9dab0475-a0cc-4524-84a2-3fd25aa8c768', imagePolicy: 'optional', type: 'text' },
        { id: 'command-a-03-2025', codeName: '0f785ba1-efcb-472d-961e-69f7b251c7e3', imagePolicy: 'forbidden', type: 'text' },
        { id: 'amazon-nova-experimental-chat-10-20', codeName: '019a4c75-256c-790b-9088-4694cc63c507', imagePolicy: 'forbidden', type: 'text' },
        { id: 'intellect-3', codeName: '019aebfd-af0e-7f0c-8f0d-96c588e4cd3b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'o3-mini', codeName: 'c680645e-efac-4a81-b0af-da16902b2541', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ling-flash-2.0', codeName: '71f96ca9-4cf8-4be7-bac2-2231613930a6', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m2', codeName: '019a27e0-e7d8-7b0b-877c-a2106c6eb87d', imagePolicy: 'forbidden', type: 'text' },
        { id: 'step-3', codeName: '1ea13a81-93a7-4804-bcdd-693cd72e302d', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-nano-high', codeName: '2dc249b3-98da-44b4-8d1e-6666346a8012', imagePolicy: 'optional', type: 'text' },
        { id: 'nova-2-lite', codeName: '019ae300-83b7-7717-a1e0-31accd1ff6fa', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwq-32b', codeName: '885976d3-d178-48f5-a3f4-6e13e0718872', imagePolicy: 'forbidden', type: 'text' },
        { id: 'llama-4-maverick-17b-128e-instruct', codeName: 'b5ad3ab7-fc56-4ecd-8921-bd56b55c1159', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-30b-a3b', codeName: '9a066f6a-7205-4325-8d0b-d81cc4b049c0', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-5-haiku-20241022', codeName: 'claude-3-5-haiku-20241022', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ring-flash-2.0', codeName: '11ad4114-c868-4fed-b6e7-d535dc9c62f8', imagePolicy: 'forbidden', type: 'text' },
        { id: 'llama-3.3-70b-instruct', codeName: 'dcbd7897-5a37-4a34-93f1-76a24c7bb028', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemma-3n-e4b-it', codeName: '896a3848-ae03-4651-963b-7d8f54b61ae8', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-oss-20b', codeName: 'ec3beb4b-7229-4232-bab9-670ee52dd711', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mercury', codeName: '019a6f77-e20d-7c1d-a7cd-8bd926e7395d', imagePolicy: 'forbidden', type: 'text' },
        { id: 'olmo-3-32b-think', codeName: '019ac2ef-27e1-769f-8258-d131f79e28ef', imagePolicy: 'forbidden', type: 'text' },
        { id: 'magistral-medium-2506', codeName: '6337f479-2fc8-4311-a76b-8c957765cd68', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-small-3.1-24b-instruct-2503', codeName: '69f5d38a-45f5-4d3a-9320-b866a4035ed9', imagePolicy: 'optional', type: 'text' },
        { id: 'ibm-granite-h-small', codeName: '4ddb69f5-391a-4f78-af92-7d7328c18ab1', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-8b-thinking', codeName: '0199e3d1-a308-77b9-a650-41453e8ef2fb', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-vl-8b-instruct', codeName: '0199e3d1-a713-7de2-a5dd-a1583cad9532', imagePolicy: 'optional', type: 'text' },
        { id: 'amazon.nova-pro-v1:0', codeName: 'a14546b5-d78d-4cf6-bb61-ab5b8510a9d6', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.6v', codeName: '019b151a-7c3b-72a2-8811-0bf9317c2ef5', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5.2-high', codeName: '019b1448-dafa-7f92-90c3-50e159c2263c', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5.2', codeName: '019b1448-d548-78f4-8b98-788d72cbd057', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.6v-flash', codeName: '019b1536-49c0-73b2-8d45-403b8571568d', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-omni-flash', codeName: '0199c9dc-e157-7458-bd49-5942363be215', imagePolicy: 'optional', type: 'text' },
        { id: 'mimo-vl-7b-rl-2508', codeName: '1c0259b5-dff7-48ce-bca1-b6957675463b', imagePolicy: 'optional', type: 'text' },
        { id: 'mimo-7b', codeName: 'ee3588cd-1fe1-484a-bcc9-f92065b8380c', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-3-pro-grounding', codeName: '019abdb7-6957-71c1-96a2-bfa79e8a094f', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.1-search', codeName: '019abdb7-50a5-7c05-9308-4491d069578b', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-fast-search', codeName: '9217ac2d-91bc-4391-aa07-b8f9e2cf11f2', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gemini-2.5-pro-grounding', codeName: 'b222be23-bd55-4b20-930b-a30cc84d3afd', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'o3-search', codeName: 'fbe08e9a-3805-4f9f-a085-7bc38e4b51d1', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-search', codeName: '86d767b0-2574-4e47-a256-a22bcace9f56', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'ppl-sonar-reasoning-pro-high', codeName: '24145149-86c9-4690-b7c9-79c7db216e5c', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-1-search', codeName: 'd942b564-191c-41c5-ae22-400a930a2cfe', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5-search', codeName: 'd14d9b23-1e46-4659-b157-a3804ba7e2ef', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-search', codeName: '25bcb878-749e-49f4-ac05-de84d964bcee', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'diffbot-small-xl', codeName: '0862885e-ef53-4d0d-b9c4-4c8f68f453ce', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-1-fast-search', codeName: '019af19c-0658-7566-9c60-112ae5bdb8db', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.2-search', codeName: '019b1448-f74a-72de-b25d-8666618f8c5a', imagePolicy: 'forbidden', type: 'text', search: true }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心生图方法
    generate
};
