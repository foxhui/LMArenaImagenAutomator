/**
 * @fileoverview Google Flow 图片生成适配器
 */

import {
    sleep,
    safeClick,
    uploadFilesViaChooser
} from '../engine/utils.js';
import {
    normalizePageError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck,
    waitApiResponse,
    useContextDownload
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';
import sharp from 'sharp';

// --- 配置常量 ---
const TARGET_URL = 'https://labs.google/fx/zh/tools/flow';

/**
 * 根据图片路径检测其宽高比，返回 '16:9' 或 '9:16'
 * @param {string} imgPath - 图片路径
 * @returns {Promise<string>} 尺寸比例
 */
async function detectImageAspect(imgPath) {
    try {
        const metadata = await sharp(imgPath).metadata();
        const { width, height } = metadata;
        // 宽 >= 高 为横版，否则为竖版
        return width >= height ? '16:9' : '9:16';
    } catch (e) {
        // 检测失败默认横版
        return '16:9';
    }
}

/**
 * 执行图片生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组
 * @param {string} modelId - 模型 ID
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{image?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    // 获取模型配置
    const modelConfig = manifest.models.find(m => m.id === modelId) || manifest.models[0];
    let { codeName, imageSize } = modelConfig;

    // 如果 imageSize 为 '0'，根据第一张图片动态决定尺寸
    if (imageSize === '0' && imgPaths && imgPaths.length > 0) {
        imageSize = await detectImageAspect(imgPaths[0]);
        logger.info('适配器', `根据图片检测尺寸: ${imageSize}`, meta);
    } else if (imageSize === '0') {
        // 没有图片时默认横版
        imageSize = '16:9';
    }

    try {
        // 1. 导航到入口页面
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);
        await sleep(1500, 2500);

        // 2. 创建项目 - 点击 add_2 按钮
        logger.debug('适配器', '创建新项目...', meta);
        const addProjectBtn = page.getByRole('button', { name: /^add_2/ });
        await addProjectBtn.waitFor({ state: 'visible', timeout: 30000 });
        await safeClick(page, addProjectBtn, { bias: 'button' });
        await sleep(1000, 1500);

        // 3. 选择 Images 模式 (通过 combobox + option 选择)
        logger.debug('适配器', '选择图片制作模式...', meta);
        const modeCombo = page.getByRole('combobox').filter({
            has: page.locator('i', { hasText: 'arrow_drop_down' })
        });
        await modeCombo.first().waitFor({ state: 'visible', timeout: 10000 });
        await safeClick(page, modeCombo.first(), { bias: 'button' });
        await sleep(500, 800);

        const imageOption = page.getByRole('option').filter({
            has: page.locator('i', { hasText: 'add_photo_alternate' })
        });
        await safeClick(page, imageOption.first(), { bias: 'button' });
        await sleep(1000, 1500);

        // 4. 打开 Tune 菜单进行配置
        logger.debug('适配器', '打开设置菜单...', meta);
        const tuneBtn = page.getByRole('button', { name: /^tune/ });
        await tuneBtn.waitFor({ state: 'visible', timeout: 10000 });
        await safeClick(page, tuneBtn, { bias: 'button' });
        await sleep(800, 1200);

        // 4.1 设置生成数量为 1 (链式 filter：包含数字1-4，排除模型和尺寸关键词)
        logger.debug('适配器', '设置生成数量为 1...', meta);
        const countCombobox = page.getByRole('combobox')
            .filter({ hasText: /[1-4]/ })
            .filter({ hasNotText: /Banana|Imagen/i })
            .filter({ hasNotText: /16:9|9:16|1:1|4:3|3:4/ });

        if (await countCombobox.count() > 0) {
            await safeClick(page, countCombobox.first(), { bias: 'button' });
            await sleep(300, 500);
            await safeClick(page, page.getByRole('option', { name: '1' }), { bias: 'button' });
            await sleep(300, 500);
            logger.debug('适配器', '生成数量已设置为 1', meta);
        } else {
            logger.warn('适配器', '未找到数量选择 combobox，跳过', meta);
        }

        // 4.2 选择模型 (查找包含模型名称的 combobox)
        logger.debug('适配器', `选择模型: ${codeName}...`, meta);
        const modelCombobox = page.getByRole('combobox')
            .filter({ hasText: /Nano Banana|Imagen 4/ });

        if (await modelCombobox.count() > 0) {
            await safeClick(page, modelCombobox.first(), { bias: 'button' });
            await sleep(300, 500);
            await safeClick(page, page.getByRole('option', { name: codeName }), { bias: 'button' });
            await sleep(300, 500);
            logger.debug('适配器', `模型已设置为 ${codeName}`, meta);
        }

        // 4.3 选择横竖版 (查找包含比例的 combobox)
        logger.debug('适配器', `选择尺寸: ${imageSize}...`, meta);
        const sizeCombobox = page.getByRole('combobox')
            .filter({ hasText: /16:9|9:16/ });

        if (await sizeCombobox.count() > 0) {
            await safeClick(page, sizeCombobox.first(), { bias: 'button' });
            await sleep(300, 500);
            const sizeOption = page.getByRole('option').filter({ hasText: imageSize });
            await safeClick(page, sizeOption.first(), { bias: 'button' });
            await sleep(300, 500);
            logger.debug('适配器', `尺寸已设置为 ${imageSize}`, meta);
        }

        // 5. 上传图片 (如果有)
        if (imgPaths && imgPaths.length > 0) {
            logger.info('适配器', `开始上传 ${imgPaths.length} 张图片...`, meta);

            for (let i = 0; i < imgPaths.length; i++) {
                const imgPath = imgPaths[i];
                logger.debug('适配器', `上传图片 ${i + 1}/${imgPaths.length}...`, meta);

                // 5.1 点击 add 按钮
                const addBtn = page.getByRole('button', { name: 'add' });
                await addBtn.waitFor({ state: 'visible', timeout: 10000 });
                await safeClick(page, addBtn, { bias: 'button' });
                await sleep(500, 1000);

                // 5.2 点击 upload 按钮并选择文件（不等待上传完成）
                const uploadBtn = page.getByRole('button', { name: /^upload/ });
                await uploadFilesViaChooser(page, uploadBtn, [imgPath]);
                await sleep(500, 1000);

                // 5.3 先启动上传监听，再点击 crop 按钮
                const uploadResponsePromise = waitApiResponse(page, {
                    urlMatch: 'v1:uploadUserImage',
                    method: 'POST',
                    timeout: 60000
                });

                const cropBtn = page.getByRole('button', { name: /^crop/ });
                await cropBtn.waitFor({ state: 'visible', timeout: 10000 });
                await safeClick(page, cropBtn, { bias: 'button' });

                // 5.4 等待上传完成
                await uploadResponsePromise;
                logger.info('适配器', `图片 ${i + 1} 上传完成`, meta);
                await sleep(1000, 1500);
            }

            logger.info('适配器', '所有图片上传完成', meta);
        }

        // 6. 输入提示词
        logger.info('适配器', '输入提示词...', meta);
        const textarea = page.locator('textarea[placeholder]');
        await waitForInput(page, textarea, { click: true });
        await textarea.fill(prompt);
        await sleep(500, 1000);

        // 7. 先启动 API 监听，再点击发送
        logger.debug('适配器', '启动 API 监听...', meta);
        const apiResponsePromise = waitApiResponse(page, {
            urlMatch: 'flowMedia:batchGenerateImages',
            method: 'POST',
            timeout: 120000,
            meta
        });

        // 8. 点击发送按钮
        logger.info('适配器', '点击发送...', meta);
        const sendBtn = page.getByRole('button', { name: /^arrow_forward/ });
        await sendBtn.waitFor({ state: 'visible', timeout: 10000 });
        await safeClick(page, sendBtn, { bias: 'button' });

        // 9. 等待 API 响应
        logger.info('适配器', '等待生成结果...', meta);
        const apiResponse = await apiResponsePromise;

        // 10. 解析响应获取图片 URL
        let imageUrl;
        try {
            const responseBody = await apiResponse.json();
            imageUrl = responseBody?.media?.[0]?.image?.generatedImage?.fifeUrl;

            if (!imageUrl) {
                logger.error('适配器', '响应中没有图片 URL', meta);
                return { error: '生成成功但响应中没有图片 URL' };
            }

            logger.info('适配器', '已获取图片链接', meta);
        } catch (e) {
            logger.error('适配器', '解析响应失败', { ...meta, error: e.message });
            return { error: `解析响应失败: ${e.message}` };
        }

        // 11. 下载图片并转为 base64
        logger.info('适配器', '正在下载图片...', meta);
        const downloadResult = await useContextDownload(imageUrl, page);

        if (downloadResult.error) {
            logger.error('适配器', downloadResult.error, meta);
            return downloadResult;
        }

        logger.info('适配器', '图片生成完成', meta);
        return { image: downloadResult.image };

    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally {
        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'google_flow',
    displayName: 'Google Flow (图片生成)',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        // 根据上传的第一张图片动态获取图片比例
        { id: 'gemini-3-pro-image-preview', codeName: '🍌 Nano Banana Pro', imageSize: '0', imagePolicy: 'optional' },
        { id: 'gemini-2.5-flash-image-preview', codeName: '🍌 Nano Banana', imageSize: '0', imagePolicy: 'optional' },
        { id: 'imagen-4', codeName: 'Imagen 4', imageSize: '0', imagePolicy: 'optional' },
        // 指定图片比例
        { id: 'gemini-3-pro-image-preview-landspace', codeName: '🍌 Nano Banana Pro', imageSize: '16:9', imagePolicy: 'optional' },
        { id: 'gemini-3-pro-image-preview-portrait', codeName: '🍌 Nano Banana Pro', imageSize: '9:16', imagePolicy: 'optional' },
        { id: 'gemini-2.5-flash-image-preview-landspace', codeName: '🍌 Nano Banana', imageSize: '16:9', imagePolicy: 'optional' },
        { id: 'gemini-2.5-flash-image-preview-portrait', codeName: '🍌 Nano Banana', imageSize: '9:16', imagePolicy: 'optional' },
        { id: 'imagen-4-landspace', codeName: 'Imagen 4', imageSize: '16:9', imagePolicy: 'optional' },
        { id: 'imagen-4-portrait', codeName: 'Imagen 4', imageSize: '9:16', imagePolicy: 'optional' }
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心图片生成方法
    generate
};
