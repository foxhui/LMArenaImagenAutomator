import crypto from 'crypto';

/**
 * 生成随机 API Key
 * 格式: sk-{48位十六进制字符}
 * @returns {string} API Key
 */
export function generateApiKey() {
    return 'sk-' + crypto.randomBytes(24).toString('hex');
}
