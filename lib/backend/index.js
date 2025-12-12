import fs from 'fs';
import path from 'path';
import { loadConfig } from '../utils/config.js';
import { initBrowserBase } from '../browser/launcher.js';
import * as modelsModule from './models.js';
import { logger } from '../utils/logger.js';

// 导入适配器
import * as lmarenaBackend from './adapter/lmarena.js';
import * as geminiBackend from './adapter/gemini_biz.js';
import * as nanobananafreeBackend from './adapter/nanobananafree_ai.js';
import * as zaiIsBackend from './adapter/zai_is.js';

// --- 集中管理的路径常量 ---
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'camoufoxUserData');
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保必要目录存在
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const config = loadConfig();

// 将路径常量注入 config 对象
config.paths = {
    userDataDir: USER_DATA_DIR,
    tempDir: TEMP_DIR
};

// 适配器映射表
const ADAPTER_MAP = {
    'gemini_biz': geminiBackend,
    'nanobananafree_ai': nanobananafreeBackend,
    'zai_is': zaiIsBackend,
    'lmarena': lmarenaBackend
};

// 1. 单一后端模式实现
const SingleBackend = {
    name: config.backend.type,

    initBrowser: async (cfg) => {
        const adapter = ADAPTER_MAP[cfg.backend.type] || lmarenaBackend;
        return adapter.initBrowser(cfg);
    },

    generateImage: async (ctx, prompt, paths, modelId, meta) => {
        const adapter = ADAPTER_MAP[config.backend.type] || lmarenaBackend;
        return adapter.generateImage(ctx, prompt, paths, modelId, meta);
    },

    resolveModelId: (modelKey) => modelsModule.resolveModelId(config.backend.type, modelKey),
    getModels: () => modelsModule.getModelsForBackend(config.backend.type),
    getImagePolicy: (modelKey) => modelsModule.getImagePolicy(config.backend.type, modelKey)
};

// 2. 聚合后端模式实现
const MergedBackend = {
    name: 'aggregated',
    _globalBrowser: null,
    _globalPage: null,

    initBrowser: async (cfg) => {
        if (MergedBackend._globalPage && !MergedBackend._globalPage.isClosed()) {
            return { browser: MergedBackend._globalBrowser, page: MergedBackend._globalPage, config: cfg };
        }

        const activeTypes = cfg.backend.merge.type || [];
        const handlers = [];

        // 收集导航处理器
        for (const type of activeTypes) {
            const adapter = ADAPTER_MAP[type];
            if (type === 'gemini_biz' && adapter.handleAccountChooser) handlers.push(adapter.handleAccountChooser);
            if (type === 'zai_is' && adapter.handleDiscordAuth) handlers.push(adapter.handleDiscordAuth);
        }

        // 聚合处理器
        const aggregatedHandler = async (page) => {
            for (const handler of handlers) {
                try { await handler(page); } catch (e) { }
            }
        };

        logger.info('适配器', `[后端聚合] 启动全局浏览器，聚合: ${activeTypes.join(', ')}`);

        const base = await initBrowserBase(cfg, {
            userDataDir: cfg.paths.userDataDir,
            targetUrl: 'about:blank',
            productName: '聚合模式',
            navigationHandler: aggregatedHandler,
            waitInputValidator: async () => { }
        });

        MergedBackend._globalBrowser = base.browser;
        MergedBackend._globalPage = base.page;
        return { ...base, config: cfg };
    },

    generateImage: async (ctx, prompt, paths, modelId, meta) => {
        if (!modelId || !modelId.includes('|')) return { error: 'Invalid aggregated model ID' };

        const [adapterType, realId] = modelId.split('|');
        const adapter = ADAPTER_MAP[adapterType];

        if (!adapter) return { error: `Adapter not found: ${adapterType}` };

        logger.info('适配器', `[后端聚合] 路由至: ${adapterType}, Model: ${realId}`, meta);

        // 构造子上下文：复用全局 Page，但传入全局 Config
        // 适配器会从 config.backend.geminiBiz 等字段读取所需配置
        const subContext = {
            ...ctx,
            page: MergedBackend._globalPage,
            config: config
        };

        return adapter.generateImage(subContext, prompt, paths, realId, meta);
    },

    resolveModelId: (modelKey) => {
        const types = config.backend.merge.type;

        // 支持 backend/model 格式指定后端 (如 lmarena/seedream-4.5)
        if (modelKey.includes('/')) {
            const [specifiedType, actualModel] = modelKey.split('/', 2);
            if (ADAPTER_MAP[specifiedType] && types.includes(specifiedType)) {
                const realId = modelsModule.resolveModelId(specifiedType, actualModel);
                if (realId) return `${specifiedType}|${realId}`;
            }
            return null; // 指定的后端不存在或不在聚合列表中
        }

        // 按优先级自动匹配
        for (const type of types) {
            const realId = modelsModule.resolveModelId(type, modelKey);
            if (realId) return `${type}|${realId}`;
        }
        return null;
    },

    getModels: () => {
        const types = config.backend.merge.type;
        const allModels = [];
        const seenIds = new Set();

        // 1. 添加按优先级自动选择的模型 (去重)
        for (const type of types) {
            const result = modelsModule.getModelsForBackend(type);
            if (result?.data) {
                for (const m of result.data) {
                    if (!seenIds.has(m.id)) {
                        seenIds.add(m.id);
                        allModels.push({
                            ...m,
                            owned_by: type  // 标记优先匹配的后端
                        });
                    }
                }
            }
        }

        // 2. 添加带前缀的模型 (backend/model 格式，用于指定后端)
        for (const type of types) {
            const result = modelsModule.getModelsForBackend(type);
            if (result?.data) {
                for (const m of result.data) {
                    const prefixedId = `${type}/${m.id}`;
                    allModels.push({
                        ...m,
                        id: prefixedId,
                        owned_by: type
                    });
                }
            }
        }

        return { object: 'list', data: allModels };
    },

    getImagePolicy: (modelKey) => {
        const types = config.backend.merge.type;

        // 支持 backend/model 格式
        if (modelKey.includes('/')) {
            const [specifiedType, actualModel] = modelKey.split('/', 2);
            if (ADAPTER_MAP[specifiedType] && types.includes(specifiedType)) {
                return modelsModule.getImagePolicy(specifiedType, actualModel);
            }
            return 'optional';
        }

        // 按优先级查找
        for (const type of types) {
            const realId = modelsModule.resolveModelId(type, modelKey);
            if (realId) return modelsModule.getImagePolicy(type, modelKey);
        }
        return 'optional';
    }
};

export function getBackend() {
    const isMerge = config.backend.merge && config.backend.merge.enable;
    const activeBackend = isMerge ? MergedBackend : SingleBackend;

    logger.info('适配器', `后端模式: ${isMerge ? '聚合' : '独立'}`);

    return { config, TEMP_DIR, ...activeBackend };
}
