/**
 * @fileoverview 请求解析模块
 * @description 负责解析聊天请求、提取提示词和处理图片
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { IMAGE_POLICY } from '../backend/models.js';
import { ERROR_CODES, getErrorMessage } from './errors.js';

/**
 * 构造解析错误结果
 * @param {string} code - 错误码
 * @param {string} [customMessage] - 自定义消息（可选，用于包含动态参数）
 * @returns {{success: false, error: {code: string, error: string}}}
 */
function parseError(code, customMessage) {
    return {
        success: false,
        error: {
            code,
            error: customMessage || getErrorMessage(code)
        }
    };
}

/**
 * @typedef {object} ParsedRequest
 * @property {string} prompt - 提取的提示词
 * @property {string[]} imagePaths - 图片临时文件路径
 * @property {string|null} modelId - 解析后的模型 ID
 * @property {string|null} modelName - 原始模型名称
 * @property {boolean} isStreaming - 是否流式请求
 */

/**
 * @typedef {object} ParseError
 * @property {string} code - 错误码
 * @property {string} error - 错误消息
 */

/**
 * @typedef {object} ParseResult
 * @property {boolean} success - 是否解析成功
 * @property {ParsedRequest} [data] - 解析结果（成功时）
 * @property {ParseError} [error] - 错误信息（失败时）
 */

/**
 * 解析聊天请求
 * @param {object} data - 请求体数据
 * @param {object} options - 解析选项
 * @param {string} options.tempDir - 临时目录路径
 * @param {number} options.imageLimit - 图片数量限制
 * @param {string} options.backendName - 后端名称
 * @param {Function} options.resolveModelId - 模型 ID 解析函数
 * @param {Function} options.getImagePolicy - 获取图片策略函数
 * @param {string} options.requestId - 请求 ID
 * @param {Function} options.logger - 日志函数
 * @returns {Promise<ParseResult>} 解析结果
 */
export async function parseRequest(data, options) {
    const {
        tempDir,
        imageLimit,
        backendName,
        resolveModelId,
        getImagePolicy,
        requestId,
        logger
    } = options;

    const messages = data.messages;
    const isStreaming = data.stream === true;

    // 验证 messages
    if (!messages || messages.length === 0) {
        return parseError(ERROR_CODES.NO_MESSAGES);
    }

    // 筛选用户消息
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
        return parseError(ERROR_CODES.NO_USER_MESSAGES);
    }

    const lastMessage = userMessages[userMessages.length - 1];

    let prompt = '';
    const imagePaths = [];
    let imageCount = 0;

    // 解析内容
    if (Array.isArray(lastMessage.content)) {
        for (const item of lastMessage.content) {
            if (item.type === 'text') {
                prompt += item.text + ' ';
            } else if (item.type === 'image_url' && item.image_url?.url) {
                imageCount++;

                // 图片数量检查
                if (imageLimit <= 10) {
                    if (imageCount > imageLimit) {
                        return parseError(ERROR_CODES.TOO_MANY_IMAGES, `图片数量超过限制（最大 ${imageLimit} 张）`);
                    }
                } else {
                    // imageLimit > 10：超过浏览器硬限制时忽略
                    if (imageCount > 10) {
                        continue;
                    }
                }

                // 处理 data URL
                const url = item.image_url.url;
                if (url.startsWith('data:image')) {
                    const imagePath = await saveBase64Image(url, tempDir);
                    if (imagePath) {
                        imagePaths.push(imagePath);
                    }
                }
            }
        }
    } else {
        prompt = lastMessage.content;
    }

    prompt = prompt.trim();

    // 解析模型参数
    let modelId = null;
    if (data.model) {
        modelId = resolveModelId(data.model);
        if (modelId) {
            logger.info('服务器', `触发模型: ${data.model} (${modelId})`, { id: requestId });
        } else {
            return parseError(ERROR_CODES.INVALID_MODEL, `模型无效/后端 ${backendName} 不支持: ${data.model}`);
        }
    } else {
        logger.info('服务器', '未指定模型，使用网页默认', { id: requestId });
    }

    // 图片策略校验
    const hasImage = imagePaths.length > 0;
    const policy = data.model ? getImagePolicy(data.model) : IMAGE_POLICY.OPTIONAL;

    if (policy === IMAGE_POLICY.REQUIRED && !hasImage) {
        return parseError(ERROR_CODES.IMAGE_REQUIRED, `模型 ${data.model} 需要参考图`);
    }

    if (policy === IMAGE_POLICY.FORBIDDEN && hasImage) {
        return parseError(ERROR_CODES.IMAGE_FORBIDDEN, `模型 ${data.model} 不支持图片输入`);
    }

    return {
        success: true,
        data: {
            prompt,
            imagePaths,
            modelId,
            modelName: data.model || null,
            isStreaming
        }
    };
}

/**
 * 保存 Base64 图片到临时文件
 * @param {string} dataUrl - data URL 格式的图片
 * @param {string} tempDir - 临时目录
 * @returns {Promise<string|null>} 保存的文件路径，失败返回 null
 */
async function saveBase64Image(dataUrl, tempDir) {
    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        return null;
    }

    try {
        const buffer = Buffer.from(matches[2], 'base64');
        // 压缩图片
        const processedBuffer = await sharp(buffer)
            .jpeg({ quality: 90 })
            .toBuffer();

        const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, processedBuffer);
        return filePath;
    } catch (e) {
        return null;
    }
}
