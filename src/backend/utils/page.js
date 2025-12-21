/**
 * @fileoverview 页面交互工具
 * @description 页面认证锁、输入框等待、表单提交等页面级操作
 */

import { sleep, humanType, safeClick, isPageValid, createPageCloseWatcher, getRealViewport, clamp, random } from '../engine/utils.js';
import { logger } from '../../utils/logger.js';

// ==========================================
// 页面认证锁
// ==========================================

/**
 * 等待页面认证完成
 * @param {import('playwright-core').Page} page - 页面对象
 */
export async function waitForPageAuth(page) {
    while (page.authState?.isHandlingAuth) {
        await sleep(500, 1000);
    }
}

/**
 * 设置页面认证锁（加锁）
 * @param {import('playwright-core').Page} page - 页面对象
 */
export function lockPageAuth(page) {
    if (page.authState) page.authState.isHandlingAuth = true;
}

/**
 * 释放页面认证锁（解锁）
 * @param {import('playwright-core').Page} page - 页面对象
 */
export function unlockPageAuth(page) {
    if (page.authState) page.authState.isHandlingAuth = false;
}

/**
 * 检查页面是否正在处理认证
 * @param {import('playwright-core').Page} page - 页面对象
 * @returns {boolean}
 */
export function isPageAuthLocked(page) {
    return page.authState?.isHandlingAuth === true;
}

// ==========================================
// 输入框与表单
// ==========================================

/**
 * 等待输入框出现（自动等待认证完成）
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string|import('playwright-core').Locator} selectorOrLocator - 输入框选择器或 Locator 对象
 * @param {object} [options={}] - 选项
 * @param {number} [options.timeout=60000] - 超时时间（毫秒）
 * @param {boolean} [options.click=true] - 找到后是否点击输入框
 * @returns {Promise<void>}
 */
export async function waitForInput(page, selectorOrLocator, options = {}) {
    const { timeout = 20000, click = true } = options;

    const isLocator = typeof selectorOrLocator !== 'string';
    const displayName = isLocator ? 'Locator' : selectorOrLocator;
    const startTime = Date.now();

    // 等待认证完成
    while (isPageAuthLocked(page)) {
        if (Date.now() - startTime >= timeout) break;
        await sleep(500, 1000);
    }

    // 计算剩余超时时间
    const elapsed = Date.now() - startTime;
    const remainingTimeout = Math.max(timeout - elapsed, 5000);

    // 等待输入框出现
    if (isLocator) {
        await selectorOrLocator.first().waitFor({ state: 'visible', timeout: remainingTimeout }).catch(() => {
            throw new Error(`未找到输入框 (${displayName})`);
        });
    } else {
        await page.waitForSelector(selectorOrLocator, { timeout: remainingTimeout }).catch(() => {
            throw new Error(`未找到输入框 (${displayName})`);
        });
    }

    if (click) {
        await safeClick(page, selectorOrLocator, { bias: 'input' });
        await sleep(500, 1000);
    }
}

/**
 * 填写提示词 (通用)
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {string|import('playwright-core').ElementHandle} target - 输入目标
 * @param {string} prompt - 提示词内容
 * @param {object} [meta={}] - 日志元数据
 */
export async function fillPrompt(page, target, prompt, meta = {}) {
    logger.info('适配器', '正在输入提示词...', meta);
    await humanType(page, target, prompt);
    await sleep(800, 1500);
}

/**
 * 提交表单 (带回退逻辑)
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {object} options - 提交选项
 * @param {string} options.btnSelector - 按钮选择器
 * @param {string|import('playwright-core').ElementHandle} [options.inputTarget] - 输入框
 * @param {object} [options.meta={}] - 日志元数据
 * @returns {Promise<boolean>} 是否成功点击按钮
 */
export async function submit(page, options = {}) {
    const { btnSelector, inputTarget, meta = {} } = options;

    try {
        const btnHandle = await page.$(btnSelector);
        if (btnHandle) {
            await btnHandle.scrollIntoViewIfNeeded().catch(() => { });
            await sleep(200, 400);
            await safeClick(page, btnHandle, { bias: 'button' });
            return true;
        }
    } catch (e) {
        // 继续回退逻辑
    }

    // 回退：按回车提交
    logger.warn('适配器', '未找到发送按钮，尝试回车提交', meta);
    if (inputTarget) {
        if (typeof inputTarget === 'string') {
            await page.focus(inputTarget).catch(() => { });
        } else {
            await inputTarget.focus().catch(() => { });
        }
    }
    await page.keyboard.press('Enter');
    return false;
}

// ==========================================
// 导航与鼠标
// ==========================================

/**
 * 导航到指定 URL 并检测 HTTP 错误
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string} url - 目标 URL
 * @param {object} [options={}] - 选项
 * @param {number} [options.timeout=30000] - 超时时间（毫秒）
 * @throws {Error} 导航失败时抛出错误
 */
export async function gotoWithCheck(page, url, options = {}) {
    const { timeout = 20000 } = options;
    try {
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout
        });
        if (!response) {
            throw new Error('页面加载失败: 无响应');
        }
        const status = response.status();
        if (status >= 400) {
            throw new Error(`网站无法访问 (HTTP ${status})`);
        }
    } catch (e) {
        if (e.message.includes('Timeout')) {
            throw new Error('页面加载超时');
        }
        // 如果是我们自己抛出的错误，直接 re-throw
        if (e.message.startsWith('页面') || e.message.startsWith('网站')) {
            throw e;
        }
        throw new Error(`页面加载失败: ${e.message}`);
    }
}

/**
 * 尝试导航到 URL（不抛异常版本，用于需要收集错误的场景）
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string} url - 目标 URL
 * @param {object} [options={}] - 选项
 * @returns {Promise<{success?: boolean, error?: string}>}
 */
export async function tryGotoWithCheck(page, url, options = {}) {
    try {
        await gotoWithCheck(page, url, options);
        return { success: true };
    } catch (e) {
        return { error: e.message };
    }
}

/**
 * 任务完成后移开鼠标（拟人化行为）
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 */
export async function moveMouseAway(page) {
    if (!page.cursor) return;

    try {
        const vp = await getRealViewport(page);
        await page.cursor.moveTo({
            x: clamp(vp.safeWidth * random(0.85, 0.95), 0, vp.safeWidth),
            y: clamp(vp.height * random(0.3, 0.7), 0, vp.safeHeight)
        });
    } catch (e) {
        // 忽略鼠标移动失败
    }
}

/**
 * 等待 API 响应 (带页面关闭监听)
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {object} options - 等待选项
 * @param {string} options.urlMatch - URL 匹配字符串
 * @param {string|string[]} [options.urlContains] - URL 必须额外包含的字符串（可选，可以是数组）
 * @param {string} [options.method='POST'] - HTTP 方法
 * @param {number} [options.timeout=120000] - 超时时间（毫秒）
 * @returns {Promise<import('playwright-core').Response>} 响应对象
 */
export async function waitApiResponse(page, options = {}) {
    const { urlMatch, urlContains, method = 'POST', timeout = 120000 } = options;

    if (!isPageValid(page)) {
        throw new Error('PAGE_INVALID');
    }

    const pageWatcher = createPageCloseWatcher(page);

    try {
        const responsePromise = page.waitForResponse(
            response => {
                const url = response.url();

                // 基础匹配
                if (!url.includes(urlMatch)) return false;

                // 额外的 URL 包含检查
                if (urlContains) {
                    const containsArray = Array.isArray(urlContains) ? urlContains : [urlContains];
                    if (!containsArray.every(str => url.includes(str))) return false;
                }

                // 方法和状态检查
                return response.request().method() === method &&
                    (response.status() === 200 || response.status() >= 400);
            },
            { timeout }
        );

        return await Promise.race([responsePromise, pageWatcher.promise]);
    } finally {
        pageWatcher.cleanup();
    }
}
