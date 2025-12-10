import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import crypto from 'crypto';
import { logger } from './logger.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.yaml');

// 模块级缓存，确保配置只从磁盘读取一次
let cachedConfig = null;

/**
 * 生成随机 API Key
 * 格式: sk-{48位十六进制字符}
 * @returns {string} API Key
 */
function generateApiKey() {
    return 'sk-' + crypto.randomBytes(24).toString('hex');
}

/**
 * 默认配置模板
 */
function getDefaultConfig() {
    return `# 自动生成于 ${new Date().toLocaleString()}

# 日志等级: debug | info | warn | error
logLevel: info

server:
  # 监听端口
  port: 3000
  # 鉴权 Token (Bearer Token) (可使用 npm run genkey 生成)
  auth: ${generateApiKey()}
  # 保活
  keepalive:
    # 是否启用流式保活
    # 使用OpenAI接口的标准流式接口格式，客户端请求需强制使用 stream: true
    enable: false

    # 心跳模式
    # "comment": (推荐) 发送 :keepalive 注释。不污染数据，绝大多数 SDK 支持，不会影响接口标准
    # "content": (备用) 在 choices[0].delta.content = "" 中发送空字符串
    #            仅当你使用的客户端非常特殊，必须收到 data JSON 包才重置超时时使用
    mode: "comment"

backend:
  # 适配器设置
  # - lmarena (LMArena)
  # - gemini_biz (Gemini Enterprise Business)
  # - nanobananafree_ai (Nano Banana Free)
  # - zai_is (zAI)
  type: lmarena
  
  # Gemini Business 设置
  geminiBiz:
    # 入口链接
    # 示例: "https://business.gemini.google/home/cid/8888a888-b6e0-88be-86e1-888cf3ee8cf4"
    entryUrl: ""

queue:
  # 最大排队数
  # 仅对未开启流式保活模式时做出限制，非必要不建议更改
  # 因客户端可能有超时保护，队列大于2是一定会触发超时保护的
  maxQueueSize: 2
  # 图片数量上限 
  # 网页最多支持10个附件，如果设置大于10则直接丢弃超出10的图片
  imageLimit: 5

browser:
  # 浏览器可执行文件路径 (留空则使用 Camoufox 默认下载路径)
  # Windows系统示例 "C:\\camoufox\\camoufox.exe"
  # Linux系统示例 "/opt/camoufox/camoufox"
  path: ""
  
  # 是否启用无头模式
  headless: false
  
  # 是否启用 GPU (Camoufox 已内置指纹伪装，无GPU设备运行请使用false)
  gpu: false
  
  # 代理设置
  proxy:
    # 是否启用代理
    enable: false
    # 代理类型: http | socks5
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
    // 如果已有缓存，直接返回
    if (cachedConfig) return cachedConfig;

    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            logger.warn('配置器', '配置文件不存在,正在生成默认配置...');
            const defaultConfig = getDefaultConfig();
            fs.writeFileSync(CONFIG_PATH, defaultConfig, 'utf8');
            logger.info('配置器', `已生成默认配置文件: ${CONFIG_PATH}`);
            logger.warn('配置器', '请注意查看生成的随机 API Key');
        }

        const configFile = fs.readFileSync(CONFIG_PATH, 'utf8');
        const config = yaml.parse(configFile);

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

        // 设置 keepalive 配置默认值
        if (!config.server.keepalive) {
            config.server.keepalive = {
                enable: true,
                mode: 'comment'
            };
        } else {
            if (config.server.keepalive.enable === undefined) config.server.keepalive.enable = true;
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

        // 校验 GeminiBiz 配置
        if (config.backend.type === 'gemini_biz') {
            if (!config.backend.geminiBiz || !config.backend.geminiBiz.entryUrl) {
                throw new Error('backend.type = gemini_biz requires backend.geminiBiz.entryUrl');
            }
        }

        logger.debug('配置器', '已加载 config.yaml');
        logger.debug('配置器', '后端类型:', config.backend.type);
        logger.debug('配置器', '流式保活:', config.server.keepalive.enable ? '已启用' : '已禁用');
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
    } catch (e) {
        logger.error('配置器', '无法加载或生成配置文件', { error: e.message });
        process.exit(1);
    }
}

// 默认导出为函数
export default loadConfig;

// 生成 API Key
if (process.argv.includes('-genkey')) {
    console.log('>>> [GenAPIKey] 生成新的 API Key:');
    console.log(generateApiKey());
    console.log('\n>>> 请将此 Key 复制到 config.yaml 文件的 server.auth 字段中。');
    process.exit(0);
}
