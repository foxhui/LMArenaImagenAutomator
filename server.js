import http from 'http';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getBackend } from './lib/backend/index.js';
import { IMAGE_POLICY } from './lib/backend/models.js';
import { logger } from './lib/utils/logger.js';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import os from 'os';
import net from 'net';

// ==================== 命令行参数处理 ====================

/**
 * 检查命令是否存在
 * @param {string} cmd - 命令名称
 * @returns {boolean}
 */
function checkCommand(cmd) {
    const result = spawnSync('which', [cmd], { encoding: 'utf8' });
    return result.status === 0;
}

/**
 * 检查端口是否可用
 * @param {number} port - 端口号
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', () => {
            resolve(false);
        });

        server.once('listening', () => {
            server.close();
            resolve(true);
        });

        server.listen(port);
    });
}

/**
 * 查找可用的 VNC 端口
 * @param {number} startPort - 起始端口 (默认 5900)
 * @param {number} maxAttempts - 最大尝试次数 (默认 10)
 * @returns {Promise<number|null>}
 */
async function findAvailableVncPort(startPort = 5900, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    return null;
}

/**
 * 处理 Xvfb 和 VNC 启动参数（仅 Linux）
 */
async function handleDisplayParams() {
    const args = process.argv.slice(2);
    const hasXvfb = args.includes('-xvfb');
    const hasVnc = args.includes('-vnc');
    const isInXvfb = process.env.XVFB_RUNNING === 'true';

    // -vnc 必须和 -xvfb 并用（但如果已在 Xvfb 中运行则允许）
    if (hasVnc && !hasXvfb && !isInXvfb) {
        logger.error('服务器', '-vnc 参数必须和 -xvfb 参数一起使用');
        logger.error('服务器', '正确用法: node server.js -xvfb -vnc');
        process.exit(1);
    }

    // 非 Linux 系统检查
    if ((hasXvfb || hasVnc) && os.platform() !== 'linux') {
        logger.warn('服务器', '忽略参数: -xvfb 和 -vnc 参数仅在 Linux 系统上支持');
        return;
    }

    // 处理 -xvfb 参数（或已在 Xvfb 中运行）
    if ((hasXvfb || isInXvfb) && os.platform() === 'linux') {
        // 检查 xvfb-run 是否存在（仅在首次启动时需要）
        if (hasXvfb && !isInXvfb) {
            if (!checkCommand('xvfb-run')) {
                logger.error('服务器', '未找到 xvfb-run 命令');
                logger.error('服务器', '请先安装 Xvfb:');
                logger.error('服务器', ' - Ubuntu/Debian: sudo apt install xvfb');
                logger.error('服务器', ' - CentOS/RHEL:   sudo dnf install xorg-x11-server-Xvfb');
                process.exit(1);
            }
        }

        // 检查是否已在 Xvfb 中运行（通过环境变量判断）
        if (isInXvfb) {
            // 已在 Xvfb 中，继续正常启动
            logger.info('服务器', '已在 Xvfb 虚拟显示器中运行', { display: process.env.DISPLAY || ':99' });

            // 处理 VNC（如果需要）
            if (hasVnc) {
                if (!checkCommand('x11vnc')) {
                    logger.error('服务器', '未找到 x11vnc 命令');
                    logger.error('服务器', '请先安装 x11vnc:');
                    logger.error('服务器', ' - Ubuntu/Debian: sudo apt install x11vnc');
                    logger.error('服务器', ' - CentOS/RHEL:   sudo dnf install x11vnc');
                    process.exit(1);
                }

                const display = process.env.DISPLAY || ':99';

                // 自动查找可用端口 (从 5900 开始)
                logger.info('服务器', '正在查找可用的 VNC 端口...');
                const vncPort = await findAvailableVncPort(5900, 10);

                if (!vncPort) {
                    logger.error('服务器', '无法找到可用的 VNC 端口 (已尝试 5900-5909)');
                    process.exit(1);
                }

                logger.info('服务器', `正在启动 VNC 服务器 (端口 ${vncPort})...`);

                const vncProcess = spawn('x11vnc', [
                    '-display', display,
                    '-rfbport', vncPort.toString(),
                    '-localhost',
                    '-nopw',
                    '-once',
                    '-noxdamage',
                    '-ncache', '10',
                    '-forever'
                ], {
                    stdio: 'ignore',  // 忽略 VNC 的输出，避免混入日志
                    detached: false
                });

                vncProcess.on('error', (err) => {
                    logger.error('服务器', 'VNC 启动失败', { error: err.message });
                });

                // 处理进程退出信号
                process.on('SIGINT', () => {
                    vncProcess.kill('SIGTERM');
                    process.exit(0);
                });
                process.on('SIGTERM', () => {
                    vncProcess.kill('SIGTERM');
                    process.exit(0);
                });

                logger.info('服务器', 'VNC 服务器已成功启动');
                logger.warn('服务器', `VNC 连接端口: ${vncPort}`);
            }

            return;
        }

        // 需要在 Xvfb 中重启
        logger.info('服务器', '正在启动 Xvfb 虚拟显示器...');

        // 构建新的参数列表（移除 -xvfb，保留其他参数如 -vnc、-login 等）
        const newArgs = args.filter(arg => arg !== '-xvfb');

        // 使用 env 命令来确保环境变量被正确传递
        const xvfbArgs = [
            '--server-num=99',
            '--server-args=-ac -screen 0 1366x768x24',
            'env',
            'XVFB_RUNNING=true',
            'DISPLAY=:99',
            process.argv[0], // node 可执行文件
            process.argv[1], // server.js 路径
            ...newArgs
        ];

        const xvfbProcess = spawn('xvfb-run', xvfbArgs, {
            stdio: 'inherit'
        });

        xvfbProcess.on('error', (err) => {
            logger.error('服务器', 'Xvfb 启动失败', { error: err.message });
            process.exit(1);
        });

        xvfbProcess.on('exit', (code) => {
            process.exit(code || 0);
        });

        // 处理父进程退出信号
        process.on('SIGINT', () => {
            xvfbProcess.kill('SIGTERM');
        });
        process.on('SIGTERM', () => {
            xvfbProcess.kill('SIGTERM');
        });

        // 不再继续执行后续代码
        return 'XVFB_REDIRECT';
    }
}

// 执行参数处理
const displayResult = await handleDisplayParams();
if (displayResult === 'XVFB_REDIRECT') {
    // 已经重定向到 Xvfb，不再继续执行
    // 这个进程将等待子进程退出
    // eslint-disable-next-line no-process-exit
    process.on('exit', () => { });
    // 阻止继续执行
    await new Promise(() => { });
}

// ==================== 服务器主逻辑 ====================

// 使用统一后端获取配置和函数
const {
    config,
    name,
    initBrowser,
    generateImage,
    TEMP_DIR,
    resolveModelId,
    getModels,
    getImagePolicy
} = getBackend();

const PORT = config.server.port || 3000;
const AUTH_TOKEN = config.server.auth;
const KEEPALIVE_ENABLED = config.server.keepalive?.enable ?? true;
const KEEPALIVE_MODE = config.server.keepalive?.mode || 'comment';

// --- 全局状态 ---
let browserContext = null; // 浏览器上下文 {browser, page, client, width, height}
const queue = []; // 请求队列
let processingCount = 0; // 当前正在处理的任务数
const MAX_CONCURRENT = config.queue?.maxConcurrent || 1; // 从配置读取
const MAX_QUEUE_SIZE = config.queue?.maxQueueSize || 2; // 从配置读取
const IMAGE_LIMIT = config.queue?.imageLimit || 5; // 图片数量上限

/**
 * 处理队列中的任务
 */
async function processQueue() {
    // 如果正在处理的任务已满,或队列为空,则停止
    if (processingCount >= MAX_CONCURRENT || queue.length === 0) return;

    // 取出下一个任务
    const task = queue.shift();
    processingCount++;

    try {
        const { req, res, prompt, imagePaths, modelId, modelName, id, isStreaming } = task;
        logger.info('服务器', '[队列] 开始处理任务', { id, remaining: queue.length });

        // 如果是流式，启动心跳
        let heartbeatInterval = null;
        if (isStreaming) {
            heartbeatInterval = setInterval(() => {
                if (res.writableEnded) {
                    clearInterval(heartbeatInterval);
                    return;
                }
                // 发送心跳包
                if (KEEPALIVE_MODE === 'comment') {
                    res.write(`:keepalive\n\n`);
                } else {
                    // content 模式：发送空 delta
                    const chunk = {
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: modelName || 'default-model',
                        choices: [{
                            index: 0,
                            delta: { content: '' },
                            finish_reason: null
                        }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
            }, 3000);
        }

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
            // 特殊错误处理:reCAPTCHA
            if (result.error === 'recaptcha validation failed') {
                if (isStreaming) {
                    res.write(`data: ${JSON.stringify({ error: 'recaptcha validation failed' })}\n\n`);
                    res.write(`data: [DONE]\n\n`);
                    res.end();
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'recaptcha validation failed' }));
                }
                return;
            }
            finalContent = `[生成错误] ${result.error}`;
        } else if (result.image) {
            try {
                // result.image 已经是 "data:image/png;base64,..." 格式
                // 构造 Markdown 图片展示 (Data URI)
                finalContent = `![generated](${result.image})`;
                logger.info('服务器', '图片已准备就绪 (Base64)', { id });
            } catch (e) {
                logger.error('服务器', '图片处理失败', { id, error: e.message });
                finalContent = `[图片处理失败] ${e.message}`;
            }
        } else {
            finalContent = result.text || '生成失败';
        }

        // 发送响应
        if (isStreaming) {
            // 流式响应
            const chunk = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: modelName || 'default-model',
                choices: [{
                    index: 0,
                    delta: { content: finalContent },
                    finish_reason: 'stop'
                }]
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
        } else {
            // 非流式响应
            const response = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: modelName || 'default-model',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: finalContent
                    },
                    finish_reason: 'stop'
                }]
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        }

    } catch (err) {
        logger.error('服务器', '任务处理失败', { id: task.id, error: err.message });
        if (task.isStreaming) {
            if (!task.res.writableEnded) {
                task.res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                task.res.write(`data: [DONE]\n\n`);
                task.res.end();
            }
        } else {
            if (!task.res.writableEnded) {
                task.res.writeHead(500, { 'Content-Type': 'application/json' });
                task.res.end(JSON.stringify({ error: err.message }));
            }
        }
    } finally {
        // 无论成功失败，都尝试清理临时图片
        if (task && task.imagePaths) {
            for (const p of task.imagePaths) {
                try { fs.unlinkSync(p); } catch (e) { }
            }
        }
        processingCount--;
        // 递归处理下一个任务
        processQueue();
    }
}

/**
 * 启动 HTTP 服务器
 */
async function startServer() {
    // 预先启动浏览器
    try {
        browserContext = await initBrowser(config);
    } catch (err) {
        logger.error('服务器', '浏览器初始化失败', { error: err.message });
        process.exit(1);
    }

    const server = http.createServer(async (req, res) => {
        // 为每个请求生成唯一 ID
        const id = crypto.randomUUID().slice(0, 8);

        // --- 鉴权中间件 ---
        const authHeader = req.headers['authorization'];
        if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        // --- 路由分发 ---
        // 1. 模型列表接口
        if (req.method === 'GET' && req.url === '/v1/models') {
            const models = getModels();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(models));
            return;
        }

        // 2. 获取 Cookies 接口
        if (req.method === 'GET' && req.url === '/v1/cookies') {
            try {
                if (!browserContext || !browserContext.page) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Browser not initialized' }));
                    return;
                }
                const context = browserContext.page.context();
                const cookies = await context.cookies();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ cookies }));
            } catch (err) {
                logger.error('服务器', '获取 Cookies 失败', { id, error: err.message });
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // 3. 聊天补全接口
        if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                try {
                    const body = Buffer.concat(chunks).toString();
                    const data = JSON.parse(body);
                    const messages = data.messages;
                    const isStreaming = data.stream === true;

                    // Stream 参数验证
                    if (KEEPALIVE_ENABLED && !isStreaming) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Stream mode is required when keepalive is enabled. Please set "stream": true in your request.' }));
                        return;
                    }

                    // 限流检查（仅在未开启 keepalive 时限制）
                    if (!KEEPALIVE_ENABLED && processingCount + queue.length >= MAX_CONCURRENT + MAX_QUEUE_SIZE) {
                        logger.warn('服务器', '请求过多，已拒绝 (最大队列限制)', { id });
                        res.writeHead(429, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Too Many Requests. Server is busy.' }));
                        return;
                    }

                    // 如果是流式，设置 SSE 响应头
                    if (isStreaming) {
                        res.writeHead(200, {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive'
                        });
                    }

                    if (!messages || messages.length === 0) {
                        if (isStreaming) {
                            res.write(`data: ${JSON.stringify({ error: 'No messages' })}\n\n`);
                            res.write(`data: [DONE]\n\n`);
                            res.end();
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'No messages' }));
                        }
                        return;
                    }

                    // 筛选用户消息
                    const userMessages = messages.filter(m => m.role === 'user');
                    if (userMessages.length === 0) {
                        if (isStreaming) {
                            res.write(`data: ${JSON.stringify({ error: 'No user messages' })}\n\n`);
                            res.write(`data: [DONE]\n\n`);
                            res.end();
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'No user messages' }));
                        }
                        return;
                    }
                    const lastMessage = userMessages[userMessages.length - 1];

                    let prompt = '';
                    const imagePaths = [];
                    let imageCount = 0;

                    // 解析内容 (拼接文本 + 处理图片)
                    if (Array.isArray(lastMessage.content)) {
                        for (const item of lastMessage.content) {
                            if (item.type === 'text') {
                                prompt += item.text + ' ';
                            } else if (item.type === 'image_url' && item.image_url && item.image_url.url) {
                                imageCount++;

                                // 逻辑:
                                // 1. 如果配置限制 <= 10 (浏览器硬限制), 则严格执行, 超过报错
                                // 2. 如果配置限制 > 10, 则视为用户想"尽力而为", 自动截断到 10 张, 忽略多余的

                                if (IMAGE_LIMIT <= 10) {
                                    if (imageCount > IMAGE_LIMIT) {
                                        const errorMsg = `Too many images. Maximum ${IMAGE_LIMIT} images allowed.`;
                                        logger.warn('server', errorMsg, { id });
                                        if (isStreaming) {
                                            res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
                                            res.write(`data: [DONE]\n\n`);
                                            res.end();
                                        } else {
                                            res.writeHead(400, { 'Content-Type': 'application/json' });
                                            res.end(JSON.stringify({ error: errorMsg }));
                                        }
                                        return;
                                    }
                                } else {
                                    // IMAGE_LIMIT > 10
                                    if (imageCount > 10) {
                                        // 超过浏览器硬限制, 忽略该图片
                                        continue;
                                    }
                                }

                                const url = item.image_url.url;
                                if (url.startsWith('data:image')) {
                                    const matches = url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                                    if (matches && matches.length === 3) {
                                        const buffer = Buffer.from(matches[2], 'base64');
                                        // 压缩图片
                                        const processedBuffer = await sharp(buffer)
                                            .jpeg({ quality: 90 })
                                            .toBuffer();

                                        const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                                        const filePath = path.join(TEMP_DIR, filename);
                                        fs.writeFileSync(filePath, processedBuffer);
                                        imagePaths.push(filePath);
                                    }
                                }
                            }
                        }
                    } else {
                        prompt = lastMessage.content; // 回落保留
                    }

                    prompt = prompt.trim();

                    // 解析模型参数
                    let modelId = null;
                    if (data.model) {
                        modelId = resolveModelId(data.model);
                        if (modelId) {
                            logger.info('服务器', `触发模型: ${data.model} (${modelId})`, { id });
                        } else {
                            const errorMsg = `Invalid model for backend ${name}: ${data.model}`;
                            logger.warn('服务器', errorMsg, { id });
                            if (isStreaming) {
                                res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
                                res.write(`data: [DONE]\n\n`);
                                res.end();
                            } else {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: errorMsg }));
                            }
                            return;
                        }
                    } else {
                        logger.info('服务器', '未指定模型，使用网页默认', { id });
                    }

                    // 图片策略校验
                    const hasImage = imagePaths.length > 0;
                    const policy = data.model ? getImagePolicy(data.model) : IMAGE_POLICY.OPTIONAL;

                    if (policy === IMAGE_POLICY.REQUIRED && !hasImage) {
                        const errorMsg = `Model ${data.model} requires a reference image.`;
                        logger.warn('服务器', errorMsg, { id });
                        if (isStreaming) {
                            res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
                            res.write(`data: [DONE]\n\n`);
                            res.end();
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: errorMsg }));
                        }
                        return;
                    }

                    if (policy === IMAGE_POLICY.FORBIDDEN && hasImage) {
                        const errorMsg = `Model ${data.model} does not accept images.`;
                        logger.warn('服务器', errorMsg, { id });
                        if (isStreaming) {
                            res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
                            res.write(`data: [DONE]\n\n`);
                            res.end();
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: errorMsg }));
                        }
                        return;
                    }

                    logger.info('服务器', `[队列] 请求入队: ${prompt.slice(0, 10)}...`, { id, images: imagePaths.length });

                    // 将任务加入队列
                    queue.push({ req, res, prompt, imagePaths, modelId, modelName: data.model || null, id, isStreaming });

                    // 触发队列处理
                    processQueue();

                } catch (err) {
                    logger.error('服务器', '服务器处理失败', { id, error: err.message });
                    if (!res.writableEnded) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(PORT, () => {
        logger.info('服务器', `HTTP 服务器启动成功，监听端口 ${PORT}`);
        logger.info('服务器', `流式保活: ${KEEPALIVE_ENABLED ? '已启用 (' + KEEPALIVE_MODE + ' 模式)' : '已禁用'}`);
        logger.info('服务器', `最大队列: ${MAX_QUEUE_SIZE}，最大图片数量: ${IMAGE_LIMIT}`);
    });
}

startServer();
