/**
 * @fileoverview LMArena Image Automator 服务器入口
 * @description HTTP API 服务器，提供 OpenAI 兼容的图像生成接口
 *
 * 支持的端点：
 * - GET  /v1/models          - 获取可用模型列表
 * - GET  /v1/cookies         - 获取当前浏览器 Cookies
 * - POST /v1/chat/completions - 生成图像（OpenAI 兼容格式）
 *
 * 启动方式：
 * - 通过 supervisor.js 启动（推荐，支持自动重启和 Xvfb 管理）
 * - 直接运行 node server.js
 *
 * 命令行参数：
 * - -login 启动时打开登录页面
 */

import http from 'http';

// ==================== 启动前自检 ====================
import { runPreflight } from '../utils/preflight.js';
runPreflight();
// ==================== 加载其他依赖 ====================
const { getBackend } = await import('../backend/index.js');
const { logger } = await import('../utils/logger.js');
const { createQueueManager, createGlobalRouter } = await import('./index.js');
const { isUnderSupervisor } = await import('../utils/ipc.js');

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
    generate,
    TEMP_DIR,
    resolveModelId,
    getModels,
    getImagePolicy,
    getModelType
} = backend;

/** @type {number} 服务器端口 */
const PORT = config.server?.port || 3000;

/** @type {string} 认证令牌 */
const AUTH_TOKEN = config.server?.auth;

/** @type {string} 心跳模式 */
const KEEPALIVE_MODE = config.server?.keepalive?.mode || 'comment';

/** @type {number} 最大并发数 */
const MAX_CONCURRENT = config.queue?.maxConcurrent || 1;

/** @type {number} 队列缓冲区（0 表示不限制非流式） */
const QUEUE_BUFFER = config.queue?.queueBuffer ?? 2;

/** @type {number} 图片数量限制 */
const IMAGE_LIMIT = config.queue?.imageLimit || 5;

// ==================== 创建服务组件 ====================

/**
 * 队列管理器：负责任务队列、并发控制和心跳机制
 */
const queueManager = createQueueManager(
    {
        maxConcurrent: MAX_CONCURRENT,
        queueBuffer: QUEUE_BUFFER,
        keepaliveMode: KEEPALIVE_MODE
    },
    {
        initBrowser,
        generate,
        config,
        navigateToMonitor: backend.navigateToMonitor
            ? () => backend.navigateToMonitor()
            : null,
        getCookies: backend.getCookies
            ? (workerName, domain) => backend.getCookies(workerName, domain)
            : null
    }
);

// ==================== 创建路由 ====================

/**
 * 检测是否为登录模式
 */
const isLoginMode = process.argv.some(arg => arg.startsWith('-login'));

/**
 * 安全模式状态
 * 当 Pool 初始化失败时进入安全模式，此时：
 * - HTTP 服务器正常启动
 * - Admin API 和 WebUI 可用
 * - OpenAI API 返回 503
 */
let safeMode = false;
let safeModeReason = null;

const handleRequest = createGlobalRouter({
    authToken: AUTH_TOKEN,
    backendName,
    getModels,
    resolveModelId,
    getImagePolicy,
    getModelType,
    tempDir: TEMP_DIR,
    imageLimit: IMAGE_LIMIT,
    queueManager,
    config,
    loginMode: isLoginMode,
    getSafeMode: () => ({ enabled: safeMode, reason: safeModeReason })
});

// ==================== 启动服务器 ====================

/**
 * 启动 HTTP 服务器
 * @returns {Promise<void>}
 */
async function startServer() {
    // 登录模式提示
    if (isLoginMode) {
        logger.info('服务器', '登录模式已就绪，请在浏览器中完成登录操作');
        logger.info('服务器', '完成后可直接关闭浏览器窗口或按 Ctrl+C 退出');
    }

    // 预先启动工作池（失败时进入安全模式）
    try {
        await queueManager.initializePool();
    } catch (err) {
        logger.error('服务器', '工作池初始化失败', { error: err.message });
        logger.warn('服务器', '进入安全模式：WebUI 和 Admin API 可用，OpenAI API 不可用');
        logger.warn('服务器', '请通过 配置文件或者 WebUI 修改正确的配置后重启服务');
        safeMode = true;
        safeModeReason = err.message;
    }

    // 创建并启动 HTTP 服务器
    const server = http.createServer(handleRequest);

    // 处理 WebSocket 升级请求（VNC 代理）
    server.on('upgrade', async (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // 只处理 /admin/vnc 路径
        if (url.pathname === '/admin/vnc') {
            const { handleVncUpgrade } = await import('./api/admin/vncProxy.js');
            await handleVncUpgrade(req, socket, head, AUTH_TOKEN);
        } else {
            socket.destroy();
        }
    });

    server.listen(PORT, () => {
        const mode = isUnderSupervisor() ? 'Supervisor 托管' : '独立运行';
        const modeExtra = isLoginMode ? ' (登录模式)' : '';
        logger.info('服务器', `HTTP 服务器已启动，端口: ${PORT}${modeExtra}`);
        logger.info('服务器', `运行模式: ${mode}`);
        if (!isLoginMode) {
            logger.info('服务器', `流式心跳模式: ${KEEPALIVE_MODE}`);
            logger.info('服务器', `最大并发: ${MAX_CONCURRENT}，队列缓冲: ${QUEUE_BUFFER}，最大图片数量: ${IMAGE_LIMIT}`);
        }
    });
}

// 启动服务器
startServer();
