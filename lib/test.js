import { getBackend } from './backend/index.js';
import { getModelsForBackend, resolveModelId } from './backend/models.js';
import { select, input } from '@inquirer/prompts';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { logger } from './logger.js';

// 使用统一后端获取配置和函数
const { config, name, initBrowser, generateImage, TEMP_DIR } = getBackend();

logger.info('CLI/Test', `测试工具启动 (后端适配器: ${name})`);

/**
 * 选择测试模式
 */
async function selectTestMode() {
    const mode = await select({
        message: '选择测试模式',
        choices: [
            { name: 'HTTP 服务器测试（需先启动服务器）', value: 'http' },
            { name: '直接调用适配器', value: 'direct' }
        ]
    });
    return mode;
}

/**
 * 选择模型
 */
async function selectModel() {
    const models = getModelsForBackend(name);
    const choices = [
        { name: 'Skip（使用默认模型）', value: null },
        ...models.data.map(m => ({ name: m.id, value: m.id }))
    ];

    const modelId = await select({
        message: '选择模型',
        choices,
        pageSize: 15
    });

    return modelId;
}

/**
 * 输入提示词
 */
async function promptForInput() {
    const prompt = await input({
        message: '输入提示词（回车使用默认）',
        default: 'A cute cat'
    });
    return prompt.trim();
}

/**
 * 输入图片路径
 */
async function promptForImages() {
    const imagesInput = await input({
        message: '输入图片路径（逗号分隔，回车跳过）',
        default: ''
    });

    if (!imagesInput.trim()) {
        return [];
    }

    return imagesInput.split(',').map(p => p.trim()).filter(p => p);
}

/**
 * HTTP 测试模式 - OpenAI 格式
 */
async function testViaHttpOpenAI(prompt, modelId, imagePaths) {
    const PORT = config.server.port || 3000;
    const AUTH_TOKEN = config.server.auth;

    logger.info('CLI/Test', 'HTTP 测试 - OpenAI 模式');

    return new Promise((resolve, reject) => {
        // 构造请求体
        const messages = [];
        const lastMessage = { role: 'user', content: [] };

        // 添加文本
        if (prompt) {
            lastMessage.content.push({ type: 'text', text: prompt });
        }

        // 添加图片
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
                logger.warn('CLI/Test', `图片不存在，已跳过: ${imgPath}`);
            }
        }

        messages.push(lastMessage);

        const body = {
            messages,
            ...(modelId && { model: modelId })
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
        });

        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

/**
 * HTTP 测试模式 - Queue 格式
 */
async function testViaHttpQueue(prompt, modelId, imagePaths) {
    const PORT = config.server.port || 3000;
    const AUTH_TOKEN = config.server.auth;

    logger.info('CLI/Test', 'HTTP 测试 - Queue 模式');

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
                logger.warn('CLI/Test', `图片不存在，已跳过: ${imgPath}`);
            }
        }

        messages.push(lastMessage);

        const body = {
            messages,
            ...(modelId && { model: modelId })
        };

        const bodyStr = JSON.stringify(body);

        const options = {
            hostname: '127.0.0.1',
            port: PORT,
            path: '/v1/queue/join',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'Authorization': `Bearer ${AUTH_TOKEN}`
            }
        };

        const req = http.request(options, (res) => {
            let buffer = '';
            res.on('data', chunk => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留未完成的行

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data:')) continue;

                    const data = line.slice(5).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const event = JSON.parse(data);
                        if (event.status === 'error') {
                            reject(new Error(event.msg));
                        } else if (event.status === 'completed') {
                            resolve(event);
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            });

            res.on('end', () => {
                // SSE 结束
            });
        });

        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

/**
 * 直接调用适配器测试
 */
async function testViaDirect(prompt, modelId, imagePaths) {
    logger.info('CLI/Test', '直接调用适配器测试');

    // 初始化浏览器
    const context = await initBrowser(config);

    // 解析模型 ID
    const resolvedModelId = modelId ? resolveModelId(name, modelId) : null;

    // 执行生图
    const result = await generateImage(context, prompt, imagePaths, resolvedModelId);

    if (result.error) {
        throw new Error(result.error);
    }

    return result;
}

/**
 * 保存图片
 */
function saveImage(base64Data) {
    const testSaveDir = path.join(TEMP_DIR, 'testSave');
    if (!fs.existsSync(testSaveDir)) {
        fs.mkdirSync(testSaveDir, { recursive: true });
    }

    const timestamp = Date.now();
    const savePath = path.join(testSaveDir, `test_${timestamp}.png`);

    // 移除 Data URI 前缀（如果有）
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(savePath, Buffer.from(cleanBase64, 'base64'));

    logger.info('CLI/Test', `图片已保存: ${savePath}`);
    return savePath;
}

/**
 * 主流程
 */
(async () => {
    try {
        // 1. 选择测试模式
        const testMode = await selectTestMode();
        logger.info('CLI/Test', `测试模式: ${testMode === 'http' ? 'HTTP 服务器' : '直接调用'}`);

        // 2. 选择模型
        const modelId = await selectModel();
        if (modelId) {
            logger.info('CLI/Test', `选择模型: ${modelId}`);
        } else {
            logger.info('CLI/Test', '跳过模型选择，使用默认');
        }

        // 3. 输入提示词
        const prompt = await promptForInput();
        logger.info('CLI/Test', `提示词: ${prompt}`);

        // 4. 输入图片路径
        const imagePaths = await promptForImages();
        if (imagePaths.length > 0) {
            logger.info('CLI/Test', `参考图片: ${imagePaths.join(', ')}`);
        }

        // 5. 执行测试
        let result;
        if (testMode === 'http') {
            const serverType = config.server.type || 'openai';
            if (serverType === 'queue') {
                result = await testViaHttpQueue(prompt, modelId, imagePaths);
            } else {
                result = await testViaHttpOpenAI(prompt, modelId, imagePaths);
            }

            // 处理 HTTP 响应
            if (result.choices) {
                // OpenAI 格式
                const content = result.choices[0].message.content;
                logger.info('CLI/Test', `响应内容: ${content.slice(0, 100)}...`);

                // 提取图片（如果有）
                const match = content.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
                if (match) {
                    saveImage(match[1]);
                } else {
                    logger.info('CLI/Test', `文本回复: ${content}`);
                }
            } else if (result.image) {
                // Queue 格式
                saveImage(result.image);
            } else if (result.msg) {
                logger.info('CLI/Test', `文本回复: ${result.msg}`);
            }

        } else {
            // 直接调用
            result = await testViaDirect(prompt, modelId, imagePaths);

            if (result.image) {
                saveImage(result.image);
            } else if (result.text) {
                logger.info('CLI/Test', `文本回复: ${result.text}`);
            }
        }

        logger.info('CLI/Test', '测试完成');
        process.exit(0);

    } catch (err) {
        logger.error('CLI/Test', '测试失败', { error: err.message });
        process.exit(1);
    }
})();