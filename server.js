/**
 * @fileoverview LMArena Image Automator 服务器入口
 * @description HTTP API 服务器，提供 OpenAI 兼容的图像生成接口
 *
 * 支持的端点：
 * - GET  /v1/models          - 获取可用模型列表
 * - GET  /v1/cookies         - 获取当前浏览器 Cookies
 * - POST /v1/chat/completions - 生成图像（OpenAI 兼容格式）
 *
 * 命令行参数：
 * - -xvfb  启用 Xvfb 虚拟显示器（仅 Linux）
 * - -vnc   启用 VNC 服务器（需配合 -xvfb 使用）
 * - -login 启动时打开登录页面
 */

import http from 'http';
import { getBackend } from './src/backend/index.js';
import { logger } from './src/utils/logger.js';
import { handleDisplayParams, createQueueManager, createRouter } from './src/server/index.js';

// ==================== 命令行参数处理 ====================

// 处理 Xvfb/VNC 参数（仅 Linux）
const displayResult = await handleDisplayParams();
if (displayResult === 'XVFB_REDIRECT') {
    // 已重定向到 Xvfb，阻止继续执行
    process.on('exit', () => { });
    await new Promise(() => { });
}

// ==================== 初始化配置 ====================

/**
 * 从统一后端获取配置和函数
 */
let backend;
try {
    backend = getBackend();
} catch (err) {
    logger.error('服务器', '配置加载失败', { error: err.message });
    logger.error('服务器', '请先初始化配置：复制 config.example.yaml 为 config.yaml');
    process.exit(1);
}

const {
    config,
    name: backendName,
    initBrowser,
    generateImage,
    TEMP_DIR,
    resolveModelId,
    getModels,
    getImagePolicy
} = backend;

/** @type {number} 服务器端口 */
const PORT = config.server?.port || 3000;

/** @type {string} 认证令牌 */
const AUTH_TOKEN = config.server?.auth;

/** @type {string} 心跳模式 */
const KEEPALIVE_MODE = config.server?.keepalive?.mode || 'comment';

/** @type {number} 最大并发数 */
const MAX_CONCURRENT = config.queue?.maxConcurrent || 1;

/** @type {number} 最大队列大小 */
const MAX_QUEUE_SIZE = config.queue?.maxQueueSize || 2;

/** @type {number} 图片数量限制 */
const IMAGE_LIMIT = config.queue?.imageLimit || 5;

// ==================== 创建服务组件 ====================

/**
 * 队列管理器：负责任务队列、并发控制和心跳机制
 */
const queueManager = createQueueManager(
    {
        maxConcurrent: MAX_CONCURRENT,
        maxQueueSize: MAX_QUEUE_SIZE,
        keepaliveMode: KEEPALIVE_MODE
    },
    {
        initBrowser,
        generateImage,
        config
    }
);

/**
 * 路由处理器：负责 API 路由分发和鉴权
 */
const handleRequest = createRouter({
    authToken: AUTH_TOKEN,
    backendName,
    getModels,
    resolveModelId,
    getImagePolicy,
    tempDir: TEMP_DIR,
    imageLimit: IMAGE_LIMIT,
    queueManager
});

// ==================== 启动服务器 ====================

/**
 * 启动 HTTP 服务器
 * @returns {Promise<void>}
 */
async function startServer() {
    // 预先启动浏览器
    try {
        await queueManager.initializeBrowser();
    } catch (err) {
        logger.error('服务器', '浏览器初始化失败', { error: err.message });
        process.exit(1);
    }

    // 创建并启动 HTTP 服务器
    const server = http.createServer(handleRequest);

    server.listen(PORT, () => {
        logger.info('服务器', `HTTP 服务器启动成功，监听端口 ${PORT}`);
        logger.info('服务器', `后端: ${backendName}，流式心跳模式: ${KEEPALIVE_MODE}`);
        logger.info('服务器', `最大并发: ${MAX_CONCURRENT}，最大队列: ${MAX_QUEUE_SIZE}，最大图片数量: ${IMAGE_LIMIT}`);
    });
}

// 启动服务器
startServer();
