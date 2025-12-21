/**
 * @fileoverview Google Gemini 文本生成适配器
 */

import {
    sleep,
    safeClick,
    uploadFilesViaChooser
} from '../engine/utils.js';
import {
    fillPrompt,
    normalizePageError,
    normalizeHttpError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck,
    waitApiResponse
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://gemini.google.com/app?hl=en';

/**
 * 执行文本生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} [modelId] - 模型 ID (此适配器未使用)
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{text?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;
    const inputLocator = page.getByRole('textbox');
    const sendBtnLocator = page.getByRole('button', { name: 'Send message' });

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        await waitForInput(page, inputLocator, { click: false });
        await sleep(1500, 2500);

        // 2. 上传图片
        if (imgPaths && imgPaths.length > 0) {
            logger.debug('适配器', '点击加号按钮...', meta);
            const uploadMenuBtn = page.getByRole('button', { name: 'Open upload file menu' });
            await safeClick(page, uploadMenuBtn, { bias: 'button' });
            await sleep(500, 1000);

            const uploadFilesBtn = page.getByRole('button', { name: /Upload files/ });
            await uploadFilesViaChooser(page, uploadFilesBtn, imgPaths, {
                uploadValidator: (response) => {
                    const url = response.url();
                    return response.status() === 200 &&
                        url.includes('google.com/upload/') &&
                        url.includes('upload_id=');
                }
            });

            await sleep(1000, 2000);
        }

        // 3. 填写提示词
        await safeClick(page, inputLocator, { bias: 'input' });
        await fillPrompt(page, inputLocator, prompt, meta);
        await sleep(500, 1000);

        // 4. 选择模型（如果指定了 modelId）
        if (modelId) {
            try {
                logger.debug('适配器', `准备选择模型: ${modelId}`, meta);

                // 点击输入框确保焦点
                await inputLocator.focus();
                await sleep(300, 500);

                // 按 3 次 Tab 键到达模型选择按钮
                await page.keyboard.press('Tab');
                await sleep(100, 200);
                await page.keyboard.press('Tab');
                await sleep(100, 200);
                await page.keyboard.press('Tab');
                await sleep(200, 300);

                // 按回车打开模型菜单
                await page.keyboard.press('Enter');
                await sleep(500, 800);

                // 获取所有 menuitemradio 选项
                const menuItems = await page.getByRole('menuitemradio').all();

                if (menuItems.length === 0) {
                    logger.warn('适配器', '未找到模型选项，使用默认模型', meta);
                } else {
                    // 获取所有选项的文本（去除前后空白）
                    const itemTexts = [];
                    for (const item of menuItems) {
                        const text = await item.textContent();
                        itemTexts.push((text || '').trim());
                    }

                    logger.debug('适配器', `可用模型选项: [${itemTexts.join('], [')}]`, meta);

                    // 判断是否有 Pro 选项
                    const hasPro = itemTexts.some(text => text.startsWith('Pro'));

                    // 确定要选择的目标选项文本前缀
                    let targetPrefix = null;

                    if (hasPro) {
                        // 有 Pro 选项的情况
                        if (modelId === 'gemini-3-pro' || modelId === 'gemini-exp-1206') {
                            targetPrefix = 'Pro';
                        } else if (modelId === 'gemini-3-flash' || modelId === 'gemini-2.0-flash-exp') {
                            targetPrefix = 'Thinking';
                        } else {
                            targetPrefix = 'Fast';
                        }
                    } else {
                        // 没有 Pro 选项的情况
                        if (modelId === 'gemini-3-pro' || modelId === 'gemini-exp-1206') {
                            targetPrefix = 'Thinking';
                        } else {
                            targetPrefix = 'Fast';
                        }
                    }

                    logger.debug('适配器', `目标模型前缀: "${targetPrefix}"`, meta);

                    // 查找并点击对应的选项
                    let found = false;
                    for (let i = 0; i < menuItems.length; i++) {
                        if (itemTexts[i].startsWith(targetPrefix)) {
                            await safeClick(page, menuItems[i], { bias: 'button' });
                            logger.info('适配器', `已选择模型: "${itemTexts[i]}"`, meta);
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        logger.warn('适配器', `未找到匹配的模型选项 (${targetPrefix})，使用默认模型`, meta);
                        // 按 Escape 关闭菜单
                        await page.keyboard.press('Escape');
                    }

                    await sleep(300, 500);
                }
            } catch (e) {
                logger.warn('适配器', `模型选择失败: ${e.message}，继续使用默认模型`, meta);
                // 尝试关闭可能打开的菜单
                try {
                    await page.keyboard.press('Escape');
                } catch { }
            }
        }

        // 5. 点击发送
        logger.debug('适配器', '点击发送...', meta);
        await safeClick(page, sendBtnLocator, { bias: 'button' });

        logger.info('适配器', '等待生成结果...', meta);

        // 5. 等待 API 响应
        let apiResponse;
        try {
            apiResponse = await waitApiResponse(page, {
                urlMatch: 'assistant.lamda.BardFrontendService/StreamGenerate',
                method: 'POST',
                timeout: 120000,
                meta
            });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 检查 HTTP 错误
        const httpError = normalizeHttpError(apiResponse);
        if (httpError) {
            logger.error('适配器', `API 返回错误: ${httpError.error}`, meta);
            return { error: `API 返回错误: ${httpError.error}` };
        }

        // 6. 解析响应体
        const bodyBuffer = await apiResponse.body();
        logger.debug('适配器', `收到响应体，字节数: ${bodyBuffer.length}`, meta);

        const text = getFinalAiTextFromResponse(bodyBuffer);

        if (text) {
            logger.info('适配器', `解析成功，文本长度: ${text.length}`, meta);
            return { text };
        } else {
            return { error: '未能从响应中提取文本' };
        }

    } catch (err) {
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally {
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'gemini_text',
    displayName: 'Google Gemini (文本生成)',

    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    models: [
        { id: 'gemini-2.0-flash-exp', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-exp-1206', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-3-pro', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-3-flash', imagePolicy: 'optional', type: 'text' }
    ],

    navigationHandlers: [],

    generate
};

// ==========================================
// 解析 gRPC Batchexecute
// ==========================================

/**
 * 解析 batchexecute/batch RPC 响应（直接操作 Buffer）
 * @param {Buffer} buf - 响应体 Buffer
 */
function parseLenFramedResponse(buf) {
    let i = 0;

    // 去掉 )]}\' 这种 XSSI 前缀（通常是第一行）
    if (buf.length >= 4 && buf[0] === 0x29 && buf[1] === 0x5d && buf[2] === 0x7d) {
        const firstNl = buf.indexOf(0x0a);
        if (firstNl !== -1) i = firstNl + 1;
    }

    const frames = [];

    const readLineBuf = () => {
        if (i >= buf.length) return null;
        const nl = buf.indexOf(0x0a, i);
        let line;
        if (nl === -1) {
            line = buf.slice(i);
            i = buf.length;
        } else {
            line = buf.slice(i, nl);
            i = nl + 1;
        }
        // strip trailing \r
        if (line.length && line[line.length - 1] === 0x0d) line = line.slice(0, -1);
        return line;
    };

    let pendingLen = null;

    while (true) {
        const lineBuf = readLineBuf();
        if (lineBuf === null) break;

        const lineStr = lineBuf.toString('utf8').trim();
        if (!lineStr) continue;

        // 先找长度行（纯数字）
        if (pendingLen === null) {
            if (/^\d+$/.test(lineStr)) pendingLen = Number(lineStr);
            continue;
        }

        // 读到 payload 行；大多数情况下 payload 是单行 JSON。
        // 这里**不依赖** pendingLen 的数值（它有时会不准），而是：
        //   1) 先尝试解析当前行
        //   2) 若报“JSON 未结束”一类错误，再把后续行拼上重试（极少见）
        let chunkBuf = lineBuf;
        let chunkStr = chunkBuf.toString('utf8').trim();

        while (true) {
            try {
                frames.push(JSON.parse(chunkStr));
                break;
            } catch (e) {
                // 只有在明显是“截断/未结束”的情况下，才继续拼下一行
                const msg = String(e && e.message || '');
                const looksTruncated = /Unexpected end of JSON input|Unterminated string/.test(msg);

                if (!looksTruncated) {
                    const head = chunkStr.slice(0, 220);
                    const tail = chunkStr.slice(-220);
                    throw new Error(
                        `Chunk JSON parse failed: ${msg}\n` +
                        `Chunk head: ${head}\n` +
                        `Chunk tail: ${tail}\n` +
                        `LenHeader: ${pendingLen} | ActualBytes: ${Buffer.byteLength(chunkStr, 'utf8')}`
                    );
                }

                // 读取下一行进行拼接，但如果下一行是“纯数字长度行”，不要吞掉它
                const savedPos = i;
                const next = readLineBuf();
                if (next === null) {
                    const head = chunkStr.slice(0, 220);
                    const tail = chunkStr.slice(-220);
                    throw new Error(
                        `Chunk JSON parse failed: ${msg} (EOF)\n` +
                        `Chunk head: ${head}\n` +
                        `Chunk tail: ${tail}\n` +
                        `LenHeader: ${pendingLen} | ActualBytes: ${Buffer.byteLength(chunkStr, 'utf8')}`
                    );
                }

                const nextStr = next.toString('utf8').trim();
                if (/^\d+$/.test(nextStr)) {
                    // 回退，交给外层当作下一段的 length line
                    i = savedPos;
                    const head = chunkStr.slice(0, 220);
                    const tail = chunkStr.slice(-220);
                    throw new Error(
                        `Chunk JSON parse failed: ${msg} (hit next length line)\n` +
                        `Chunk head: ${head}\n` +
                        `Chunk tail: ${tail}\n` +
                        `LenHeader: ${pendingLen} | ActualBytes: ${Buffer.byteLength(chunkStr, 'utf8')}`
                    );
                }

                // 把分隔符 \n 加回去
                chunkBuf = Buffer.concat([chunkBuf, Buffer.from('\n'), next]);
                chunkStr = chunkBuf.toString('utf8').trim();
            }
        }

        pendingLen = null;
    }

    return frames;
}

/**
 * 把 frame 里的 payload 再 parse 一次
 */
function extractPayloads(frames) {
    const payloads = [];
    for (const frame of frames) {
        if (!Array.isArray(frame)) continue;

        // frame 可能是 [["wrb.fr", null, "<jsonstr>"]] 也可能有多个 item
        for (const item of frame) {
            if (!Array.isArray(item)) continue;
            const payloadStr = item[2];
            if (typeof payloadStr !== "string") continue;

            try {
                payloads.push(JSON.parse(payloadStr));
            } catch {
                // ignore non-payload frames
            }
        }
    }
    return payloads;
}

/**
 * 在任意嵌套结构里，找形如 ["rc_xxx", ["text..."], ...] 的节点
 */
function collectRcTextsDeep(root) {
    const bestByRc = new Map();

    const stack = [root];
    while (stack.length) {
        const cur = stack.pop();
        if (!cur) continue;

        if (Array.isArray(cur)) {
            const maybeRc = cur[0];
            const maybeArr = cur[1];
            if (
                typeof maybeRc === "string" &&
                maybeRc.startsWith("rc_") &&
                Array.isArray(maybeArr)
            ) {
                const text = maybeArr.filter(v => typeof v === "string").join("");
                if (text) {
                    const prev = bestByRc.get(maybeRc) || "";
                    if (text.length >= prev.length) bestByRc.set(maybeRc, text);
                }
            }

            for (const v of cur) stack.push(v);
        } else if (typeof cur === "object") {
            for (const v of Object.values(cur)) stack.push(v);
        }
    }

    return bestByRc;
}

/**
 * 从响应体 Buffer 中提取最终 AI 文本
 * @param {Buffer} bodyBuffer - 响应体 Buffer
 */
function getFinalAiTextFromResponse(bodyBuffer) {
    const frames = parseLenFramedResponse(bodyBuffer);
    const payloads = extractPayloads(frames);

    let best = "";
    for (const payload of payloads) {
        const m = collectRcTextsDeep(payload);
        for (const text of m.values()) {
            if (text.length > best.length) best = text;
        }
    }
    return best;
}