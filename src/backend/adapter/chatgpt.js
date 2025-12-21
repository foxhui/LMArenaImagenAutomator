/**
 * @fileoverview ChatGPT 图片生成适配器
 */

import {
    sleep,
    safeClick,
    uploadFilesViaChooser
} from '../engine/utils.js';
import {
    fillPrompt,
    normalizePageError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck,
    waitApiResponse,
    useContextDownload
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://chatgpt.com/images/';
const INPUT_SELECTOR = '.ProseMirror';

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
    const sendBtnLocator = page.getByRole('button', { name: 'Send prompt' });

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        await waitForInput(page, INPUT_SELECTOR, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片
        if (imgPaths && imgPaths.length > 0) {
            const expectedUploads = imgPaths.length;
            let uploadedCount = 0;
            let processedCount = 0;

            logger.debug('适配器', '点击添加文件按钮...', meta);
            const addFilesBtn = page.getByRole('button', { name: 'Add files and more' });

            await uploadFilesViaChooser(page, addFilesBtn, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    if (response.status() === 200) {
                        // 上传请求
                        if (url.includes('backend-api/files') && !url.includes('process_upload_stream')) {
                            uploadedCount++;
                            logger.debug('适配器', `图片上传进度: ${uploadedCount}/${expectedUploads}`, meta);
                            return false;
                        }
                        // 处理完成请求
                        if (url.includes('backend-api/files/process_upload_stream')) {
                            processedCount++;
                            logger.info('适配器', `图片处理进度: ${processedCount}/${expectedUploads}`, meta);

                            if (processedCount >= expectedUploads) {
                                return true;
                            }
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

        // 4. 点击发送
        logger.debug('适配器', '点击发送...', meta);
        await safeClick(page, sendBtnLocator, { bias: 'button' });

        logger.info('适配器', '等待生成结果...', meta);

        // 5. 等待 conversation API 返回
        let conversationResponse;
        try {
            conversationResponse = await waitApiResponse(page, {
                urlMatch: 'backend-api/f/conversation',
                method: 'POST',
                timeout: 180000,  // 图片生成可能较慢
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 检查响应状态
        if (conversationResponse.status() !== 200) {
            logger.error('适配器', `API 返回错误: HTTP ${conversationResponse.status()}`, meta);
            return { error: `API 返回错误: HTTP ${conversationResponse.status()}` };
        }

        logger.info('适配器', '生成中，等待图片就绪...', meta);

        // 6. 监听文件状态接口，等待图片生成完成
        // 通过 file_name 是否包含 .part 判断是否生成完成
        let downloadUrl = null;
        let fileName = null;

        try {
            await page.waitForResponse(async (response) => {
                const url = response.url();
                if (!url.includes('backend-api/files/download/file_')) return false;
                if (response.status() !== 200) return false;

                try {
                    const json = await response.json();
                    const fn = json.file_name;
                    const dl = json.download_url;

                    // 检查是否生成完成：
                    // 1. 必须有 file_name
                    // 2. file_name 不能包含 .part（表示中间状态）
                    // 3. 必须有 download_url
                    if (fn && !fn.includes('.part') && dl) {
                        fileName = fn;
                        downloadUrl = dl;
                        logger.info('适配器', `图片生成完成: ${fn}`, meta);
                        return true;
                    } else {
                        logger.debug('适配器', `图片生成中: ${fn || '无文件名'}`, meta);
                        return false;
                    }
                } catch {
                    return false;
                }
            }, { timeout: 120000 });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        if (!downloadUrl) {
            logger.error('适配器', '未获取到图片下载链接', meta);
            return { error: '未获取到图片下载链接' };
        }

        logger.info('适配器', '正在下载图片...', meta);

        // 7. 使用 useContextDownload 下载图片
        const result = await useContextDownload(downloadUrl, page);
        if (result.error) {
            logger.error('适配器', result.error, meta);
            return result;
        }

        logger.info('适配器', '已获取图片，任务完成', meta);
        return result;

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
    id: 'chatgpt',
    displayName: 'ChatGPT (图片生成)',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'gpt-image-1', imagePolicy: 'optional' }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心生图方法
    generate
};
