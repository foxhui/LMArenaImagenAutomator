import process from 'process';

const LEVELS = ['debug', 'info', 'warn', 'error'];

// ANSI 颜色代码
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    white: '\x1b[37m'
};

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
    const levelTag = level.toUpperCase();
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

    if (level === 'error') {
        console.error(coloredLine);
    } else if (level === 'warn') {
        console.warn(coloredLine);
    } else {
        console.log(coloredLine);
    }
}

export const logger = {
    debug: (mod, msg, meta) => log('debug', mod, msg, meta),
    info: (mod, msg, meta) => log('info', mod, msg, meta),
    warn: (mod, msg, meta) => log('warn', mod, msg, meta),
    error: (mod, msg, meta) => log('error', mod, msg, meta),
    setLevel: setLogLevel
};
