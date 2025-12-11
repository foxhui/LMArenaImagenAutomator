# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.2] - 2025-12-12

### Added
- **支持Docker**
  - 初步支持 Docker 部署 [foxhui/lmarena-imagen-automator](https://hub.docker.com/r/foxhui/lmarena-imagen-automator)

## [2.2.1] - 2025-12-12

### Added
- **Cookie获取**
  - 增加 Cookie 获取接口，可利用本项目的自动续登功能获取最新的 Cookie 给其他工具使用

### Changed
- **自动续登**
  - 监听逻辑修改为全局监听，任何时候触发跳转都会执行自动登录（如会话过期自动跳转）

### Fixed
- **修复杂项**
  - 修复自动登录时可能会出现的问题
  - 修复启动VNC服务器时端口可能冲突的问题
  - 修复遗留的浏览器启动参数导致的小问题
  - 修复 zAI 返回错误时无反馈直到请求超时的问题

## [2.2.0] - 2025-12-11

### Added
- **支持新网站**
  - 初步支持 zAI/zai.is 且支持自动续登

### Fixed
- **浏览器功能**
  - 修复 Gemini Business 自动续登监听器被多次触发的问题
  - 修复拟人输入在 MacOS 环境下提示词无法全选删除的问题

## [2.1.0] - 2025-12-09

### Changed
- **优化性能**
  - 逐步减少冗余代码，提升性能
  - 增加适配器代码可读性
- **日志优化**
  - 已可以将错误原因透传至客户端，减少故障排查成本

### Fixed
- **减少故障**
  - 填补或删除可能会出现BUG的相关代码

## [2.0.2] - 2025-12-09

### Fixed
- **修复超时逻辑**
  - 修复在等待生成结果时超时，但是客户端任务未终止且无任何通知的问题

## [2.0.1] - 2025-12-08

### Added
- **自动续登**
  - 支持 Gemini Business 过期自动续登录
- **内置XVFB指令**
  - 内置了xvfb指令和x11vnc指令，只需要添加参数即可，无需记忆繁琐的指令

### Changed
- **优化分辨率**
  - 优化浏览器窗口分辨率以确保窗口不会过大以及在服务器上消耗性能

## [2.0.0] - 2025-12-06

### Added
- **支持新网站**
 - 支持对 Nano Banana Free 网站的支持

### Changed
- **代码重构**
  - 本项目已从 Puppeteer 迁移至 Playwright + Camoufox，以应对日益复杂的反机器人检测机制。基于 Puppeteer 的旧版本代码已归档至 `puppeteer-edition` 分支，仅作留存，**不再提供更新与维护**。

## [1.3.1] - 2025-12-05

### Added
- **同步竞技场模型UUID**
  - 新增 gemini-3-pro-image-preview-2k 模型的支持

## [1.3.0] - 2025-11-28

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

## [1.2.1] - 2025-11-27

### Added
- **登录模式**
  - 新增独立登录参数 (`-login`)，便于用户在非自动化模式下完成手动登录

### Changed
- **浏览器进程解耦**
  - 调整架构为程序与浏览器分离模式：主程序现通过连接远程调试端口（Remote Debugging Port）控制浏览器，旨在降低自动化检测特征

## [1.2.0] - 2025-11-26

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

## [1.1.1] - 2025-11-25

### Fixed
- **模型映射修复**
  - 修复因 UUID 映射错误导致 `gemini-3-pro-image-preview` 模型请求返回 HTTP 500 的异常

## [1.1.0] - 2025-11-24

### Added
- **多模型支持体系**
  - 新增 `model` 参数，支持指定 Seedream, Gemini, Imagen, DALL-E 等 23+ 种图像生成模型
  - 新增 `/v1/models` 端点，提供可用模型列表查询功能
  - 引入 `lib/models.js` 配置文件，实现模型映射的集中管理与扩展
  - 实现动态 payload 注入，在浏览器上下文中实时修改 `modelAId`
- **API 兼容性更新**
  - OpenAI 兼容接口 (`/v1/chat/completions`) 及队列接口 (`/v1/queue/join`) 均已适配 `model` 参数
  - *注：若未指定模型，系统将默认调用网页端的缺省模型*

## [1.0.1] - 2025-11-23

### Fixed
- **代理鉴权修复**
  - 修复了带身份验证的 SOCKS5 代理无法建立连接的问题。

## [1.0.0] - 2025-11-23

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
