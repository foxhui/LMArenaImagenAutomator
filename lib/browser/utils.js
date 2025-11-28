import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';

/**
 * 生成指定范围内的随机数
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @returns {number} 随机数
 */
export function random(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * 随机休眠一段时间
 * @param {number} min 最小毫秒数
 * @param {number} max 最大毫秒数
 * @returns {Promise<void>}
 */
export function sleep(min, max) {
    return new Promise(r => setTimeout(r, Math.floor(random(min, max))));
}

/**
 * 根据文件扩展名获取 MIME 类型
 * @param {string} filePath 文件路径
 * @returns {string} MIME 类型
 */
export function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    };
    return map[ext] || 'application/octet-stream';
}

/**
 * [Security Enhanced] 无痕获取当前页面实时视口
 * 使用纯净的匿名函数执行,不污染 Global Scope,不留指纹
 * @param {import('puppeteer').Page} page - Puppeteer 页面实例
 * @returns {Promise<{width: number, height: number, safeWidth: number, safeHeight: number}>} 视口尺寸及安全区域
 */
export async function getRealViewport(page) {
    try {
        return await page.evaluate(() => {
            // 仅读取标准属性,不进行任何写入操作
            const w = window.innerWidth;
            const h = window.innerHeight;
            return {
                width: w,
                height: h,
                // 预留 20px 缓冲,防止鼠标移到滚动条上或贴边触发浏览器原生手势
                safeWidth: w - 20,
                safeHeight: h
            };
        });
    } catch (e) {
        // Fallback: 如果上下文丢失,返回安全保守值
        return { width: 1280, height: 720, safeWidth: 1260, safeHeight: 720 };
    }
}

/**
 * [Safety] 坐标钳位函数
 * 强制将坐标限制在合法视口范围内,杜绝 "Node is not visible" 报错
 * @param {number} value - 原始坐标值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 修正后的坐标值
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * 深度查找 Shadow DOM 中的元素
 * @param {import('puppeteer').Page} page - Puppeteer 页面实例
 * @param {string} selector - CSS 选择器
 * @param {import('puppeteer').ElementHandle} [rootHandle=null] - 可选的根节点句柄
 * @returns {Promise<import('puppeteer').ElementHandle|null>} 找到的元素句柄或 null
 */
export async function queryDeep(page, selector, rootHandle = null) {
    return await page.evaluateHandle((sel, root) => {
        function find(node, s) {
            if (!node) return null;
            if (node instanceof Element && node.matches(s)) return node;
            let found = node.querySelector(s);
            if (found) return found;
            if (node.shadowRoot) {
                found = find(node.shadowRoot, s);
                if (found) return found;
            }
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, null, false);
            while (walker.nextNode()) {
                const child = walker.currentNode;
                if (child.shadowRoot) {
                    found = find(child.shadowRoot, s);
                    if (found) return found;
                }
            }
            return null;
        }
        return find(root || document.body, sel);
    }, selector, rootHandle);
}

/**
 * 安全点击元素(包含拟人化移动和点击)
 * 支持 CSS selector 和 ElementHandle 两种输入
 * @param {import('puppeteer').Page} page - Puppeteer 页面对象
 * @param {string|import('puppeteer').ElementHandle} target - CSS 选择器或元素句柄
 * @returns {Promise<void>}
 */
export async function safeClick(page, target) {
    try {
        let el;

        // 判断是 selector 还是 ElementHandle
        if (typeof target === 'string') {
            el = await page.$(target);
            if (!el) throw new Error(`未找到: ${target}`);
        } else {
            el = target;
            if (!el || !el.asElement()) throw new Error(`Element handle invalid`);
        }

        // 使用 ghost-cursor 点击
        if (page.cursor) {
            await page.cursor.click(el);
            return;
        }

        // 降级逻辑
        await el.click();
    } catch (err) {
        throw err;
    }
}

/**
 * 模拟人类键盘输入
 * 支持 CSS selector 和 ElementHandle 两种输入
 * @param {import('puppeteer').Page} page - Puppeteer 页面对象
 * @param {string|import('puppeteer').ElementHandle} target - CSS 选择器或元素句柄
 * @param {string} text - 要输入的文本
 * @returns {Promise<void>}
 */
export async function humanType(page, target, text) {
    let el;

    // 判断是 selector 还是 ElementHandle
    if (typeof target === 'string') {
        el = await page.$(target);
        if (!el) throw new Error(`Element not found: ${target}`);
    } else {
        el = target;
        if (!el) throw new Error(`Element handle invalid`);
    }

    await el.focus();

    // 智能输入策略
    if (text.length < 50) {
        // 短文本:保持拟人化逐字输入
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            // 模拟错字 (5% 概率)
            if (Math.random() < 0.05) {
                await page.keyboard.type('x', { delay: random(50, 150) });
                await sleep(100, 300);
                await page.keyboard.press('Backspace', { delay: random(50, 100) });
            }
            await page.keyboard.type(char, { delay: random(30, 100) });
            // 随机击键间隔
            await sleep(30, 100);
        }
    } else {
        // 长文本:假装打字 -> 停顿 -> 粘贴
        const fakeCount = Math.floor(random(3, 8));
        const fakeText = text.substring(0, fakeCount);

        // 1. 假装打字几个字符
        for (let i = 0; i < fakeText.length; i++) {
            await page.keyboard.type(fakeText[i], { delay: random(30, 100) });
        }

        // 2. 停顿思考 (0.5 - 1秒)
        await sleep(500, 1000);

        // 3. 全选删除 (模拟 Ctrl+A -> Backspace)
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await sleep(100, 300);
        await page.keyboard.press('Backspace');
        await sleep(100, 300);

        // 4. 瞬间粘贴全部文本 (模拟 Ctrl+V)
        if (typeof target === 'string') {
            // 对于 selector,使用 querySelector
            await page.evaluate((sel, content) => {
                const input = document.querySelector(sel);
                input.focus();
                document.execCommand('insertText', false, content);
            }, target, text);
        } else {
            // 对于 ElementHandle,直接使用
            await page.evaluate((el, content) => {
                el.focus();
                document.execCommand('insertText', false, content);
            }, el, text);
        }
    }
}

/**
 * 粘贴图片到输入框
 * 支持 CSS selector 和 ElementHandle 两种输入
 * @param {import('puppeteer').Page} page - Puppeteer 页面对象
 * @param {string|import('puppeteer').ElementHandle} target - CSS 选择器或元素句柄
 * @param {string[]} filePaths - 图片文件路径数组
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.uploadValidator] - 自定义上传确认回调函数,接收 response 参数
 * @returns {Promise<void>}
 */
export async function pasteImages(page, target, filePaths, options = {}) {
    if (!filePaths || filePaths.length === 0) return;
    logger.info('浏览器', `正在粘贴 ${filePaths.length} 张图片...`);
    // 读取图片文件并转换为 Base64
    const filesData = filePaths.map(p => {
        const clean = p.replace(/['"]/g, '').trim();
        if (!fs.existsSync(clean)) return null;
        return {
            base64: fs.readFileSync(clean).toString('base64'),
            mime: getMimeType(clean),
            filename: path.basename(clean)
        };
    }).filter(f => f);

    if (filesData.length === 0) return;

    // 点击输入框以获取焦点
    await safeClick(page, target);
    await sleep(500, 800);

    // 如果提供了自定义的上传确认函数,使用它
    if (options.uploadValidator && typeof options.uploadValidator === 'function') {
        const expectedUploads = filesData.length;
        let validatedCount = 0;

        const uploadPromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                cleanup();
                logger.warn('浏览器', `图片上传等待超时 (已确认: ${validatedCount}/${expectedUploads})`);
                resolve();
            }, 60000); // 60s 超时

            const onResponse = (response) => {
                if (options.uploadValidator(response)) {
                    validatedCount++;
                    logger.info('浏览器', `图片上传进度: ${validatedCount}/${expectedUploads}`);
                    if (validatedCount >= expectedUploads) {
                        cleanup();
                        resolve();
                    }
                }
            };

            const cleanup = () => {
                clearTimeout(timeout);
                page.off('response', onResponse);
            };

            page.on('response', onResponse);
        });

        // 执行粘贴
        await executePaste(page, target, filesData);
        logger.info('浏览器', `粘贴完成，正在等待图片上传确认...`);
        await uploadPromise;
        logger.info('浏览器', `所有图片上传完成`);
    } else {
        // 默认行为:简单粘贴并等待固定时间
        await executePaste(page, target, filesData);
        logger.info('浏览器', `粘贴完成，等待缩略图缓冲`);
        // 等待图片上传和缩略图生成
        await sleep(2500, 4000);
    }
}

/**
 * 执行粘贴操作的内部函数
 * @private
 */
async function executePaste(page, target, filesData) {
    // 统一处理 selector 和 ElementHandle
    if (typeof target === 'string') {
        await page.evaluate(async (sel, files) => {
            const element = document.querySelector(sel);
            const dt = new DataTransfer();
            for (const f of files) {
                const bin = atob(f.base64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                dt.items.add(new File([arr], f.filename, { type: f.mime }));
            }
            element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
        }, target, filesData);
    } else {
        await page.evaluate(async (el, files) => {
            const dt = new DataTransfer();
            for (const f of files) {
                const bin = atob(f.base64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                dt.items.add(new File([arr], f.filename, { type: f.mime }));
            }
            el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
        }, target, filesData);
    }
}
