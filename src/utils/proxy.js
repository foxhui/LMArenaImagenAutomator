/**
 * @fileoverview 代理适配模块
 * @description 将配置中的 HTTP/SOCKS5 代理转换为 Playwright 可用的代理配置，并在需要时通过 proxy-chain 搭建本地 HTTP 代理桥接。
 */

import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import { logger } from './logger.js';

// 全局代理状态：用于清理 proxy-chain 创建的本地代理资源
const proxyState = {
    anonymizedProxyUrl: null,  // 转换后的 HTTP 代理地址
    originalProxyUrl: null      // 原始代理地址
};

/**
 * 构建代理 URL
 * @param {object} proxyConfig - 代理配置对象
 * @param {string} proxyConfig.type - 代理类型 ('http' 或 'socks5')
 * @param {string} proxyConfig.host - 代理主机地址
 * @param {number} proxyConfig.port - 代理端口
 * @param {string} [proxyConfig.user] - 可选的用户名
 * @param {string} [proxyConfig.passwd] - 可选的密码
 * @returns {string} - 代理 URL
 */
export function buildProxyUrl(proxyConfig) {
    const { type, host, port, user, passwd } = proxyConfig;

    // 构建带认证的代理 URL
    if (user && passwd) {
        return `${type}://${user}:${passwd}@${host}:${port}`;
    }

    // 构建不带认证的代理 URL
    if (type === 'socks5') {
        return `socks5://${host}:${port}`;
    }

    return `http://${host}:${port}`;
}

/**
 * 将代理转换为 HTTP 代理
 * - HTTP 代理：直接返回
 * - SOCKS5 代理：使用 proxy-chain 转换为本地 HTTP 代理
 * @param {object} proxyConfig - 代理配置对象
 * @returns {Promise<string|null>} - 转换后的 HTTP 代理 URL，如果无需代理则返回 null
 */
export async function getHttpProxy(proxyConfig) {
    if (!proxyConfig || !proxyConfig.enable) {
        return null;
    }

    const { type, host, port } = proxyConfig;
    const originalUrl = buildProxyUrl(proxyConfig);

    // 如果是 HTTP 代理，直接返回
    if (type === 'http') {
        logger.debug('代理器', `使用 HTTP 代理: ${host}:${port}`);
        return originalUrl;
    }

    // 如果是 SOCKS5 代理，需要转换为 HTTP 代理
    if (type === 'socks5') {
        try {
            logger.info('代理器', `检测到 SOCKS5 代理，正在转换为 HTTP 代理: ${host}:${port}`);
            const httpProxyUrl = await anonymizeProxy(originalUrl);

            // 保存状态用于后续清理
            proxyState.anonymizedProxyUrl = httpProxyUrl;
            proxyState.originalProxyUrl = originalUrl;

            logger.info('代理器', `SOCKS5 代理已转换为 HTTP 代理: ${httpProxyUrl}`);
            return httpProxyUrl;
        } catch (error) {
            logger.error('代理器', `SOCKS5 代理转换失败: ${error.message}`);
            throw error;
        }
    }

    logger.warn('代理器', `不支持的代理类型: ${type}`);
    return null;
}

/**
 * 获取用于浏览器的代理配置
 * 返回 Playwright 可以使用的代理对象
 * @param {object} proxyConfig - 代理配置对象
 * @returns {Promise<object|null>} - Playwright 代理配置对象
 */
export async function getBrowserProxy(proxyConfig) {
    if (!proxyConfig || !proxyConfig.enable) {
        return null;
    }

    const { type, host, port, user, passwd } = proxyConfig;

    // 对于 SOCKS5 + 认证，需要转换为 HTTP 代理
    if (type === 'socks5' && user && passwd) {
        try {
            const originalUrl = buildProxyUrl(proxyConfig);
            logger.info('代理器', `检测到需鉴权的 SOCKS5 代理，正在创建本地代理桥接: ${host}:${port}`);

            const httpProxyUrl = await anonymizeProxy(originalUrl);

            // 保存状态用于后续清理
            proxyState.anonymizedProxyUrl = httpProxyUrl;
            proxyState.originalProxyUrl = originalUrl;

            logger.info('代理器', `本地代理桥接已建立: ${httpProxyUrl} -> ${host}:${port}`);

            return {
                server: httpProxyUrl
            };
        } catch (error) {
            logger.error('代理器', `本地代理桥接创建失败: ${error.message}`);
            throw error;
        }
    }

    // 对于其他情况（HTTP 代理、不带认证的 SOCKS5）
    const proxyUrl = type === 'socks5' ? `socks5://${host}:${port}` : `${host}:${port}`;

    const proxyObject = {
        server: proxyUrl
    };

    // 如果有认证信息，添加到代理对象
    if (user && passwd) {
        proxyObject.username = user;
        proxyObject.password = passwd;
    }

    logger.info('代理器', `代理配置: ${type}://${host}:${port}`);
    return proxyObject;
}

/**
 * 清理代理资源
 * 关闭由 proxy-chain 创建的本地代理服务器
 */
export async function cleanupProxy() {
    if (proxyState.anonymizedProxyUrl) {
        try {
            logger.debug('代理器', '正在关闭本地代理桥接...');
            await closeAnonymizedProxy(proxyState.anonymizedProxyUrl, true);
            logger.debug('代理器', '本地代理桥接已关闭');

            // 清理状态
            proxyState.anonymizedProxyUrl = null;
            proxyState.originalProxyUrl = null;
        } catch (error) {
            logger.error('代理器', `关闭本地代理桥接失败: ${error.message}`);
        }
    }
}

/**
 * 从配置文件读取代理配置
 * @param {object} config - 配置对象
 * @returns {object|null} - 代理配置对象或 null
 */
export function getProxyConfig(config) {
    if (config?.browser?.proxy?.enable) {
        return config.browser.proxy;
    }
    return null;
}
