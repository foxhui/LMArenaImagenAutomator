# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2024-11-28

### Added
- **Gemini Enterprise Business 支持**
  - 新增对 Gemini Enterprise Business 的初步支持
  - 实现请求拦截机制，强制指定 `Nano Banana Pro` 模型

### Changed
- **代码重构**
  - 重构代码结构，提升代码复用率并增强项目的可维护性
  - 优化日志输出系统，提高调试信息的可读性
- **CLI 交互增强**
  - 更新 `lib/test.js` 测试工具，支持交互式选择模型和测试方式

## [1.2.1] - 2024-11-27

### Added
- **登录模式**
  - 新增独立登录参数 (`-login`)，便于用户在非自动化模式下完成手动登录

### Changed
- **浏览器进程解耦**
  - 调整架构为程序与浏览器分离模式：主程序现通过连接远程调试端口（Remote Debugging Port）控制浏览器，旨在降低自动化检测特征

## [1.2.0] - 2024-11-26

### Added
- **浏览器指纹伪装增强**
  - 针对 Windows 10 原生 Chrome 环境优化指纹，已在 [antibot](https://bot.sannysoft.com/) 和 [CreepJS](https://abrahamjuliot.github.io/creepjs/) 测试中无红色高危警告
  - 集成 `ghost-cursor` 库，通过贝塞尔曲线算法生成拟人化鼠标轨迹，提升伪装效果
  - *注：Linux 环境下的指纹伪装暂未完全覆盖，建议参考文档中的常见问题进行手动调优*

### Changed
- **底层拦截机制重构**
  - 弃用基于 Fetch 脚本注入和 Puppeteer Request Interception 的旧方案
  - 迁移至 CDP (Chrome DevTools Protocol) 拦截器处理模型 UUID 映射，显著降低被检测风险
- **环境参数优化**
  - 优化浏览器启动参数配置与窗口尺寸计算逻辑，进一步减少特征暴露

## [1.1.1] - 2024-11-25

### Fixed
- **模型映射修复**
  - 修复因 UUID 映射错误导致 `gemini-3-pro-image-preview` 模型请求返回 HTTP 500 的异常

## [1.1.0] - 2024-11-24

### Added
- **多模型支持体系**
  - 新增 `model` 参数，支持指定 Seedream, Gemini, Imagen, DALL-E 等 23+ 种图像生成模型
  - 新增 `/v1/models` 端点，提供可用模型列表查询功能
  - 引入 `lib/models.js` 配置文件，实现模型映射的集中管理与扩展
  - 实现动态 payload 注入，在浏览器上下文中实时修改 `modelAId`
- **API 兼容性更新**
  - OpenAI 兼容接口 (`/v1/chat/completions`) 及队列接口 (`/v1/queue/join`) 均已适配 `model` 参数
  - *注：若未指定模型，系统将默认调用网页端的缺省模型*

## [1.0.1] - 2024-11-23

### Fixed
- **代理鉴权修复**
  - 修复了带身份验证的 SOCKS5 代理无法建立连接的问题。

## [1.0.0] - 2024-11-23

### Added
- **初始版本发布**
  - 发布基于 Puppeteer 的自动化图像生成核心功能。
  - 提供双运行模式：OpenAI API 兼容模式与 Queue 队列模式 (SSE)。
  - 拟人化交互：内置贝塞尔曲线鼠标移动、智能键盘输入模拟及随机抖动延迟算法。
  - **功能特性**：
    - 支持单次最多上传 5 张图片。
    - 支持 Bearer Token 标准认证。
    - 完整支持 HTTP 及 SOCKS5 代理协议。
    - 附带 CLI 测试工具及可配置化系统架构。
