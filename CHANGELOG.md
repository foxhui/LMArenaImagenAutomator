# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.1] - 2025-12-20

### ✨ Added
- **WebUI**
  - 完善 WebUI 功能，添加接口测试和日志查看器，优化部分布局
- **日志记录**
  - 会在 data/temp 文件夹下记录日志（最大5MB轮转）

### 🔄 Changed
- **初始化失败逻辑**
  - 程序初始化失败后不会直接推出，以便利用 WebUI 修改错误的配置
- **LMArena 图片适配器**
  - 支持通过配置直接返回图片URL (但其他不支持的适配器仍然会返回 Base64)

## [3.2.0] - 2025-12-19

### ✨ Added
- **WebUI**
  - 为项目添加了网页版管理工具，便于修改配置文件（可能会有问题，可随时反馈）

- **增加看门狗**
  - 增加看门狗机制（Supervisor），保证程序失败重载和利于利用 WebUI 完整重启程序
  - 同时将 Linux 上的虚拟显示器和 VNC 服务器启动程序也迁移至看门狗机制

## [3.1.0] - 2025-12-17

### ✨ Added
- **支持文本模型**
  - 添加专门的文本模型适配器（目前仅支持 LMArena 和 Gemini Busineess）
  - 支持网络搜索模型，例如 gemini-3-pro-grounding、grok-4-1-fast-search
- **图片调度**
  - 若有适配器同时支持同一个模型，但是图片策略不同，将会优先将带图片的请求分发给支持图片的适配器
- **为自动通过验证码做准备**
  - 新增测试适配器 turnstile_test ，为将来需要自动过 CloudFlare 验证码做准备

### 🔄 Changed
- **项目名称更新**
  - 因支持的功能越来越多，决定为项目改名为 WebAI2API

## [3.0.1] - 2025-12-16

### ✨ Added
- **故障转移系统**
  - 实现了基于 Pool 的自动故障转移：当某个 Worker 执行任务失败（如 API 超时、页面崩溃、被限流）时，系统会自动寻找下一个支持该模型的 Worker 进行重试。
  - **Merge 模式增强**：Merge Worker 内部也会在不同的适配器之间进行故障转移。

## [3.0.0] - 2025-12-14

### ✨ Added
- **多窗口多账号支持**
  - 架构升级，支持同时管理多个浏览器实例和多个标签页。
  - 实现了浏览器实例间的数据（Cookies/Storage）完全隔离。
- **Cookies 管理**
  - 新增 `/v1/cookies` 接口，支持获取指定 browser instance 的 Cookies。

### 🔄 Changed
- **配置系统重构**
  - 配置文件结构大幅调整，采用更清晰的 `backend.pool` 结构配置 Worker。

## [2.4.0] - 2025-12-13

### ✨ Added
- **浏览器伪装增强**
  - 集成 GEOIP 数据库，实现基于 IP 的自动时区伪装。
- **初始化脚本 (init.js)**
  - 支持 `npm run init -- -custom` 自定义初始化。
  - 自动下载 GeoLite2 sum数据库。
- **服务器自检**
  - 启动时自动检查依赖完整性和环境补丁。
- **Merge 模式监控**
  - 闲时自动跳转到指定网站以维持会话活跃（保活）。

### 🔄 Changed
- **代码重构**
  - 服务器代码模块化 (`src/server/`).
  - 目录结构重新整理。

## [2.3.0] - 2025-12-12

### ✨ Added
- **新适配器支持**
  - 初步支持 Gemini 网页版 (`gemini.js`).

### 🔄 Changed
- **流式接口优化**
  - 移除了全局开关，改为由请求体参数 `stream: true` 动态控制。
  - **保活机制**：流式模式下支持无限排队，并通过 SSE 心跳包防止连接超时。
  - **拒绝策略**：非流式请求在队列满时立即拒绝，避免无限等待。

## [2.2.3] - 2025-12-12

### ✨ Added
- **后端聚合**
  - 实现了根据模型 ID 自动路由到对应适配器的逻辑。

### 🐛 Fixed
- **Mac 兼容性**
  - 修复了 MacOS 初始化步骤缺失导致的启动失败。

## [2.2.2] - 2025-12-12

### ✨ Added
- **Docker 支持**
  - 发布 Docker 镜像 [foxhui/lmarena-imagen-automator](https://hub.docker.com/r/foxhui/lmarena-imagen-automator).

## [2.2.1] - 2025-12-12

### ✨ Added
- **Cookie 导出**
  - 利用自动续登机制获取最新 Cookie，供外部工具使用。

### 🐛 Fixed
- **自动续登修复**：改为全局监听，修复了部分场景下不触发的问题。
- **杂项修复**：VNC 端口冲突、启动参数优化、zAI 错误反馈优化。

## [2.2.0] - 2025-12-11

### ✨ Added
- **新适配器支持**
  - 支持 zAI (zai.is)，含自动 Discord 登录处理。

### 🐛 Fixed
- **Gemini Business**：修复监听器重复触发问题。
- **Mac 输入法**：修复拟人输入无法全选的问题。

## [2.0.0] - 2025-12-06

### 💥 Breaking Changes
- **核心迁移**
  - 从 Puppeteer 迁移至 **Playwright + Camoufox**。
  - 旧版代码归档至 `puppeteer-edition` 分支。

### ✨ Added
- **新适配器支持**
  - 支持 Nano Banana Free。
- **功能特性**
  - 内置 XVFB/VNC 支持命令。
  - 支持 Gemini Business 过期自动续登。
