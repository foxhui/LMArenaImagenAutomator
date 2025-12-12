/**
 * @fileoverview 任务队列管理模块
 * @description 负责请求队列、并发控制和心跳机制
 */

import { logger } from '../utils/logger.js';
import {
    sendJson,
    sendSse,
    sendSseDone,
    sendHeartbeat,
    sendApiError,
    buildChatCompletion,
    buildChatCompletionChunk
} from './http/respond.js';

/**
 * @typedef {object} TaskContext
 * @property {import('http').IncomingMessage} req - HTTP 请求对象
 * @property {import('http').ServerResponse} res - HTTP 响应对象
 * @property {string} prompt - 用户提示词
 * @property {string[]} imagePaths - 图片路径列表
 * @property {string|null} modelId - 模型 ID
 * @property {string|null} modelName - 模型名称
 * @property {string} id - 请求唯一标识
 * @property {boolean} isStreaming - 是否流式请求
 */

/**
 * @typedef {object} QueueConfig
 * @property {number} maxConcurrent - 最大并发数
 * @property {number} maxQueueSize - 最大队列大小
 * @property {string} keepaliveMode - 心跳模式 ('comment' | 'content')
 */

/**
 * @typedef {object} BrowserContext
 * @property {object} browser - Playwright 浏览器实例
 * @property {object} page - Playwright 页面实例
 * @property {object} config - 配置对象
 */

/**
 * 创建任务队列管理器
 * @param {QueueConfig} queueConfig - 队列配置
 * @param {object} callbacks - 回调函数
 * @param {Function} callbacks.initBrowser - 初始化浏览器函数
 * @param {Function} callbacks.generateImage - 生成图片函数
 * @param {object} callbacks.config - 配置对象
 * @returns {object} 队列管理器
 */
export function createQueueManager(queueConfig, callbacks) {
    const { maxConcurrent, maxQueueSize, keepaliveMode } = queueConfig;
    const { initBrowser, generateImage, config } = callbacks;

    /** @type {TaskContext[]} */
    const queue = [];

    /** @type {number} */
    let processingCount = 0;

    /** @type {BrowserContext|null} */
    let browserContext = null;

    /**
     * 清理任务临时文件
     * @param {TaskContext} task - 任务上下文
     */
    async function cleanupTask(task) {
        if (task?.imagePaths) {
            const fs = await import('fs');
            for (const p of task.imagePaths) {
                try { fs.unlinkSync(p); } catch (e) { /* ignore */ }
            }
        }
    }

    /**
     * 处理单个任务
     * @param {TaskContext} task - 任务上下文
     */
    async function processTask(task) {
        const { res, prompt, imagePaths, modelId, modelName, id, isStreaming } = task;

        logger.info('服务器', '[队列] 开始处理任务', { id, remaining: queue.length });

        // 启动心跳（流式请求）
        let heartbeatInterval = null;
        if (isStreaming) {
            heartbeatInterval = setInterval(() => {
                if (res.writableEnded) {
                    clearInterval(heartbeatInterval);
                    return;
                }
                sendHeartbeat(res, keepaliveMode, modelName);
            }, 3000);
        }

        try {
            // 确保浏览器已初始化
            if (!browserContext) {
                browserContext = await initBrowser(config);
            }

            // 调用核心生图逻辑
            const result = await generateImage(browserContext, prompt, imagePaths, modelId, { id });

            // 清除心跳
            if (heartbeatInterval) clearInterval(heartbeatInterval);

            // 处理结果
            let finalContent = '';

            if (result.error) {
                // 适配器层已归一化错误，直接构造错误响应
                finalContent = `[生成错误] ${result.error}`;
            } else if (result.image) {
                finalContent = `![generated](${result.image})`;
                logger.info('服务器', '图片已准备就绪 (Base64)', { id });
            } else {
                finalContent = result.text || '生成失败';
            }

            // 发送响应
            if (isStreaming) {
                const chunk = buildChatCompletionChunk(finalContent, modelName);
                sendSse(res, chunk);
                sendSseDone(res);
            } else {
                const response = buildChatCompletion(finalContent, modelName);
                sendJson(res, 200, response);
            }

        } catch (err) {
            // 清除心跳
            if (heartbeatInterval) clearInterval(heartbeatInterval);

            logger.error('服务器', '任务处理失败', { id, error: err.message });
            sendApiError(res, {
                code: ERROR_CODES.INTERNAL_ERROR,
                error: err.message,
                isStreaming
            });
        }
    }

    /**
     * 处理队列中的任务
     */
    async function processQueue() {
        // 如果正在处理的任务已满，或队列为空，则停止
        if (processingCount >= maxConcurrent || queue.length === 0) return;

        // 取出下一个任务
        const task = queue.shift();
        processingCount++;

        try {
            await processTask(task);
        } finally {
            // 清理临时文件
            cleanupTask(task);
            processingCount--;
            // 递归处理下一个任务
            processQueue();
        }
    }

    /**
     * 添加任务到队列
     * @param {TaskContext} task - 任务上下文
     */
    function addTask(task) {
        queue.push(task);
        processQueue();
    }

    /**
     * 获取当前队列状态
     * @returns {{queueLength: number, processing: number, total: number}}
     */
    function getStatus() {
        return {
            queueLength: queue.length,
            processing: processingCount,
            total: processingCount + queue.length
        };
    }

    /**
     * 检查是否可以接受新请求（非流式）
     * @returns {boolean}
     */
    function canAcceptNonStreaming() {
        return processingCount + queue.length < maxQueueSize;
    }

    /**
     * 初始化浏览器
     * @returns {Promise<BrowserContext>}
     */
    async function initializeBrowser() {
        browserContext = await initBrowser(config);
        return browserContext;
    }

    /**
     * 获取浏览器上下文
     * @returns {BrowserContext|null}
     */
    function getBrowserContext() {
        return browserContext;
    }

    return {
        addTask,
        getStatus,
        canAcceptNonStreaming,
        initializeBrowser,
        getBrowserContext,
        maxQueueSize
    };
}
