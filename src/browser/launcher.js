/**
 * @fileoverview 浏览器启动与生命周期管理
 * @description 负责启动 Camoufox（Playwright 内核）、注入指纹与代理、创建/复用页面，并在进程退出时做资源清理。
 *
 * 约定：
 * - 登录模式会尽量保留 Profile（用户数据目录）
 * - 清理采用三级退出：Playwright close -> SIGTERM -> SIGKILL
 */

import { Camoufox } from 'camoufox-js';
import { FingerprintGenerator } from 'fingerprint-generator';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createCursor } from 'ghost-cursor-playwright-port';
import { getRealViewport, clamp, random, sleep } from './utils.js';
import { logger } from '../utils/logger.js';
import { getBrowserProxy, cleanupProxy } from '../utils/proxy.js';

// 全局状态：用于在登录模式下管理残留进程与复用上下文
let globalBrowserProcess = null;
let globalContext = null; // 替代 globalBrowser

/**
 * 清理浏览器资源和进程
 * 实现三级退出机制: Playwright close -> SIGTERM -> SIGKILL
 * @returns {Promise<void>}
 */
export async function cleanup() {

    // Level 1: 通过 Playwright 协议优雅关闭 Context，保存 Profile
    if (globalContext) {
        try {
            logger.debug('浏览器', '正在断开远程调试连接并保存 Profile...');
            await globalContext.close();
            globalContext = null;
            logger.debug('浏览器', '已关闭浏览器上下文');
        } catch (e) {
            logger.warn('浏览器', `关闭上下文失败: ${e.message}`);
        }
    }

    // Level 2 & 3: 处理残留进程 (主要用于登录模式)
    if (globalBrowserProcess && !globalBrowserProcess.killed) {
        logger.info('浏览器', '正在终止浏览器进程...');
        try {
            // Level 2: 发送 SIGTERM (软杀)
            globalBrowserProcess.kill('SIGTERM');

            // 等待进程退出
            const start = Date.now();
            while (Date.now() - start < 2000) {
                try {
                    process.kill(globalBrowserProcess.pid, 0);
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    break;
                }
            }
        } catch (e) { }

        // Level 3: 强制查杀 (SIGKILL)
        try {
            process.kill(globalBrowserProcess.pid, 0);
            logger.debug('浏览器', '浏览器进程无响应，执行强制终止 (SIGKILL)...');
            process.kill(-globalBrowserProcess.pid, 'SIGKILL');
        } catch (e) { }

        globalBrowserProcess = null;
        logger.info('浏览器', '浏览器进程已终止');
    }

    // 清理代理
    await cleanupProxy();
}

// 防止重复注册
let signalHandlersRegistered = false;

/**
 * 注册进程退出信号处理
 * @private
 */
function registerCleanupHandlers() {
    if (signalHandlersRegistered) return;

    process.on('exit', () => {
        if (globalBrowserProcess) globalBrowserProcess.kill();
    });

    process.on('SIGINT', async () => {
        await cleanup();
        process.exit();
    });

    process.on('SIGTERM', async () => {
        await cleanup();
        process.exit();
    });

    signalHandlersRegistered = true;
}

/**
 * 获取当前操作系统名称
 * 将 Node.js 的 platform 转换为 Camoufox/FingerprintGenerator 支持的格式
 */
function getCurrentOS() {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    // 其他情况默认为 linux
    return 'linux';
}

/**
 * 获取或生成持久化指纹
 * @param {string} filePath - JSON文件保存路径
 */
function getPersistentFingerprint(filePath) {
    // 确保 data 目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // 尝试读取现有指纹
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const savedData = JSON.parse(fileContent);

            // 简单校验：确保读取的是一个对象
            if (savedData && typeof savedData === 'object') {
                logger.info('浏览器', '已加载本地持久化指纹');
                return savedData;
            }
        } catch (e) {
            logger.warn('浏览器', `读取指纹文件失败，将重新生成: ${e.message}`);
        }
    }

    // 生成新指纹
    const currentOS = getCurrentOS();
    logger.info('浏览器', `正在为系统 [${currentOS}] 生成新指纹...`);

    // 为不同系统使用不同的配置策略
    const generatorOptions = {
        browsers: ['firefox'],
        operatingSystems: [currentOS],
        devices: ['desktop'],
        locales: ['en-US'],
        screen: {
            minWidth: 1280, maxWidth: 1366,
            minHeight: 720, maxHeight: 768
        }
    };

    const generator = new FingerprintGenerator(generatorOptions);

    const result = generator.getFingerprint();

    // 关键点：我们只需要 result.fingerprint 部分
    const fingerprintToSave = result.fingerprint;

    // 保存到文件
    fs.writeFileSync(filePath, JSON.stringify(fingerprintToSave, null, 2));
    logger.info('浏览器', `新指纹已保存至: ${filePath}`);

    return fingerprintToSave;
}

/**
 * 初始化浏览器 (统一启动逻辑)
 * @param {object} config - 配置对象
 * @param {object} [config.browser] - Browser 配置
 * @param {boolean} [config.browser.headless] - 是否开启 Headless 模式
 * @param {string} [config.browser.path] - Camoufox 可执行文件路径
 * @param {object} [config.browser.proxy] - 代理配置
 * @param {object} options - 启动选项
 * @param {string} options.userDataDir - 用户数据目录路径
 * @param {string} options.targetUrl - 目标 URL
 * @param {string} options.productName - 产品名称(用于日志)
 * @param {boolean} [options.reuseExistingTab=false] - 是否复用已有特定域名的 tab
 * @param {Function} [options.waitInputValidator] - 自定义输入框等待验证函数
 * @param {Function} [options.navigationHandler] - 全局导航处理器，用于自动处理登录等跳转
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
export async function initBrowserBase(config, options) {
    const {
        userDataDir,
        targetUrl,
        productName,
        waitInputValidator = null,
        navigationHandler = null
    } = options;

    // 检测登录模式和 Xvfb 模式
    const isLoginMode = process.argv.includes('-login');
    const isXvfbMode = process.env.XVFB_RUNNING === 'true';
    const ENABLE_AUTOMATION_MODE = !isLoginMode;

    logger.info('浏览器', `开始初始化浏览器 (${productName})`);
    logger.info('浏览器', `自动化模式: ${ENABLE_AUTOMATION_MODE ? '开启' : '关闭'}`);
    if (isLoginMode) {
        logger.warn('浏览器', '当前为登录模式，请手动完成登录后关闭登录模式以继续自动化程序！');
    }
    if (isXvfbMode) {
        logger.info('浏览器', '检测到 Xvfb 环境，强制禁用无头模式');
    }

    const browserConfig = config?.browser || {};

    // 获取指纹对象
    const fingerprintPath = path.join(process.cwd(), 'data', 'camoufoxFingerprints.json');
    const myFingerprint = getPersistentFingerprint(fingerprintPath);

    // 构造 Camoufox 启动选项
    logger.info('浏览器', '正在启动 Camoufox 浏览器...');
    const currentOS = getCurrentOS();
    const camoufoxLaunchOptions = {
        // 基础选项 (snake_case)
        executable_path: browserConfig.path || undefined,
        headless: browserConfig.headless && !isLoginMode && !isXvfbMode,
        user_data_dir: userDataDir,
        window: [1366, 768],
        ff_version: 135,
        fingerprint: myFingerprint,
        os: currentOS,
        i_know_what_im_doing: true,
        block_webrtc: true,
        exclude_addons: ['UBO'],
        geoip: false
    };

    // Headless 模式配置
    if (browserConfig.headless && !isLoginMode && !isXvfbMode) {
        logger.info('浏览器', 'Headless 模式: 启用');
    } else {
        const reasons = [];
        if (isLoginMode) reasons.push('登录模式');
        if (isXvfbMode) reasons.push('Xvfb 模式');
        if (!browserConfig.headless) reasons.push('配置禁用');

        logger.info('浏览器', 'Headless 模式: 禁用' + (reasons.length > 0 ? ` (${reasons.join(', ')})` : ''));
    }


    // 代理配置适配
    const proxyObject = await getBrowserProxy(browserConfig.proxy);
    if (proxyObject) {
        camoufoxLaunchOptions.proxy = proxyObject;
    }

    // 启动 Camoufox
    const context = await Camoufox(camoufoxLaunchOptions);
    globalContext = context; // 存储全局 Context

    logger.info('浏览器', 'Camoufox 浏览器已启动');

    // 注册清理处理器
    registerCleanupHandlers();

    // 注册断开连接事件
    context.on('close', async () => {
        logger.warn('浏览器', 'Camoufox 浏览器已断开连接');
        await cleanup();
        process.exit(0);
    });

    // 获取或创建 Page
    let page;
    const existingPages = context.pages(); // 获取启动时自动打开的页面
    if (!page) {
        if (existingPages.length > 0) {
            page = existingPages[0];
            logger.debug('浏览器', '复用浏览器启动时的默认标签页');
        } else {
            page = await context.newPage();
            logger.debug('浏览器', '浏览器没有标签，已创建新标签页');
        }
    }

    // 强制刷新一下视口大小，防止复用默认窗口时尺寸不对
    if (camoufoxLaunchOptions.viewport) {
        await page.setViewportSize(camoufoxLaunchOptions.viewport);
    }

    // 注册全局导航处理器（用于自动处理登录等跳转）
    if (navigationHandler) {
        page.on('framenavigated', async () => {
            try {
                await navigationHandler(page);
            } catch (e) {
                logger.warn('浏览器', `全局导航处理器出错: ${e.message}`);
            }
        });
        logger.debug('浏览器', '已注册全局导航处理器');
    }

    // 登录模式挂起逻辑
    if (isLoginMode) {
        // 尝试导航到目标页面方便用户登录
        try {
            logger.info('浏览器', `正在连接 ${productName}...`);
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        } catch (e) {
            logger.warn('浏览器', `打开页面失败: ${e.message}`);
        }

        logger.info('浏览器', '请在弹出的浏览器窗口中手动完成登录操作');
        logger.info('浏览器', '完成后可直接关闭浏览器窗口或在终端结束程序');

        await new Promise((resolve) => {
            context.on('close', () => {
                logger.info('浏览器', '检测到浏览器窗口关闭，程序即将退出');
                resolve();
            });
        });

        await cleanup();
        process.exit(0);
    }

    // 初始化 ghost-cursor
    page.cursor = createCursor(page);


    // --- 行为预热建立人机检测信任 ---
    const urlDomain = new URL(targetUrl).hostname;
    if (!page.url().includes(urlDomain)) {
        logger.info('浏览器', `正在连接 ${productName}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    } else {
        logger.info('浏览器', `页面已在 ${productName}，跳过跳转`);
    }

    logger.info('浏览器', '正在随机浏览页面以建立信任...');

    // 计算屏幕中心点 (动态获取视口大小)
    const vp = await getRealViewport(page);

    // 计算动态中心点
    const centerX = vp.width / 2;
    const centerY = vp.height / 2;

    // 第一次移动:从左上角移动到中心附近
    if (page.cursor) {
        // 使用 clamp 确保随机偏移后仍在屏幕内
        const targetX = clamp(centerX + random(-200, 200), 10, vp.safeWidth);
        const targetY = clamp(centerY + random(-200, 200), 10, vp.safeHeight);

        // 移动鼠标 (增加拟人化)
        await page.cursor.moveTo({ x: targetX, y: targetY });
    }
    await sleep(500, 1000);

    // 模拟滚动行为
    try {
        await page.mouse.wheel({ deltaY: random(100, 300) });
        await sleep(800, 1500);
        await page.mouse.wheel({ deltaY: -random(50, 100) });
    } catch (e) { }

    // 如果提供了自定义输入框验证函数,使用它
    if (waitInputValidator && typeof waitInputValidator === 'function') {
        await waitInputValidator(page);
    }

    logger.info('浏览器', '浏览器初始化完成，系统就绪');
    logger.warn('浏览器', '当任务运行时请勿随意调节窗口大小，以免鼠标轨迹错位!');

    // 返回对象 (兼容性处理)
    return {
        browser: context,
        page
    };
}
