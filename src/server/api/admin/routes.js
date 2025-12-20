/**
 * @fileoverview Admin API 路由模块
 * @description 提供管理接口，包括系统状态、配置管理、适配器元数据等
 */

import { sendJson, sendApiError } from '../../respond.js';
import { ERROR_CODES } from '../../errors.js';
import { logger } from '../../../utils/logger.js';
import {
    getSystemStatus,
    getDataFolders,
    deleteDataFolders,
    clearTempFiles
} from '../../../utils/systemInfo.js';
import {
    getServerConfig,
    saveServerConfig,
    getBrowserConfig,
    saveBrowserConfig,
    getQueueConfig,
    saveQueueConfig,
    getInstancesConfig,
    saveInstancesConfig,
    getAdaptersConfig,
    saveAdaptersConfig,
    getPoolConfig,
    savePoolConfig
} from '../../../config/manager.js';
import {
    validateServerConfig,
    validateBrowserConfig,
    validateInstancesConfig,
    validatePoolConfig,
    validateAdaptersConfig
} from '../../../config/validator.js';
import { registry } from '../../../backend/registry.js';
import { sendRestartSignal, sendStopSignal, isUnderSupervisor, getVncInfo } from '../../../utils/ipc.js';

/**
 * 读取请求体
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<object>}
 */
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString();
    return body ? JSON.parse(body) : {};
}

/**
 * 创建 Admin 路由处理器
 * @param {object} context - 路由上下文
 * @param {object} context.config - 完整配置对象
 * @param {object} context.queueManager - 队列管理器
 * @param {string} context.tempDir - 临时目录
 * @returns {Function} Admin 路由处理函数
 */
export function createAdminRouter(context) {
    const { config, queueManager, tempDir, getSafeMode } = context;

    /**
     * Admin 路由处理函数
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @param {string} pathname - 去除 /admin 前缀后的路径
     */
    return async function handleAdminRequest(req, res, pathname) {
        const method = req.method;

        try {
            // ==================== 系统管理 ====================

            // GET /admin/status - 系统状态
            if (method === 'GET' && pathname === '/status') {
                const status = getSystemStatus();
                const safeMode = getSafeMode?.() || { enabled: false, reason: null };
                sendJson(res, 200, { ...status, safeMode });
                return;
            }

            // POST /admin/restart - 重启服务
            if (method === 'POST' && pathname === '/restart') {
                // 解析请求体获取重启参数
                let loginMode = null;
                let workerName = null;
                try {
                    const body = await readBody(req);
                    loginMode = body.loginMode || null;
                    workerName = body.workerName || null;
                } catch { /* 无请求体时使用默认值 */ }

                const modeDesc = loginMode
                    ? (workerName ? `登录模式 (${workerName})` : '登录模式')
                    : '普通模式';
                sendJson(res, 200, { success: true, message: `服务正在以${modeDesc}重启...` });
                logger.info('管理器', `收到重启请求: ${modeDesc}`);

                setTimeout(async () => {
                    // 构建启动参数（仅登录模式相关）
                    const extraArgs = [];
                    if (loginMode) {
                        extraArgs.push(workerName ? `-login=${workerName}` : '-login');
                    }

                    if (isUnderSupervisor()) {
                        // Supervisor 模式：通过 IPC 发送带参数的重启信号
                        const sent = await sendRestartSignal(extraArgs);
                        if (!sent) {
                            logger.warn('管理器', 'IPC 重启信号发送失败，尝试自重启');
                            // 降级到自重启
                            const { spawn } = await import('child_process');
                            const newArgs = process.argv.slice(1).filter(arg => !arg.startsWith('-login'));
                            newArgs.push(...extraArgs);
                            const child = spawn(process.execPath, newArgs, {
                                cwd: process.cwd(),
                                detached: true,
                                stdio: 'ignore',
                                env: process.env
                            });
                            child.unref();
                            setTimeout(() => process.exit(0), 500);
                        }
                    } else {
                        // 独立模式：使用子进程自重启
                        const { spawn } = await import('child_process');
                        const newArgs = process.argv.slice(1).filter(arg => !arg.startsWith('-login'));
                        newArgs.push(...extraArgs);
                        const child = spawn(process.execPath, newArgs, {
                            cwd: process.cwd(),
                            detached: true,
                            stdio: 'ignore',
                            env: process.env
                        });
                        child.unref();
                        setTimeout(() => process.exit(0), 500);
                    }
                }, 500);
                return;
            }

            // POST /admin/stop - 停止服务
            if (method === 'POST' && pathname === '/stop') {
                sendJson(res, 200, { success: true, message: '服务正在停止...' });
                logger.info('管理器', '收到停止请求，将在 1 秒后退出');

                setTimeout(() => process.exit(0), 1000);
                return;
            }

            // GET /admin/vnc/status - VNC 状态
            if (method === 'GET' && pathname === '/vnc/status') {
                const vncInfo = await getVncInfo();
                if (vncInfo) {
                    sendJson(res, 200, vncInfo);
                } else {
                    // 非 Supervisor 模式或无法获取信息
                    sendJson(res, 200, {
                        enabled: false,
                        port: 0,
                        display: '',
                        xvfbMode: false
                    });
                }
                return;
            }

            // ==================== 缓存与数据管理 ====================

            // POST /admin/cache/clear - 清理缓存
            if (method === 'POST' && pathname === '/cache/clear') {
                const result = clearTempFiles(tempDir);
                sendJson(res, 200, { success: true, cleaned: result.cleaned });
                return;
            }

            // GET /admin/logs - 读取系统日志
            if (method === 'GET' && pathname === '/logs') {
                const url = new URL(req.url, `http://${req.headers.host}`);
                const lines = parseInt(url.searchParams.get('lines') || '200', 10);
                const result = logger.readLogs(lines);
                sendJson(res, 200, result);
                return;
            }

            // DELETE /admin/logs - 清除系统日志
            if (method === 'DELETE' && pathname === '/logs') {
                const success = logger.clearLogs();
                if (success) {
                    logger.info('管理器', '系统日志已清除');
                    sendJson(res, 200, { success: true, message: '日志已清除' });
                } else {
                    sendJson(res, 500, { success: false, message: '日志清除失败' });
                }
                return;
            }

            // GET /admin/data-folders - 列出数据文件夹
            if (method === 'GET' && pathname === '/data-folders') {
                const workers = config.backend?.pool?.workers || [];
                const folders = getDataFolders(workers);
                sendJson(res, 200, folders);
                return;
            }

            // POST /admin/data-folders/delete - 删除数据文件夹
            if (method === 'POST' && pathname === '/data-folders/delete') {
                const body = await readBody(req);
                if (!body.folders || !Array.isArray(body.folders)) {
                    sendApiError(res, { code: ERROR_CODES.INVALID_REQUEST_BODY, message: '缺少 folders 数组' });
                    return;
                }
                const workers = config.backend?.pool?.workers || [];
                const result = deleteDataFolders(body.folders, workers);

                if (result.errors.length > 0) {
                    sendJson(res, 207, result); // 207 Multi-Status
                } else {
                    sendJson(res, 200, result);
                }
                return;
            }

            // ==================== 配置管理 ====================

            // GET/POST /admin/config/server
            if (pathname === '/config/server') {
                if (method === 'GET') {
                    const serverConfig = getServerConfig();
                    const queueConfig = getQueueConfig();
                    sendJson(res, 200, {
                        ...serverConfig,
                        queueBuffer: queueConfig.queueBuffer,
                        imageLimit: queueConfig.imageLimit
                    });
                } else if (method === 'POST') {
                    const body = await readBody(req);

                    // 校验配置
                    const validation = validateServerConfig(body);
                    if (!validation.valid) {
                        sendApiError(res, {
                            code: ERROR_CODES.INVALID_REQUEST_BODY,
                            message: `配置校验失败: ${validation.errors.join('; ')}`
                        });
                        return;
                    }

                    // 分别保存 server 和 queue 配置
                    saveServerConfig(body);
                    if (body.queueBuffer !== undefined || body.imageLimit !== undefined) {
                        saveQueueConfig(body);
                    }
                    sendJson(res, 200, { success: true, message: '配置已保存，请重启服务生效' });
                } else {
                    res.writeHead(405);
                    res.end();
                }
                return;
            }

            // GET/POST /admin/config/browser
            if (pathname === '/config/browser') {
                if (method === 'GET') {
                    sendJson(res, 200, getBrowserConfig());
                } else if (method === 'POST') {
                    const body = await readBody(req);

                    // 校验配置
                    const validation = validateBrowserConfig(body);
                    if (!validation.valid) {
                        sendApiError(res, {
                            code: ERROR_CODES.INVALID_REQUEST_BODY,
                            message: `配置校验失败: ${validation.errors.join('; ')}`
                        });
                        return;
                    }

                    saveBrowserConfig(body);
                    sendJson(res, 200, { success: true, message: '配置已保存，请重启服务生效' });
                } else {
                    res.writeHead(405);
                    res.end();
                }
                return;
            }

            // GET/POST /admin/config/instances (对应原设计的 workers)
            if (pathname === '/config/instances' || pathname === '/config/workers') {
                if (method === 'GET') {
                    sendJson(res, 200, getInstancesConfig());
                } else if (method === 'POST') {
                    const body = await readBody(req);

                    // 校验配置（包括 Instance/Worker 名称唯一性）
                    const validation = validateInstancesConfig(body);
                    if (!validation.valid) {
                        sendApiError(res, {
                            code: ERROR_CODES.INVALID_REQUEST_BODY,
                            message: `配置校验失败: ${validation.errors.join('; ')}`
                        });
                        return;
                    }

                    saveInstancesConfig(body);
                    sendJson(res, 200, { success: true, message: '配置已保存，请重启服务生效' });
                } else {
                    res.writeHead(405);
                    res.end();
                }
                return;
            }

            // GET/POST /admin/config/adapters
            if (pathname === '/config/adapters') {
                if (method === 'GET') {
                    sendJson(res, 200, getAdaptersConfig());
                } else if (method === 'POST') {
                    const body = await readBody(req);

                    // 校验配置
                    const validation = validateAdaptersConfig(body);
                    if (!validation.valid) {
                        sendApiError(res, {
                            code: ERROR_CODES.INVALID_REQUEST_BODY,
                            message: `配置校验失败: ${validation.errors.join('; ')}`
                        });
                        return;
                    }

                    saveAdaptersConfig(body);
                    sendJson(res, 200, { success: true, message: '配置已保存，请重启服务生效' });
                } else {
                    res.writeHead(405);
                    res.end();
                }
                return;
            }

            // GET/POST /admin/config/pool - 负载均衡和故障转移配置
            if (pathname === '/config/pool') {
                if (method === 'GET') {
                    sendJson(res, 200, getPoolConfig());
                } else if (method === 'POST') {
                    const body = await readBody(req);

                    // 校验配置
                    const validation = validatePoolConfig(body);
                    if (!validation.valid) {
                        sendApiError(res, {
                            code: ERROR_CODES.INVALID_REQUEST_BODY,
                            message: `配置校验失败: ${validation.errors.join('; ')}`
                        });
                        return;
                    }

                    savePoolConfig(body);
                    sendJson(res, 200, { success: true, message: '配置已保存，请重启服务生效' });
                } else {
                    res.writeHead(405);
                    res.end();
                }
                return;
            }

            // ==================== 元数据 ====================

            // GET /admin/adapters - 获取适配器列表（含 configSchema）
            if (method === 'GET' && pathname === '/adapters') {
                const adapters = [];
                const adapterIds = registry.getAdapterIds();

                for (const id of adapterIds) {
                    const adapter = registry.getAdapter(id);
                    if (adapter) {
                        adapters.push({
                            id: adapter.id,
                            displayName: adapter.displayName || adapter.id,
                            modelCount: adapter.models?.length || 0,
                            models: (adapter.models || []).map(m => m.id),
                            configSchema: adapter.configSchema || []
                        });
                    }
                }

                sendJson(res, 200, adapters);
                return;
            }

            // ==================== 统计与监控 ====================

            // GET /admin/stats - 基本统计
            if (method === 'GET' && pathname === '/stats') {
                const instances = config.backend?.pool?.instances || [];
                const workers = config.backend?.pool?.workers || [];

                sendJson(res, 200, {
                    instances: instances.length,
                    workers: workers.length
                });
                return;
            }

            // GET /admin/queue - 任务队列状态
            if (method === 'GET' && pathname === '/queue') {
                const queueStatus = queueManager.getStatus();
                const detailedStatus = queueManager.getDetailedStatus();

                sendJson(res, 200, {
                    processing: queueStatus.processing,
                    waiting: queueStatus.queueLength,
                    total: queueStatus.total,
                    processingTasks: detailedStatus.processing,
                    waitingTasks: detailedStatus.waiting
                });
                return;
            }

            // 404
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not Found' }));

        } catch (err) {
            logger.error('管理器', `请求处理失败: ${err.message}`);
            sendApiError(res, {
                code: ERROR_CODES.INTERNAL_ERROR,
                message: err.message
            });
        }
    };
}
