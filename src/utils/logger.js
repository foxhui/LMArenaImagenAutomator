/**
 * @fileoverview 控制台日志模块
 * @description 提供带时间戳/级别/模块名的彩色日志输出，并支持通过环境变量控制日志等级。
 *
 * - 环境变量：LOG_LEVEL=debug|info|warn|error
 * - 输出格式：YYYY-MM-DD HH:mm:ss.SSS [LEVEL] [模块] 消息 | k=v ...
 * - 日志文件：data/temp/system.log（超过 5MB 自动轮转）
 */

import process from 'process';
import fs from 'fs';
import path from 'path';

const LEVELS = ['debug', 'info', 'warn', 'error'];

// ANSI 颜色代码
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    white: '\x1b[37m'
};

// 日志文件配置
const LOG_DIR = path.join(process.cwd(), 'data', 'temp');
const LOG_FILE = path.join(LOG_DIR, 'system.log');
const LOG_FILE_OLD = path.join(LOG_DIR, 'system.log.old');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// 确保日志目录存在
function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

// 日志轮转：超过 5MB 时重命名为 .old
function rotateLogIfNeeded() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size >= MAX_LOG_SIZE) {
                // 删除旧的 .old 文件
                if (fs.existsSync(LOG_FILE_OLD)) {
                    fs.unlinkSync(LOG_FILE_OLD);
                }
                // 重命名当前日志
                fs.renameSync(LOG_FILE, LOG_FILE_OLD);
            }
        }
    } catch (e) {
        // 忽略轮转错误
    }
}

// 写入日志文件
function writeToFile(line) {
    try {
        ensureLogDir();
        rotateLogIfNeeded();
        fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    } catch (e) {
        // 忽略写入错误
    }
}

// 根据日志级别获取颜色
function getColor(level) {
    switch (level.toLowerCase()) {
        case 'error':
            return COLORS.red;
        case 'warn':
            return COLORS.yellow;
        case 'info':
            return COLORS.white;
        case 'debug':
            return COLORS.blue;
        default:
            return COLORS.reset;
    }
}

function formatTime(date = new Date()) {
    const pad = (n, len = 2) => n.toString().padStart(len, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const HH = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const SSS = pad(date.getMilliseconds(), 3);
    return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS}`;
}

let currentLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

export function setLogLevel(level) {
    if (level && LEVELS.includes(level.toLowerCase())) {
        currentLogLevel = level.toLowerCase();
    }
}

function shouldLog(level) {
    const targetLevel = level.toLowerCase();
    const envIndex = LEVELS.indexOf(currentLogLevel);
    const targetIndex = LEVELS.indexOf(targetLevel);

    // If env level is invalid, default to info (index 1)
    const effectiveEnvIndex = envIndex === -1 ? 1 : envIndex;

    return targetIndex >= effectiveEnvIndex;
}

export function log(level, mod, msg, meta = {}) {
    if (!shouldLog(level)) return;

    const ts = formatTime();
    const levelMap = { debug: 'DBUG', info: 'INFO', warn: 'WARN', error: 'ERRO' };
    const levelTag = levelMap[level.toLowerCase()] || level.toUpperCase().slice(0, 4);
    const base = `${ts} [${levelTag}] [${mod}] ${msg}`;

    const metaStr = Object.keys(meta).length
        ? ' | ' + Object.entries(meta).map(([k, v]) => {
            if (v instanceof Error) {
                return `${k}=${v.message}`;
            }
            if (typeof v === 'object' && v !== null) {
                try {
                    return `${k}=${JSON.stringify(v)}`;
                } catch (e) {
                    return `${k}=[Circular]`;
                }
            }
            return `${k}=${v}`;
        }).join(' ')
        : '';

    const line = base + metaStr;
    const color = getColor(level);
    const coloredLine = `${color}${line}${COLORS.reset}`;

    // 输出到控制台
    if (level === 'error') {
        console.error(coloredLine);
    } else if (level === 'warn') {
        console.warn(coloredLine);
    } else {
        console.log(coloredLine);
    }

    // 写入日志文件（不带颜色）
    writeToFile(line);
}

/**
 * 获取日志文件路径
 */
export function getLogPath() {
    return LOG_FILE;
}

/**
 * 获取旧日志文件路径
 */
export function getOldLogPath() {
    return LOG_FILE_OLD;
}

/**
 * 清除日志文件
 */
export function clearLogs() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            fs.unlinkSync(LOG_FILE);
        }
        if (fs.existsSync(LOG_FILE_OLD)) {
            fs.unlinkSync(LOG_FILE_OLD);
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 读取日志文件（返回最后 N 行）
 * @param {number} lines - 读取行数
 * @returns {{logs: string[], total: number, file: string}}
 */
export function readLogs(lines = 200) {
    const result = { logs: [], total: 0, file: LOG_FILE };

    try {
        if (!fs.existsSync(LOG_FILE)) {
            return result;
        }

        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const allLines = content.split('\n').filter(line => line.trim());
        result.total = allLines.length;

        // 返回最后 N 行
        result.logs = allLines.slice(-lines);
    } catch (e) {
        // 忽略读取错误
    }

    return result;
}

export const logger = {
    debug: (mod, msg, meta) => log('debug', mod, msg, meta),
    info: (mod, msg, meta) => log('info', mod, msg, meta),
    warn: (mod, msg, meta) => log('warn', mod, msg, meta),
    error: (mod, msg, meta) => log('error', mod, msg, meta),
    setLevel: setLogLevel,
    getLogPath,
    getOldLogPath,
    clearLogs,
    readLogs
};

