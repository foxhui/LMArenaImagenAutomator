import { loadConfig } from '../config.js';
import * as lmarenaBackend from './lmarena.js';
import * as geminiBackend from './gemini_biz.js';

const config = loadConfig();

let activeBackend;

if (config.backend?.type === 'gemini_biz') {
    activeBackend = {
        name: 'gemini_biz',
        initBrowser: (cfg) => geminiBackend.initBrowser(cfg),
        generateImage: (ctx, prompt, paths, model, meta) => geminiBackend.generateImage(ctx, prompt, paths, model, meta),
        TEMP_DIR: geminiBackend.TEMP_DIR
    };
} else {
    activeBackend = {
        name: 'lmarena',
        initBrowser: (cfg) => lmarenaBackend.initBrowser(cfg),
        generateImage: (ctx, prompt, paths, model, meta) => lmarenaBackend.generateImage(ctx, prompt, paths, model, meta),
        TEMP_DIR: lmarenaBackend.TEMP_DIR
    };
}

export function getBackend() {
    return { config, ...activeBackend };
}
