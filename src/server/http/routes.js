/**
 * @fileoverview HTTP 路由分发模块
 * @description 处理 API 路由分发和请求鉴权
 */

import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { ERROR_CODES } from '../errors.js';
import { sendJson, sendApiError } from './respond.js';
import { parseRequest } from '../parseChat.js';

/**
 * 鉴权检查
 * @param {import('http').IncomingMessage} req - HTTP 请求
 * @param {string} authToken - 有效的认证令牌
 * @returns {boolean} 是否通过鉴权
 */
function checkAuth(req, authToken) {
    const authHeader = req.headers['authorization'];
    return authHeader === `Bearer ${authToken}`;
}

/**
 * 创建路由处理器
 * @param {object} context - 路由上下文
 * @param {string} context.authToken - 认证令牌
 * @param {string} context.backendName - 后端名称
 * @param {Function} context.getModels - 获取模型列表函数
 * @param {Function} context.resolveModelId - 解析模型 ID 函数
 * @param {Function} context.getImagePolicy - 获取图片策略函数
 * @param {string} context.tempDir - 临时目录
 * @param {number} context.imageLimit - 图片数量限制
 * @param {object} context.queueManager - 队列管理器
 * @returns {Function} 请求处理函数
 */
export function createRouter(context) {
    const {
        authToken,
        backendName,
        getModels,
        resolveModelId,
        getImagePolicy,
        tempDir,
        imageLimit,
        queueManager
    } = context;

    /**
     * 处理 GET /v1/models
     * @param {import('http').ServerResponse} res - HTTP 响应
     */
    function handleModels(res) {
        const models = getModels();
        sendJson(res, 200, models);
    }

    /**
     * 处理 GET /v1/cookies
     * @param {import('http').ServerResponse} res - HTTP 响应
     * @param {string} requestId - 请求 ID
     */
    async function handleCookies(res, requestId) {
        const browserContext = queueManager.getBrowserContext();

        if (!browserContext?.page) {
            sendApiError(res, { code: ERROR_CODES.BROWSER_NOT_INITIALIZED });
            return;
        }

        try {
            const context = browserContext.page.context();
            const cookies = await context.cookies();
            sendJson(res, 200, { cookies });
        } catch (err) {
            logger.error('服务器', '获取 Cookies 失败', { id: requestId, error: err.message });
            sendApiError(res, {
                code: ERROR_CODES.INTERNAL_ERROR,
                error: err.message
            });
        }
    }

    /**
     * 处理 POST /v1/chat/completions
     * @param {import('http').IncomingMessage} req - HTTP 请求
     * @param {import('http').ServerResponse} res - HTTP 响应
     * @param {string} requestId - 请求 ID
     */
    async function handleChatCompletions(req, res, requestId) {
        // 读取请求体
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }

        try {
            const body = Buffer.concat(chunks).toString();
            const data = JSON.parse(body);
            const isStreaming = data.stream === true;

            // 限流检查：非流式请求在队列满时拒绝
            if (!isStreaming && !queueManager.canAcceptNonStreaming()) {
                const status = queueManager.getStatus();
                logger.warn('服务器', '非流式请求被拒绝 (队列已满)', { id: requestId, queueSize: status.total });
                sendApiError(res, {
                    code: ERROR_CODES.SERVER_BUSY,
                    error: `服务器繁忙（队列: ${status.total}/${queueManager.maxQueueSize}）。请使用流式模式 (stream: true) 或稍后重试。`
                });
                return;
            }

            // 设置 SSE 响应头（流式请求）
            if (isStreaming) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
            }

            // 解析请求
            const parseResult = await parseRequest(data, {
                tempDir,
                imageLimit,
                backendName,
                resolveModelId,
                getImagePolicy,
                requestId,
                logger
            });

            if (!parseResult.success) {
                sendApiError(res, {
                    code: parseResult.error.code,
                    error: parseResult.error.error,
                    isStreaming
                });
                return;
            }

            const { prompt, imagePaths, modelId, modelName } = parseResult.data;

            logger.info('服务器', `[队列] 请求入队: ${prompt.slice(0, 10)}...`, { id: requestId, images: imagePaths.length });

            // 将任务加入队列
            queueManager.addTask({
                req,
                res,
                prompt,
                imagePaths,
                modelId,
                modelName,
                id: requestId,
                isStreaming
            });

        } catch (err) {
            logger.error('服务器', '请求处理失败', { id: requestId, error: err.message });
            sendApiError(res, {
                code: ERROR_CODES.INTERNAL_ERROR,
                error: err.message
            });
        }
    }

    /**
     * 主路由处理函数
     * @param {import('http').IncomingMessage} req - HTTP 请求
     * @param {import('http').ServerResponse} res - HTTP 响应
     */
    return async function handleRequest(req, res) {
        // 生成请求 ID
        const requestId = crypto.randomUUID().slice(0, 8);

        // 鉴权检查
        if (!checkAuth(req, authToken)) {
            sendApiError(res, { code: ERROR_CODES.UNAUTHORIZED });
            return;
        }

        // 路由分发
        if (req.method === 'GET' && req.url === '/v1/models') {
            handleModels(res);
        } else if (req.method === 'GET' && req.url === '/v1/cookies') {
            await handleCookies(res, requestId);
        } else if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
            await handleChatCompletions(req, res, requestId);
        } else {
            res.writeHead(404);
            res.end();
        }
    };
}
