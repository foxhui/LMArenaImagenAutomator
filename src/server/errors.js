/**
 * @fileoverview 错误码表与中文消息映射模块
 * @description 统一定义服务器错误码及其对应的中文消息和 HTTP 状态码
 */

/**
 * 错误码枚举
 * @readonly
 * @enum {string}
 */
export const ERROR_CODES = {
    /** 未授权（Token 无效或缺失） */
    UNAUTHORIZED: 'UNAUTHORIZED',
    /** 浏览器未初始化 */
    BROWSER_NOT_INITIALIZED: 'BROWSER_NOT_INITIALIZED',
    /** 服务器繁忙（队列已满） */
    SERVER_BUSY: 'SERVER_BUSY',
    /** 请求参数缺少 messages */
    NO_MESSAGES: 'NO_MESSAGES',
    /** messages 中缺少 role=user 的消息 */
    NO_USER_MESSAGES: 'NO_USER_MESSAGES',
    /** 图片数量超过限制 */
    TOO_MANY_IMAGES: 'TOO_MANY_IMAGES',
    /** 模型无效/后端不支持 */
    INVALID_MODEL: 'INVALID_MODEL',
    /** 该模型需要参考图 */
    IMAGE_REQUIRED: 'IMAGE_REQUIRED',
    /** 该模型不支持图片输入 */
    IMAGE_FORBIDDEN: 'IMAGE_FORBIDDEN',
    /** 触发人机验证（reCAPTCHA） */
    RECAPTCHA: 'RECAPTCHA',
    /** 服务器内部错误 */
    INTERNAL_ERROR: 'INTERNAL_ERROR',
};

/**
 * 错误详情映射表
 * @type {Record<string, {message: string, status: number}>}
 */
const ERROR_DETAILS = {
    [ERROR_CODES.UNAUTHORIZED]: {
        message: '未授权（Token 无效或缺失）',
        status: 401,
    },
    [ERROR_CODES.BROWSER_NOT_INITIALIZED]: {
        message: '浏览器未初始化',
        status: 503,
    },
    [ERROR_CODES.SERVER_BUSY]: {
        message: '服务器繁忙（队列已满）',
        status: 429,
    },
    [ERROR_CODES.NO_MESSAGES]: {
        message: '请求参数缺少 messages',
        status: 400,
    },
    [ERROR_CODES.NO_USER_MESSAGES]: {
        message: 'messages 中缺少 role=user 的消息',
        status: 400,
    },
    [ERROR_CODES.TOO_MANY_IMAGES]: {
        message: '图片数量超过限制',
        status: 400,
    },
    [ERROR_CODES.INVALID_MODEL]: {
        message: '模型无效/后端不支持',
        status: 400,
    },
    [ERROR_CODES.IMAGE_REQUIRED]: {
        message: '该模型需要参考图',
        status: 400,
    },
    [ERROR_CODES.IMAGE_FORBIDDEN]: {
        message: '该模型不支持图片输入',
        status: 400,
    },
    [ERROR_CODES.RECAPTCHA]: {
        message: '触发人机验证（reCAPTCHA）',
        status: 500,
    },
    [ERROR_CODES.INTERNAL_ERROR]: {
        message: '服务器内部错误',
        status: 500,
    },
};

/**
 * 获取错误消息
 * @param {string} code - 错误码
 * @returns {string} 中文错误消息
 */
export function getErrorMessage(code) {
    return ERROR_DETAILS[code]?.message || '未知错误';
}

/**
 * 获取错误对应的 HTTP 状态码
 * @param {string} code - 错误码
 * @returns {number} HTTP 状态码
 */
export function getErrorStatus(code) {
    return ERROR_DETAILS[code]?.status || 500;
}

/**
 * 获取完整的错误详情
 * @param {string} code - 错误码
 * @returns {{message: string, status: number}} 错误详情
 */
export function getErrorDetails(code) {
    return ERROR_DETAILS[code] || { message: '未知错误', status: 500 };
}
