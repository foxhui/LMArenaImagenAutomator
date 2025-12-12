/**
 * @fileoverview Xvfb 和 VNC 显示参数处理模块（仅 Linux）
 * @description 处理 -xvfb 和 -vnc 命令行参数，启动虚拟显示器和 VNC 服务器
 */

import { spawn, spawnSync } from 'child_process';
import os from 'os';
import net from 'net';
import { logger } from '../utils/logger.js';

/**
 * 检查命令是否存在
 * @param {string} cmd - 命令名称
 * @returns {boolean} 命令是否存在
 */
function checkCommand(cmd) {
    const result = spawnSync('which', [cmd], { encoding: 'utf8' });
    return result.status === 0;
}

/**
 * 检查端口是否可用
 * @param {number} port - 端口号
 * @returns {Promise<boolean>} 端口是否可用
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
 * @param {number} [startPort=5900] - 起始端口
 * @param {number} [maxAttempts=10] - 最大尝试次数
 * @returns {Promise<number|null>} 可用端口号，或 null 表示未找到
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
 * 启动 VNC 服务器
 * @param {string} display - 显示器编号（如 ':99'）
 * @returns {Promise<import('child_process').ChildProcess>} VNC 进程
 */
async function startVncServer(display) {
    if (!checkCommand('x11vnc')) {
        logger.error('服务器', '未找到 x11vnc 命令');
        logger.error('服务器', '请先安装 x11vnc:');
        logger.error('服务器', ' - Ubuntu/Debian: sudo apt install x11vnc');
        logger.error('服务器', ' - CentOS/RHEL:   sudo dnf install x11vnc');
        process.exit(1);
    }

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
        stdio: 'ignore',
        detached: false
    });

    vncProcess.on('error', (err) => {
        logger.error('服务器', 'VNC 启动失败', { error: err.message });
    });

    logger.info('服务器', 'VNC 服务器已成功启动');
    logger.warn('服务器', `VNC 连接端口: ${vncPort}`);

    return vncProcess;
}

/**
 * 在 Xvfb 中重启进程
 * @param {string[]} args - 当前命令行参数
 */
function restartInXvfb(args) {
    logger.info('服务器', '正在启动 Xvfb 虚拟显示器...');

    // 构建新的参数列表（移除 -xvfb，保留其他参数）
    const newArgs = args.filter(arg => arg !== '-xvfb');

    const xvfbArgs = [
        '--server-num=99',
        '--server-args=-ac -screen 0 1366x768x24',
        'env',
        'XVFB_RUNNING=true',
        'DISPLAY=:99',
        process.argv[0],
        process.argv[1],
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
}

/**
 * 处理 Xvfb 和 VNC 启动参数
 * @returns {Promise<'XVFB_REDIRECT'|undefined>} 如果需要重定向到 Xvfb 则返回 'XVFB_REDIRECT'
 */
export async function handleDisplayParams() {
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

    // 处理 -xvfb 参数
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

        // 已在 Xvfb 中运行
        if (isInXvfb) {
            logger.info('服务器', '已在 Xvfb 虚拟显示器中运行', { display: process.env.DISPLAY || ':99' });

            // 处理 VNC
            if (hasVnc) {
                const display = process.env.DISPLAY || ':99';
                const vncProcess = await startVncServer(display);

                // 处理进程退出信号
                process.on('SIGINT', () => {
                    vncProcess.kill('SIGTERM');
                    process.exit(0);
                });
                process.on('SIGTERM', () => {
                    vncProcess.kill('SIGTERM');
                    process.exit(0);
                });
            }

            return;
        }

        // 需要在 Xvfb 中重启
        restartInXvfb(args);
        return 'XVFB_REDIRECT';
    }
}
