/**
 * @fileoverview 生成 API Key（CLI）
 * @description 输出一个新的 `server.auth` Key，供写入 `config.yaml` 使用。
 *
 * 用法：`npm run genkey`
 */

import crypto from 'crypto';

/**
 * 生成随机 API Key（用于 `config.yaml` 的 `server.auth`）
 * 格式：sk-{48位十六进制字符}
 * @returns {string} API Key
 */
function generateApiKey() {
    return 'sk-' + crypto.randomBytes(24).toString('hex');
}

console.log('>>> [GenAPIKey] 生成新的 API Key:');
console.log(generateApiKey());
console.log('\n>>> 请将此 Key 复制到 config.yaml 文件的 server.auth 字段中。');
