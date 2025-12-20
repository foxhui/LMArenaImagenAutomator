/**
 * @fileoverview API 路由总装配
 * @description 统一挂载 /v1 和 /admin 路由
 */

import fs from 'fs';
import path from 'path';
import { createOpenAIRouter } from './openai/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { createAuthMiddleware } from '../middlewares/auth.js';

// MIME 类型映射
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

// WebUI 静态文件目录
const WEBUI_DIR = path.join(process.cwd(), 'webui', 'dist');

/**
 * 创建全局路由处理器
 * @param {object} context - 路由上下文
 * @param {boolean} [context.loginMode] - 登录模式（禁用 OpenAI API）
 * @returns {Function} 请求处理函数
 */
export function createGlobalRouter(context) {
    const { authToken, config, queueManager, tempDir, loginMode, getSafeMode } = context;

    // 创建鉴权中间件
    const checkAuth = createAuthMiddleware(authToken);

    // 创建子路由处理器
    const handleOpenAIRequest = loginMode ? null : createOpenAIRouter(context);
    const handleAdminRequest = createAdminRouter({ config, queueManager, tempDir, getSafeMode });

    /**
     * 主路由处理函数
     */
    return async function handleRequest(req, res) {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        const pathname = parsedUrl.pathname;

        // ==================== 静态文件服务 ====================
        if (req.method === 'GET' && !pathname.startsWith('/v1') && !pathname.startsWith('/admin')) {
            let filePath = pathname === '/' ? '/index.html' : pathname;
            filePath = path.join(WEBUI_DIR, filePath);

            // 安全检查
            if (!filePath.startsWith(WEBUI_DIR)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            // 检查文件是否存在
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                const content = fs.readFileSync(filePath);
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
                return;
            }

            // SPA 模式 fallback
            const indexPath = path.join(WEBUI_DIR, 'index.html');
            if (fs.existsSync(indexPath)) {
                const content = fs.readFileSync(indexPath);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
                return;
            }
        }

        // ==================== 鉴权检查 ====================
        if (!checkAuth(req, res)) {
            return; // 鉴权失败，已发送错误响应
        }

        // ==================== API 路由分发 ====================

        // Admin API (/admin)
        if (pathname.startsWith('/admin')) {
            const adminPath = pathname.slice(6); // 去除 /admin 前缀
            await handleAdminRequest(req, res, adminPath);
            return;
        }

        // OpenAI API (/v1)
        if (pathname.startsWith('/v1')) {
            // 安全模式下禁用 OpenAI API
            const safeMode = getSafeMode?.();
            if (safeMode?.enabled) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: `服务运行在安全模式，OpenAI API 不可用。原因: ${safeMode.reason}`,
                        type: 'service_unavailable'
                    }
                }));
                return;
            }
            // 登录模式下禁用 OpenAI API
            if (!handleOpenAIRequest) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: { message: '服务运行在登录模式，OpenAI API 不可用', type: 'service_unavailable' }
                }));
                return;
            }
            const v1Path = pathname.slice(3); // 去除 /v1 前缀
            await handleOpenAIRequest(req, res, v1Path, parsedUrl);
            return;
        }

        // 404
        res.writeHead(404);
        res.end();
    };
}
