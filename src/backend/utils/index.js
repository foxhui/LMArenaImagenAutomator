/**
 * @fileoverview 后端工具模块聚合导出
 * @description 统一导出页面交互、错误归一化、资源下载等工具函数
 * 
 * 主要功能：
 * - 页面交互 (page.js):
 *   - waitForPageAuth/lockPageAuth/unlockPageAuth: 页面认证锁机制
 *   - waitForInput: 等待输入框出现（自动等待认证完成）
 *   - fillPrompt: 拟人化输入提示词
 *   - submit: 提交表单（点击按钮失败则回退为回车）
 *   - gotoWithCheck: 导航到 URL 并检测 HTTP 错误
 *   - moveMouseAway: 任务完成后移开鼠标
 *   - waitApiResponse: 等待 API 响应（带页面关闭监听）
 * 
 * - 错误处理 (error.js):
 *   - isRetryableError: 判断错误是否可重试
 *   - normalizePageError: 归一化页面级错误
 *   - normalizeHttpError: 归一化 HTTP 响应错误
 *   - normalizeError: 通用错误归一化
 * 
 * - 资源下载 (download.js):
 *   - useContextDownload: 使用页面上下文下载图片并转换为 Base64
 */

// 页面交互
export {
    waitForPageAuth,
    lockPageAuth,
    unlockPageAuth,
    isPageAuthLocked,
    waitForInput,
    fillPrompt,
    submit,
    gotoWithCheck,
    tryGotoWithCheck,
    moveMouseAway,
    waitApiResponse,
} from './page.js';

// 错误归一化
export {
    isRetryableError,
    normalizePageError,
    normalizeHttpError,
    normalizeError,
} from './error.js';

// 资源下载
export { useContextDownload } from './download.js';
