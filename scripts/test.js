/**
 * @fileoverview 本地 HTTP 调用测试（CLI）
 * @description 用交互式方式构造请求并调用本地服务的 `/v1/chat/completions`，用于快速验证服务可用性与流式输出。
 *
 * 用法：`npm run test`
 */

import { select, input } from '@inquirer/prompts';
import fs from 'fs';
import path from 'path';
import http from 'http';
import yaml from 'yaml';

// 简易日志：脚本内部使用，避免引入服务端 logger 造成格式混淆
const logger = {
    info: (tag, msg) => console.log(`[${new Date().toLocaleTimeString()}] [INFO] [${tag}] ${msg}`),
    warn: (tag, msg) => console.log(`[${new Date().toLocaleTimeString()}] [WARN] [${tag}] ${msg}`),
    error: (tag, msg, meta) => console.error(`[${new Date().toLocaleTimeString()}] [ERROR] [${tag}] ${msg}`, meta || '')
};

// 读取本地配置：用于获取端口与鉴权 Token（读取失败时使用默认值）
let config = { server: { port: 3000, auth: '' } };
try {
    if (fs.existsSync('config.yaml')) {
        const file = fs.readFileSync('config.yaml', 'utf8');
        const parsed = yaml.parse(file);
        if (parsed && parsed.server) {
            config.server.port = parsed.server.port || 3000;
            config.server.auth = parsed.server.auth || '';
        }
    }
} catch (e) {
    logger.warn('Test', '无法读取 config.yaml，将使用默认设置');
}

/**
 * 输入提示词
 */
async function promptForInput() {
    const prompt = await input({
        message: '输入提示词 (必填)',
        validate: (val) => val.trim().length > 0 || '提示词不能为空'
    });
    return prompt.trim();
}

/**
 * 输入图片路径
 */
async function promptForImages() {
    const imagePaths = [];
    while (true) {
        const imgPath = await input({
            message: `输入参考图片路径 (留空跳过，已添加 ${imagePaths.length} 张)`,
        });

        if (!imgPath.trim()) break;

        const cleanPath = imgPath.trim().replace(/^["']|["']$/g, '');
        if (fs.existsSync(cleanPath)) {
            imagePaths.push(cleanPath);
        } else {
            logger.warn('Test', `图片不存在: ${cleanPath}`);
        }
    }
    return imagePaths;
}

/**
 * HTTP 测试模式 - OpenAI 格式
 */
async function testViaHttpOpenAI(prompt, modelId, imagePaths, isStreaming) {
    const PORT = config.server.port;
    const AUTH_TOKEN = config.server.auth;

    if (!AUTH_TOKEN) {
        logger.warn('Test', '警告: 未配置 API Key (server.auth)');
    }

    logger.info('Test', `HTTP 测试 - ${isStreaming ? '流式' : '非流式'} - 端口: ${PORT}`);

    return new Promise((resolve, reject) => {
        // 构造请求体
        const messages = [];
        const lastMessage = { role: 'user', content: [] };

        if (prompt) {
            lastMessage.content.push({ type: 'text', text: prompt });
        }

        for (const imgPath of imagePaths) {
            if (fs.existsSync(imgPath)) {
                const buffer = fs.readFileSync(imgPath);
                const base64 = buffer.toString('base64');
                const ext = path.extname(imgPath).slice(1).toLowerCase();
                const mimeType = ext === 'jpg' ? 'jpeg' : ext;
                lastMessage.content.push({
                    type: 'image_url',
                    image_url: { url: `data:image/${mimeType};base64,${base64}` }
                });
            } else {
                logger.warn('Test', `图片不存在，已跳过: ${imgPath}`);
            }
        }

        messages.push(lastMessage);

        const body = {
            messages,
            stream: isStreaming,
            model: modelId || 'default'
        };

        const bodyStr = JSON.stringify(body);

        const options = {
            hostname: '127.0.0.1',
            port: PORT,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'Authorization': `Bearer ${AUTH_TOKEN}`
            }
        };

        const req = http.request(options, (res) => {
            if (isStreaming) {
                // 流式响应
                let buffer = '';
                let contentReceived = '';

                res.on('data', chunk => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // 保留未完成的行

                    for (const line of lines) {
                        if (!line.trim()) continue;

                        // 心跳注释
                        if (line.startsWith(':')) {
                            process.stdout.write('💓');  // 显示心跳
                            continue;
                        }

                        if (line.startsWith('data:')) {
                            const data = line.slice(5).trim();
                            if (data === '[DONE]') {
                                console.log('\n📦 [DONE]');
                                continue;
                            }

                            try {
                                const chunk = JSON.parse(data);
                                if (chunk.choices && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                                    const content = chunk.choices[0].delta.content;
                                    contentReceived += content;
                                    process.stdout.write(content); // 实时输出内容
                                }
                                if (chunk.error) {
                                    console.log(`\n❌ 错误: ${chunk.error}`);
                                }
                            } catch (e) {
                                // 忽略解析错误
                            }
                        }
                    }
                });

                res.on('end', () => {
                    console.log(''); // 换行
                    if (res.statusCode === 200) {
                        resolve({ choices: [{ message: { content: contentReceived } }] });
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                });
            } else {
                // 非流式响应
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        const response = JSON.parse(data);
                        resolve(response);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            }
        });

        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

/**
 * 主流程
 */
(async () => {
    try {
        logger.info('Test', '=== API 独立测试脚本 ===');

        // 1. 输入提示词
        const prompt = await promptForInput();

        // 2. 输入图片路径
        const imagePaths = await promptForImages();

        // 3. 选择流式模式
        const isStreaming = await select({
            message: '选择请求模式',
            choices: [
                { name: '流式 (stream: true)', value: true },
                { name: '非流式 (stream: false)', value: false }
            ]
        });

        // 4. 执行测试
        logger.info('Test', '正在发送请求...');
        await testViaHttpOpenAI(prompt, null, imagePaths, isStreaming);

        logger.info('Test', '测试完成');
        process.exit(0);

    } catch (err) {
        logger.error('Test', '测试失败', { error: err.message });
        process.exit(1);
    }
})();
