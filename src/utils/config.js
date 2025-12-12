/**
 * @fileoverview 配置加载模块
 * @description 负责读取/解析 `config.yaml`，并提供 API Key 生成能力（供脚本使用）。
 *
 * 约定：
 * - 该模块只负责“读取 + 校验 + 默认值补全”，不负责创建/写入配置文件。
 * - 初始化/拷贝配置请使用 `config.example.yaml` + `scripts/config-init.js`。
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

import { logger } from './logger.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');
const EXAMPLE_CONFIG_PATH = path.join(process.cwd(), 'config.example.yaml');

// 模块级缓存：确保配置只从磁盘读取一次
let cachedConfig = null;

/**
 * 加载并校验配置（只读）
 * @returns {object} 配置对象
 */
export function loadConfig() {
    // 如果已有缓存，直接返回
    if (cachedConfig) return cachedConfig;

    if (!fs.existsSync(CONFIG_PATH)) {
        const hint = fs.existsSync(EXAMPLE_CONFIG_PATH)
            ? `请复制 ${EXAMPLE_CONFIG_PATH} 为 ${CONFIG_PATH}`
            : `请创建 ${CONFIG_PATH}（仓库根目录通常提供 config.example.yaml 作为模板）`;
        throw new Error(`未找到配置文件: ${CONFIG_PATH}。${hint}`);
    }

    const configFile = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = yaml.parse(configFile);
    if (!config || typeof config !== 'object') {
        throw new Error(`配置文件解析失败: ${CONFIG_PATH}`);
    }

    // Docker 路径兼容处理
    if ((!config.browser?.path || !fs.existsSync(config.browser.path)) &&
        fs.existsSync('/app/camoufox/camoufox')) {
        logger.info('配置器', '检测到容器环境，自动修正浏览器路径为 /app/camoufox/camoufox');
        if (!config.browser) config.browser = {};
        config.browser.path = '/app/camoufox/camoufox';
    }

    // 基础配置校验
    if (!config.server || !config.server.port) {
        throw new Error('配置文件缺少必需字段: server.port');
    }
    if (!config.server.auth) {
        throw new Error('配置文件缺少必需字段: server.auth');
    }

    // 设置队列配置默认值
    if (!config.queue) {
        config.queue = {
            maxConcurrent: 1,
            maxQueueSize: 2,
            imageLimit: 5
        };
    } else {
        // 强制 maxConcurrent 为 1
        config.queue.maxConcurrent = 1;
        if (config.queue.maxQueueSize === undefined) config.queue.maxQueueSize = 2;
        if (config.queue.imageLimit === undefined) config.queue.imageLimit = 5;
    }

    // 设置 keepalive 配置默认值（兼容旧字段：keepalive.enable）
    if (!config.server.keepalive) {
        config.server.keepalive = { mode: 'comment' };
    } else {
        if (config.server.keepalive.mode === undefined) config.server.keepalive.mode = 'comment';
        // 验证 mode 值
        if (!['comment', 'content'].includes(config.server.keepalive.mode)) {
            logger.warn('配置器', `无效的 keepalive.mode: ${config.server.keepalive.mode}，使用默认值 comment`);
            config.server.keepalive.mode = 'comment';
        }
    }

    // 设置 backend 配置默认值
    if (!config.backend) {
        config.backend = {
            type: 'lmarena',
            geminiBiz: { entryUrl: '' }
        };
    }

    // 新增：Merge 配置初始化
    if (!config.backend.merge) {
        config.backend.merge = {
            enable: false,
            type: ['zai_is', 'lmarena']
        };
    }

    // 校验 GeminiBiz 配置
    if (config.backend.type === 'gemini_biz') {
        if (!config.backend.geminiBiz || !config.backend.geminiBiz.entryUrl) {
            throw new Error('backend.type = gemini_biz requires backend.geminiBiz.entryUrl');
        }
    }

    logger.debug('配置器', '已加载 config.yaml');
    logger.debug('配置器', '后端类型:', config.backend.type);
    logger.debug('配置器', '流式心跳模式:', config.server.keepalive.mode);
    if (config.backend.type === 'gemini_biz') {
        logger.debug('配置器', `GeminiBiz 入口: ${config.backend.geminiBiz.entryUrl}`);
    }

    // 设置日志级别
    if (config.logLevel) {
        logger.setLevel(config.logLevel);
    }

    // 缓存配置
    cachedConfig = config;
    return config;
}

// 默认导出为函数
export default loadConfig;


