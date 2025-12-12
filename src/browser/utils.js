/**
 * @fileoverview 浏览器自动化工具函数
 * @description 封装 Playwright 页面常用操作（等待、查找、点击、上传、拟人化行为等），供后端适配器复用。
 *
 * 主要函数：
 * - `random` / `sleep`：随机与延迟工具
 * - `getMimeType`：根据文件扩展名推断 MIME
 * - `getRealViewport` / `clamp`：视口与坐标工具（防止越界）
 * - `queryDeep`：深层查询（包含 Shadow DOM / iframe）
 * - `safeClick` / `humanType`：拟人化点击与输入
 * - `pasteImages` / `uploadFilesViaChooser`：图片粘贴/上传辅助
 * - `isPageValid` / `createPageCloseWatcher`：页面有效性与关闭/崩溃监听
 * - `getCookies`：读取 Cookies（JSON 格式）
 */

import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * 生成指定范围内的随机数
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 随机数
 */
export function random(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * 随机休眠一段时间
 * @param {number} min - 最小毫秒数
 * @param {number} max - 最大毫秒数
 * @returns {Promise<void>}
 */
export function sleep(min, max) {
    return new Promise(r => setTimeout(r, Math.floor(random(min, max))));
}

/**
 * 根据文件扩展名获取 MIME 类型
 * @param {string} filePath - 文件路径
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
 * 无痕获取当前页面实时视口
 * 使用纯净的匿名函数执行，不污染 Global Scope
 * @param {import('playwright-core').Page} page - Playwright 页面实例
 * @returns {Promise<{width: number, height: number, safeWidth: number, safeHeight: number}>} 视口尺寸及安全区域
 */
export async function getRealViewport(page) {
    try {
        return await page.evaluate(() => {
            // 仅读取标准属性，不进行任何写入操作
            const w = window.innerWidth;
            const h = window.innerHeight;
            return {
                width: w,
                height: h,
                // 预留 20px 缓冲，防止鼠标移到滚动条上或贴边触发浏览器原生手势
                safeWidth: w - 20,
                safeHeight: h
            };
        });
    } catch (e) {
        // Fallback: 如果上下文丢失，返回安全保守值
        return { width: 1280, height: 720, safeWidth: 1260, safeHeight: 720 };
    }
}

/**
 * 坐标钳位函数
 * 强制将坐标限制在合法视口范围内，防止 "Node is not visible" 报错
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
 * @param {import('playwright-core').Page} page - Playwright 页面实例
 * @param {string} selector - CSS 选择器
 * @param {import('playwright-core').ElementHandle} [rootHandle=null] - 可选的根节点句柄
 * @returns {Promise<import('playwright-core').ElementHandle|null>} 找到的元素句柄或 null
 */
export async function queryDeep(page, selector, rootHandle = null) {
    // Playwright evaluateHandle 只接受一个参数，包装成数组传递
    return await page.evaluateHandle(([sel, root]) => {
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
    }, [selector, rootHandle]);
}

/**
 * 计算拟人化的随机点击坐标
 * @param {object} box - 元素边界框 {x, y, width, height}
 * @param {string} [type='random'] - 点击类型: 'input'(偏左) 或 'random'/'button'(随机)
 * @returns {{x: number, y: number}} 计算出的坐标
 */
export function getHumanClickPoint(box, type = 'random') {
    let x, y;
    if (type === 'input') {
        // 输入框: 偏左 (5% - 40% 宽度), 垂直居中附近 (20% - 80% 高度)
        x = box.x + box.width * random(0.05, 0.4);
        y = box.y + box.height * random(0.2, 0.8);
    } else {
        // 按钮/其他: 中心附近随机 (20% - 80% 宽度/高度)
        x = box.x + box.width * random(0.2, 0.8);
        y = box.y + box.height * random(0.2, 0.8);
    }
    return { x, y };
}

/**
 * 安全点击元素 (包含拟人化移动和点击)
 * 支持 CSS selector、ElementHandle 和 Locator 三种输入
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {string|import('playwright-core').ElementHandle|import('playwright-core').Locator} target - CSS 选择器、元素句柄或 Locator
 * @param {object} [options] - 点击选项
 * @param {string} [options.bias='random'] - 偏移偏好: 'input' 或 'random'
 * @returns {Promise<void>}
 */
export async function safeClick(page, target, options = {}) {
    try {
        let el;

        // 判断输入类型
        if (typeof target === 'string') {
            // CSS selector
            el = await page.$(target);
            if (!el) throw new Error(`未找到: ${target}`);
        } else if (typeof target.elementHandle === 'function') {
            // Locator (来自 page.getByRole, page.getByText 等)
            el = await target.elementHandle();
            if (!el) throw new Error(`Locator 未匹配到元素`);
        } else {
            // ElementHandle
            el = target;
            if (!el || !el.asElement()) throw new Error(`Element handle invalid`);
        }

        // 使用 ghost-cursor 点击
        if (page.cursor) {
            const box = await el.boundingBox();
            if (box) {
                const { x, y } = getHumanClickPoint(box, options.bias || 'random');
                await page.cursor.moveTo({ x, y });
                await page.mouse.click(x, y);
                return;
            }
            // 如果无法获取 box，降级到默认点击
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
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {string|import('playwright-core').ElementHandle} target - CSS 选择器或元素句柄
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
        // 短文本: 保持拟人化逐字输入
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            // 处理换行符 (避免触发发送)
            if (char === '\r' && nextChar === '\n') {
                // Windows 换行符 (\r\n)
                await page.keyboard.down('Shift');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Shift');
                i++; // 跳过 \n
                await sleep(30, 100);
                continue;
            } else if (char === '\n' || char === '\r') {
                // Unix/Mac 换行符 (\n 或 \r)
                await page.keyboard.down('Shift');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Shift');
                await sleep(30, 100);
                continue;
            }

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
        // 长文本: 假装打字 -> 停顿 -> 粘贴
        const fakeCount = Math.floor(random(3, 8));
        const fakeText = text.substring(0, fakeCount);

        // 1. 假装打字几个字符
        for (let i = 0; i < fakeText.length; i++) {
            await page.keyboard.type(fakeText[i], { delay: random(30, 100) });
        }

        // 2. 停顿思考
        await sleep(500, 1000);

        // 3. 全选删除 (macOS 使用 Meta/Command, Windows/Linux 使用 Control)
        const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page.keyboard.down(modifierKey);
        await page.keyboard.press('A');
        await page.keyboard.up(modifierKey);
        await sleep(100, 300);
        await page.keyboard.press('Backspace');
        await sleep(100, 300);

        // 4. 瞬间粘贴全部文本 (始终使用已获取的 ElementHandle，支持 Shadow DOM)
        await page.evaluate((content) => {
            document.execCommand('insertText', false, content);
        }, text);
    }
}

/**
 * 查找页面上所有的文件输入框 (包括 Shadow DOM)
 * @private
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @returns {Promise<import('playwright-core').ElementHandle[]>} 文件输入框 ElementHandle 数组
 */
async function findAllFileInputs(page) {
    // 使用 Playwright 的 evaluateHandle 在浏览器上下文中深度遍历
    const inputsHandle = await page.evaluateHandle(() => {
        const inputs = [];

        function traverse(root) {
            if (!root) return;

            // 1. 检查当前节点下的 input
            const nodes = root.querySelectorAll('input[type="file"]');
            nodes.forEach(n => inputs.push(n));

            // 2. 遍历 Shadow DOM
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.shadowRoot) {
                    traverse(node.shadowRoot);
                }
            }
        }

        traverse(document.body);
        return inputs;
    });

    const properties = await inputsHandle.getProperties();
    const handles = [];
    for (const prop of properties.values()) {
        const elementHandle = prop.asElement();
        if (elementHandle) handles.push(elementHandle);
    }
    return handles;
}

/**
 * 统一图片上传入口 (Camoufox/Playwright 专用稳定版)
 * 策略: 深度搜索原生 input[type="file"] -> setInputFiles
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {string|import('playwright-core').ElementHandle} target - CSS 选择器或元素句柄 (用于聚焦)
 * @param {string[]} filePaths - 图片文件路径数组
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.uploadValidator] - 自定义上传确认回调函数, 接收 response 参数
 * @returns {Promise<void>}
 */
export async function pasteImages(page, target, filePaths, options = {}) {
    if (!filePaths || filePaths.length === 0) return;
    logger.info('浏览器', `正在处理 ${filePaths.length} 张图片...`);

    // 1. 拟人化: 先点击一下目标区域 (让后台看起来像是用户聚焦了输入框)
    await safeClick(page, target, { bias: 'input' });
    await sleep(500, 1000);

    try {
        logger.debug('浏览器', '正在深度扫描文件上传控件...');
        const fileInputs = await findAllFileInputs(page);

        if (fileInputs.length === 0) {
            throw new Error('未找到任何 input[type="file"] 控件,无法上传');
        }

        logger.info('浏览器', `找到 ${fileInputs.length} 个文件输入框,尝试上传...`);

        // LMArena 通常只有一个用于聊天的上传控件，或者我们尝试第一个可用的
        // 如果有多个，通常最后一个是当前对话框的，或者我们可以尝试全部 (比较暴力但有效)
        let uploaded = false;

        for (const handle of fileInputs) {
            try {
                // 检查元素是否连接在 DOM 上
                const isConnected = await handle.evaluate(el => el.isConnected);
                if (!isConnected) continue;

                // 使用 Playwright 原生上传 (绕过所有事件拦截)
                await handle.setInputFiles(filePaths);
                uploaded = true;
                logger.debug('浏览器', '已通过原生控件提交图片');
                break; // 只要有一个成功就停止
            } catch (e) {
                // 忽略不可操作的 input (比如被禁用的)
                logger.debug('浏览器', `跳过不可用的文件输入框: ${e.message}`);
            }
        }

        if (!uploaded) {
            throw new Error('所有文件控件均无法接受输入');
        }

        // 如果提供了自定义的上传确认函数，使用它
        if (options.uploadValidator && typeof options.uploadValidator === 'function') {
            const expectedUploads = filePaths.length;
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

            logger.info('浏览器', `已提交图片, 正在等待上传确认...`);
            await uploadPromise;
            logger.info('浏览器', `所有图片上传完成`);
        } else {
            // 默认行为: 等待上传预览出现
            logger.info('浏览器', `已提交图片, 等待预览生成...`);
            await sleep(2000, 4000);
        }

    } catch (e) {
        logger.error('浏览器', `上传失败: ${e.message}`);
        throw e;
    }
}

/**
 * 通过 filechooser 事件上传文件 (适用于无 DOM input 元素的场景，如 Firefox)
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {string|import('playwright-core').ElementHandle|import('playwright-core').Locator} triggerTarget - 触发文件选择的按钮
 * @param {string[]} filePaths - 文件路径数组
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.uploadValidator] - 自定义上传确认回调函数, 接收 response 参数，返回 true 表示该响应代表一次成功上传
 * @param {number} [options.timeout=60000] - 上传超时时间 (毫秒)
 * @returns {Promise<void>}
 */
export async function uploadFilesViaChooser(page, triggerTarget, filePaths, options = {}) {
    if (!filePaths || filePaths.length === 0) return;

    const timeout = options.timeout || 60000;
    const expectedUploads = filePaths.length;
    let uploadedCount = 0;

    logger.info('浏览器', `正在处理 ${filePaths.length} 张图片 (filechooser 模式)...`);

    // 设置上传确认监听
    const uploadPromise = new Promise((resolve) => {
        if (!options.uploadValidator) {
            // 无验证器，直接 resolve
            resolve();
            return;
        }

        const timeoutId = setTimeout(() => {
            cleanup();
            logger.warn('浏览器', `图片上传等待超时 (已确认: ${uploadedCount}/${expectedUploads})`);
            resolve();
        }, timeout);

        const onResponse = (response) => {
            if (options.uploadValidator(response)) {
                uploadedCount++;
                logger.info('浏览器', `图片上传进度: ${uploadedCount}/${expectedUploads}`);
                if (uploadedCount >= expectedUploads) {
                    cleanup();
                    resolve();
                }
            }
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            page.off('response', onResponse);
        };

        page.on('response', onResponse);
    });

    // 设置等待 filechooser 事件（在点击之前）
    const fileChooserPromise = page.waitForEvent('filechooser');

    // 点击触发按钮
    await safeClick(page, triggerTarget, { bias: 'button' });

    // 等待 filechooser 事件并设置文件
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePaths);
    logger.debug('浏览器', '已通过 filechooser 提交文件');

    // 等待上传完成（如果有验证器）
    if (options.uploadValidator) {
        await uploadPromise;
        logger.info('浏览器', '所有图片上传完成');
    }
}

/**
 * 检查页面是否有效
 * @param {import('playwright-core').Page} page
 * @returns {boolean}
 */
export function isPageValid(page) {
    try {
        return page && !page.isClosed();
    } catch {
        return false;
    }
}

/**
 * 创建页面关闭/崩溃监听Promise
 * @param {import('playwright-core').Page} page
 * @returns {{promise: Promise, cleanup: Function}}
 */
export function createPageCloseWatcher(page) {
    let closeHandler, crashHandler;

    const promise = new Promise((_, reject) => {
        closeHandler = () => reject(new Error('PAGE_CLOSED'));
        crashHandler = () => reject(new Error('PAGE_CRASHED'));

        page.once('close', closeHandler);
        page.once('crash', crashHandler);
    });

    const cleanup = () => {
        if (closeHandler) page.off('close', closeHandler);
        if (crashHandler) page.off('crash', crashHandler);
    };

    return { promise, cleanup };
}

/**
 * 获取当前页面的所有 Cookies (实时从浏览器获取)
 * @param {import('playwright-core').Page} page - Playwright 页面实例
 * @returns {Promise<object[]>} Cookies 数组 (JSON 格式)
 */
export async function getCookies(page) {
    const context = page.context();
    return await context.cookies();
}
