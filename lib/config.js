import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { generateApiKey } from './security/apiKey.js';
import { logger } from './logger.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');

/**
 * 默认配置模板
 */
function getDefaultConfig() {
    return `# 自动生成于 ${new Date().toLocaleString()}

# 日志等级: debug | info | warn | error
logLevel: info

server:
  # 服务器模式: openai (标准兼容) | queue (流式队列)
  type: queue
  # 监听端口
  port: 3000
  # 鉴权 Token (Bearer Token) (可使用 npm run genkey 生成)
  auth: ${generateApiKey()}

backend:
  # 选择后端: lmarena (竞技场) | gemini_biz (Gemini Enterprise Business)
  type: lmarena
  
  # Gemini Business 设置
  geminiBiz:
    # 入口链接
    # 示例: "https://business.gemini.google/home/cid/8888a888-b6e0-88be-86e1-888cf3ee8cf4?csesidx=1666666666"
    entryUrl: ""

queue:
  # 最大排队数
  # 仅对OpenAI模式做出限制，非必要不建议更改
  # 因常见客户端都有超时保护，队列大于2是一定会触发超时保护的
  maxQueueSize: 2
  # 图片数量上限 
  # 网页最多支持10个附件，如果设置大于10则直接丢弃超出10的图片
  imageLimit: 5

chrome:
  # 浏览器可执行文件路径 (留空则使用Puppeteer默认)
  # Windows系统示例 "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe"
  # Linux系统示例 "/usr/bin/google-chrome"
  # path: ""
  
  # 是否启用无头模式
  headless: false
  
  # 是否启用 GPU (无GPU设备运行请使用false)
  gpu: false
  
  # 代理设置
  proxy:
    # 是否启用代理
    enable: false
    # 代理类型: http 或 socks5
    type: http
    # 代理主机
    host: 127.0.0.1
    # 代理端口
    port: 7890
    # 代理认证 (可选)
    # user: username
    # passwd: password

`;
}

/**
 * 加载配置,如果不存在则自动创建
 * @returns {object} 配置对象
 */
export function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            logger.warn('配置器', '配置文件不存在,正在生成默认配置...');
            const defaultConfig = getDefaultConfig();
            fs.writeFileSync(CONFIG_PATH, defaultConfig, 'utf8');
            logger.info('配置器', `已生成默认配置文件: ${CONFIG_PATH}`);
            logger.warn('配置器', '请注意查看生成的随机 API Key');
        }

        const configFile = fs.readFileSync(CONFIG_PATH, 'utf8');
        const config = yaml.load(configFile);

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

        // 设置 backend 配置默认值
        if (!config.backend) {
            config.backend = {
                type: 'lmarena',
                geminiBiz: { entryUrl: '' }
            };
        }

        // 校验 GeminiBiz 配置
        if (config.backend.type === 'gemini_biz') {
            if (!config.backend.geminiBiz || !config.backend.geminiBiz.entryUrl) {
                throw new Error('backend.type = gemini_biz requires backend.geminiBiz.entryUrl');
            }
        }

        logger.debug('配置器', '已加载 config.yaml');
        logger.debug('配置器', `服务器模式: ${config.server.type || 'queue'}`);
        logger.debug('配置器', `后端类型: ${config.backend.type}`);
        if (config.backend.type === 'gemini_biz') {
            logger.debug('配置器', `GeminiBiz 入口: ${config.backend.geminiBiz.entryUrl}`);
        }

        // 设置日志级别
        if (config.logLevel) {
            logger.setLevel(config.logLevel);
        }

        return config;
    } catch (e) {
        logger.error('配置器', '无法加载或生成配置文件', { error: e.message });
        process.exit(1);
    }
}

// 默认导出为函数
export default loadConfig;
