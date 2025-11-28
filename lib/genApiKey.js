import { generateApiKey } from './security/apiKey.js';

console.log('>>> [GenAPIKey] 生成新的 API Key:');
console.log(generateApiKey());
console.log('\n>>> 请将此 Key 复制到 config.yaml 文件的 server.auth 字段中。');
