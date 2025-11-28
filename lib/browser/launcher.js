import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createCursor } from 'ghost-cursor';
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import { spawn } from 'child_process';
import { getRealViewport, clamp, random, sleep } from './utils.js';
import { logger } from '../logger.js';

// 配置 Stealth 插件
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
puppeteer.use(stealth);

// 全局状态跟踪
let globalChromeProcess = null;
let globalBrowser = null;
let globalProxyUrl = null;

/**
 * 清理浏览器资源和进程
 * 实现三级退出机制: Puppeteer close -> SIGTERM -> SIGKILL
 * @returns {Promise<void>}
 */
export async function cleanup() {

    // Level 1: 通过 Puppeteer 协议优雅关闭,释放锁并保存 Profile
    if (globalBrowser) {
        try {
            logger.debug('浏览器', '正在断开远程调试连接...');
            await globalBrowser.close();
            globalBrowser = null;
            logger.debug('浏览器', '已断开远程调试连接');
        } catch (e) {
            logger.warn('浏览器', `断开远程调试连接失败 (可能已断开): ${e.message}`);
        }
    }

    // Level 2 & 3: 处理残留进程
    if (globalChromeProcess && !globalChromeProcess.killed) {
        logger.info('浏览器', '正在终止浏览器进程...');
        try {
            // Level 2: 发送 SIGTERM (软杀)
            globalChromeProcess.kill('SIGTERM');

            // 等待进程退出
            const start = Date.now();
            while (Date.now() - start < 2000) {
                try {
                    process.kill(globalChromeProcess.pid, 0);
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    break;
                }
            }
        } catch (e) { }

        // Level 3: 强制查杀 (SIGKILL)
        try {
            process.kill(globalChromeProcess.pid, 0);
            logger.debug('浏览器', '浏览器进程无响应，执行强制终止 (SIGKILL)...');
            process.kill(-globalChromeProcess.pid, 'SIGKILL');
        } catch (e) { }

        globalChromeProcess = null;
        logger.info('浏览器', '浏览器进程进程已终止');
    }

    // 清理代理
    if (globalProxyUrl) {
        try {
            logger.debug('浏览器', '正在关闭 Socks5 代理桥接');
            await closeAnonymizedProxy(globalProxyUrl, true);
            logger.debug('浏览器', '已关闭 Socks5 代理桥接');
        } catch (e) {
            logger.error('浏览器', '关闭 Socks5 代理桥接失败', { error: e.message });
        }
        globalProxyUrl = null;
    }
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
        if (globalChromeProcess) globalChromeProcess.kill();
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
 * 初始化浏览器 (统一启动逻辑)
 * @param {object} config - 配置对象
 * @param {object} [config.chrome] - Chrome 配置
 * @param {boolean} [config.chrome.headless] - 是否开启 Headless 模式
 * @param {string} [config.chrome.path] - Chrome 可执行文件路径
 * @param {boolean} [config.chrome.gpu] - 是否启用 GPU
 * @param {object} [config.chrome.proxy] - 代理配置
 * @param {object} options - 启动选项
 * @param {string} options.userDataDir - 用户数据目录路径
 * @param {string} options.targetUrl - 目标 URL
 * @param {string} options.productName - 产品名称(用于日志)
 * @param {boolean} [options.reuseExistingTab=false] - 是否复用已有特定域名的 tab
 * @param {Function} [options.waitInputValidator] - 自定义输入框等待验证函数
 * @returns {Promise<{browser: object, page: object, client: object}>}
 */
export async function initBrowserBase(config, options) {
    const {
        userDataDir,
        targetUrl,
        productName,
        reuseExistingTab = false,
        waitInputValidator = null
    } = options;

    // 检测登录模式
    const isLoginMode = process.argv.includes('-login');
    const ENABLE_AUTOMATION_MODE = !isLoginMode;

    logger.info('浏览器', `开始初始化浏览器 (${productName})`);
    logger.info('浏览器', `自动化模式: ${ENABLE_AUTOMATION_MODE ? '开启' : '关闭'}`);
    if (isLoginMode) {
        logger.warn('浏览器', '当前为登录模式，请手动完成登录后关闭登录模式以继续自动化程序！');
    }

    const chromeConfig = config?.chrome || {};
    const remoteDebuggingPort = 9222;

    // Chrome 启动参数
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run'
    ];

    // Headless 模式配置
    if (chromeConfig.headless && !isLoginMode) {
        args.push('--headless=new');
        args.push('--window-size=1280,690');
        args.push('--headless=new');
        args.push('--window-size=1280,690');
        logger.info('浏览器', 'Headless 模式: 启用 (1280x690)');
    } else {
        if (isLoginMode && chromeConfig.headless) {
            logger.warn('浏览器', '登录模式下强制禁用 Headless 模式。');
        }
        // 有头模式:最大化窗口以适配屏幕
        args.push('--start-maximized');
        logger.info('浏览器', 'Headless 模式: 禁用 (最大化窗口)');
    }

    // GPU 配置
    if (chromeConfig.gpu === false) {
        args.push(
            '--disable-gpu',
            '--use-gl=swiftshader',
            '--disable-accelerated-2d-canvas',
            '--animation-duration-scale=0',
            '--disable-smooth-scrolling'
        );
        logger.info('浏览器', 'GPU 加速: 禁用');
    } else {
        logger.info('浏览器', 'GPU 加速: 启用');
    }

    // 代理配置
    let proxyUrlForChrome = null;
    if (chromeConfig.proxy && chromeConfig.proxy.enable) {
        const { type, host, port, user, passwd } = chromeConfig.proxy;

        // 特殊处理 SOCKS5 + Auth (Chrome 原生不支持)
        if (type === 'socks5' && user && passwd) {
            try {
                const upstreamUrl = `socks5://${user}:${passwd}@${host}:${port}`;
                logger.info('浏览器', '检测到需鉴权的 Socks5 代理，正在创建本地代理桥接...');
                // 创建本地中间代理 (无认证 -> 有认证)
                proxyUrlForChrome = await anonymizeProxy(upstreamUrl);
                globalProxyUrl = proxyUrlForChrome; // 记录全局代理
                logger.info('浏览器', `本地代理桥接已建立: ${proxyUrlForChrome} -> ${host}:${port}`);

                args.push(`--proxy-server=${proxyUrlForChrome}`);
                args.push('--disable-quic');
                logger.warn('浏览器', '为增强代理兼容性，已禁用QUIC (HTTP/3)');
                logger.info('浏览器', `代理配置: ${type}://${host}:${port}`);
            } catch (e) {
                logger.error('浏览器', '本地代理桥接创建失败', { error: e.message });
                throw e;
            }
        } else {
            // 常规 HTTP 代理或无认证 SOCKS5
            const proxyUrl = type === 'socks5' ? `socks5://${host}:${port}` : `${host}:${port}`;
            args.push(`--proxy-server=${proxyUrl}`);
            args.push('--disable-quic');
            logger.warn('浏览器', '为增强代理兼容性，已禁用QUIC (HTTP/3)');
            logger.info('浏览器', `代理配置: ${type}://${host}:${port}`);
        }
    }

    const chromePath = chromeConfig.path;

    // --- 模式分支 ---

    if (!ENABLE_AUTOMATION_MODE) {
        // 仅启动浏览器
        logger.info('浏览器', '正在以登录模式启动浏览器...');
        logger.debug('浏览器', `启动路径: ${chromePath}`);

        // 在手动模式下自动打开目标页面
        args.push(targetUrl);

        const chromeProcess = spawn(chromePath, args, {
            detached: false,
            stdio: 'ignore'
        });
        globalChromeProcess = chromeProcess;

        // 注册清理处理器
        registerCleanupHandlers();
        logger.info('浏览器', '浏览器已启动，脚本将持续运行直到浏览器关闭...');

        await new Promise((resolve) => {
            chromeProcess.on('close', async (code) => {
                logger.warn('浏览器', `浏览器已被关闭 (退出码: ${code})`);
                await cleanup();
                resolve();
            });
        });

        logger.info('浏览器', '浏览器已被关闭，脚本退出');
        process.exit(0);
        return null;
    }

    // --- 自动化模式 ---

    let browserWSEndpoint = null;
    try {
        const res = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.webSocketDebuggerUrl) {
                logger.debug('浏览器', '检测到已运行的浏览器实例，正在连接...');
                browserWSEndpoint = data.webSocketDebuggerUrl;
                logger.info('浏览器', '已连接到已运行的浏览器实例，程序将复用实例');
            }
        }
    } catch (e) {
        logger.debug('浏览器', '未检测到运行中的浏览器实例，正在启动新实例...');
    }

    if (!browserWSEndpoint) {
        const automationArgs = [...args, `--remote-debugging-port=${remoteDebuggingPort}`];
        logger.info('浏览器', '正在启动浏览器...');
        logger.debug('浏览器', `启动路径: ${chromePath}`);

        const chromeProcess = spawn(chromePath, automationArgs, {
            detached: true,
            stdio: 'ignore'
        });
        chromeProcess.unref();
        globalChromeProcess = chromeProcess;

        logger.debug('浏览器', '浏览器已启动，等待调试端口就绪...');

        for (let i = 0; i < 20; i++) {
            await sleep(1000, 1500);
            try {
                const res = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.webSocketDebuggerUrl) {
                        browserWSEndpoint = data.webSocketDebuggerUrl;
                        logger.debug('浏览器', '浏览器调试接口已就绪');
                        break;
                    }
                }
            } catch (e) { }
        }

        if (!browserWSEndpoint) {
            throw new Error('无法连接到 Chrome 远程调试端口,请检查 Chrome 是否成功启动。');
        }
    }

    // 连接 Puppeteer
    const browser = await puppeteer.connect({
        browserWSEndpoint: browserWSEndpoint,
        defaultViewport: null
    });

    globalBrowser = browser; // 保存实例引用供 cleanup 使用

    logger.info('浏览器', '远程调试已连接');

    // 注册清理处理器
    registerCleanupHandlers();

    browser.on('disconnected', async () => {
        logger.warn('浏览器', '浏览器已断开连接');
        await cleanup();
        process.exit(0);
    });

    // 获取或创建页面
    let page;
    if (reuseExistingTab) {
        // 复用已有标签页
        const pages = await browser.pages();
        const urlDomain = new URL(targetUrl).hostname;
        page = pages.find(p => p.url().includes(urlDomain));

        if (!page) {
            page = await browser.newPage();
            logger.debug('浏览器', '已创建新标签页');
        } else {
            logger.warn('浏览器', '检测到已有目标网站标签页，程序将复用标签页');
        }
    } else {
        // 总是新建标签页
        page = await browser.newPage();
        logger.debug('浏览器', '已创建新标签页');
    }

    // 初始化 ghost-cursor
    page.cursor = createCursor(page);

    // 代理认证 (仅当未使用 proxy-chain 桥接时)
    if (chromeConfig.proxy && chromeConfig.proxy.enable && chromeConfig.proxy.user && !proxyUrlForChrome) {
        await page.authenticate({
            username: chromeConfig.proxy.user,
            password: chromeConfig.proxy.passwd
        });
        logger.info('浏览器', '代理认证: 已激活 (HTTP Basic Auth)');
    }

    // 创建 CDP 会话
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    // 注册清理钩子
    if (proxyUrlForChrome) {
        logger.warn('浏览器', '因使用了本地代理桥接，请保持此程序运行，否则浏览器将失去代理连接');
    }

    // --- 行为预热建立人机检测信任 ---
    const urlDomain = new URL(targetUrl).hostname;
    if (!page.url().includes(urlDomain)) {
        logger.info('浏览器', `正在连接 ${productName}...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
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

        // 重置 cursor 内部状态 (可选,增加拟人化)
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

    return { browser, page, client };
}
