import fs from 'fs';
import path from 'path';
import { loadConfig } from '../utils/config.js';
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

let activeBackend;

switch (config.backend?.type) {
    case 'gemini_biz':
        activeBackend = {
            name: 'gemini_biz',
            initBrowser: (cfg) => geminiBackend.initBrowser(cfg),
            generateImage: (ctx, prompt, paths, model, meta) => geminiBackend.generateImage(ctx, prompt, paths, model, meta)
        };
        break;
    case 'nanobananafree_ai':
        activeBackend = {
            name: 'nanobananafree_ai',
            initBrowser: (cfg) => nanobananafreeBackend.initBrowser(cfg),
            generateImage: (ctx, prompt, paths, model, meta) => nanobananafreeBackend.generateImage(ctx, prompt, paths, model, meta)
        };
        break;
    case 'zai_is':
        activeBackend = {
            name: 'zai_is',
            initBrowser: (cfg) => zaiIsBackend.initBrowser(cfg),
            generateImage: (ctx, prompt, paths, model, meta) => zaiIsBackend.generateImage(ctx, prompt, paths, model, meta)
        };
        break;
    case 'lmarena':
    default:
        activeBackend = {
            name: 'lmarena',
            initBrowser: (cfg) => lmarenaBackend.initBrowser(cfg),
            generateImage: (ctx, prompt, paths, model, meta) => lmarenaBackend.generateImage(ctx, prompt, paths, model, meta)
        };
        break;
}

export function getBackend() {
    return { config, TEMP_DIR, ...activeBackend };
}
