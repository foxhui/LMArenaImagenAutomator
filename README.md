# WebAI2API

![Image](https://github.com/user-attachments/assets/296a518e-c42b-4e39-8ff6-9b4381ed4f6e)

## 📑 目录

- [项目简介](#-项目简介)
- [主要特性](#-主要特性)
- [支持列表](#-支持列表)
- [快速部署](#-快速部署)
- [快速开始](#-快速开始)
- [配置说明](#-配置说明)
- [使用方法](#-使用方法)
- [API 接口](#-api-接口)
- [设备配置参考](#-设备配置参考)
- [常见问题](#-常见问题)
- [许可证和免责声明](#-许可证和免责声明)
- [更新日志](#-更新日志)

---

## 📝 项目简介

**WebAI2API** 是一个基于 **Camoufox (Playwright)** 的网页版 AI 服务转通用 API 的工具。通过模拟人类操作与 LMArena、Gemini 等网站交互,提供兼容 **OpenAI 格式** 的接口服务,同时支持 **多窗口并发** 与 **多账号管理**(浏览器实例数据隔离)。

### ✨ 主要特性

- 🤖 **拟人交互**: 模拟人类打字与鼠标轨迹,通过特征伪装规避自动化检测
- 🔄 **接口兼容**: 提供标准 OpenAI 格式接口,支持流式响应与心跳保活
- 🚀 **并发隔离**: 支持多窗口并发执行,可配置独立代理,实现多账号浏览器实例级数据隔离
- 🛡️ **稳定防护**: 内置任务队列、负载均衡、故障转移、错误重试等基础功能
- 🎨 **Web 管理界面**: 提供可视化管理界面,支持实时日志查看、VNC 连接、适配器管理等

### 📋 支持列表

| 网站名称 | 文本支持 | 图片支持 |
| :--- | :---: | :---: | 
| [**LMArena**](https://lmarena.ai/) | ✅ | ✅ |
| [**Gemini Enterprise Business**](https://business.gemini.google/) | ✅ | ✅ | 
| [**Nano Banana Free**](https://nanobananafree.ai/) | ❌ | ✅ | 
| [**zAI**](https://zai.is/) | ❌ | ✅ | `gemini-exp-1206` 等 |
| [**Google Gemini**](https://gemini.google.com/) | ❌ | ✅ | 

> [!NOTE]
> **获取完整模型列表**: 通过 `GET /v1/models` 接口查看当前配置下所有可用模型及其详细信息。
> 
> 未来可能会支持更多网站...

---

## 🚀 快速部署

本项目支持 **源码直接运行** 和 **Docker 容器化部署** 两种方式。

### 📋 环境要求

- **Node.js**: v20.0.0+ (ABI 115+)
- **操作系统**: Windows / Linux / macOS
- **核心依赖**: Camoufox (安装过程中自动获取)

### 🛠️ 方式一:手动部署

1. **安装与配置**
   ```bash
   # 1. 复制配置文件
   cp config.example.yaml config.yaml

   # 2. 安装依赖与初始化环境
   pnpm install
   npm run init  # ⚠️ 需确保网络能连接 GitHub
   ```

2. **启动服务**
   ```bash
   # 标准启动
   npm start

   # Linux 系统 - 虚拟显示启动
   npm start -- -xvfb -vnc
   ```

### 🐳 方式二:Docker 部署

> [!WARNING]
> **安全提醒**: 
> - Docker 镜像默认开启虚拟显示器(Xvfb)和 VNC 服务
> - 可通过 WebUI 的虚拟显示器板块或 RealVNC 等工具连接(默认端口 5900)
> - **VNC 和 WebUI 传输过程均未加密,公网环境请务必使用 SSH 隧道或 HTTPS**

**Docker CLI 启动**
```bash
docker run -d --name webai-2api \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  --shm-size=2gb \
  foxhui/webai-2api:latest
```

**Docker Compose 启动**
```bash
docker-compose up -d
```

**映射 VNC 端口(如需使用第三方 VNC 客户端)**
```bash
docker run -d --name webai-2api \
  -p 3000:3000 \
  -p 5900:5900 \
  -v "$(pwd)/data:/app/data" \
  --shm-size=2gb \
  foxhui/webai-2api:latest
```

---

## ⚡ 快速开始

### 1. 访问 Web 管理界面

服务启动后,打开浏览器访问:
```
http://localhost:3000
```

> [!TIP]
> **远程访问**: 将 `localhost` 替换为服务器 IP 地址即可远程访问。
> 
> **安全建议**: 公网环境建议使用 Nginx/Caddy 配置 HTTPS 或通过 SSH 隧道访问。

### 2. 初始化账号登录

> [!IMPORTANT]
> **首次使用必须完成以下初始化步骤**:

1. **连接虚拟显示器**:
   - Linux/Docker: 在 WebUI 的"虚拟显示器"板块连接,或使用第三方 VNC 工具连接端口 5900
   - Windows: 直接在弹出的浏览器窗口中操作

2. **完成账号登录**:
   - 手动登录所需的 AI 网站账号
   - 在输入框发送任意消息,触发并完成 CloudFlare/reCAPTCHA 验证
   - 同意服务条款(如需要)

3. **SSH 隧道连接示例**(公网服务器推荐):
   ```bash
   # 在本地终端运行,将服务器的 VNC 和 WebUI 映射到本地
   ssh -L 3000:127.0.0.1:3000 -L 5900:127.0.0.1:5900 root@服务器IP
   
   # 然后在本地访问
   # WebUI: http://localhost:3000
   # VNC: localhost:5900
   ```

---

## ⚙️ 配置说明

首次使用必须从 config.example.yaml 复制为 config.yaml (Docker 用户可忽略)

### 基础配置

```yaml
server:
  port: 3000              # API 服务端口
  apiKey: "your-key"      # API 访问密钥
```

> [!TIP]
> **完整配置说明**: 请参考 [config.example.yaml](config.example.yaml) 文件中的详细注释,或访问 [WebAI2API 文档中心](https://foxhui.github.io/WebAI2API/) 查看完整配置指南。

---

## 📖 使用方法

### 运行模式说明

> [!NOTE]
> **关于有头/无头模式**:
> - **有头模式**(默认): 显示浏览器窗口,便于调试和人工干预
> - **无头模式**: 后台运行,节省资源但无法查看浏览器界面
> 
> **建议**: 为降低风控,**强烈建议长期保持非无头模式运行**(至少保持虚拟显示器 Xvfb)。

---

## 🔌 API 接口

> [!TIP]
> **详细文档**: 请访问 [WebAI2API 文档中心](https://foxhui.github.io/WebAI2API/) 获取更全面的配置指南与接口说明。

### 1. OpenAI 兼容接口

> [!WARNING]
> **并发限制与流式保活建议**
> 
> 本项目通过模拟真实浏览器操作实现,处理过程根据实际情况时间可能有所变化,当积压的任务超过设置的数量时会直接拒绝非流式模式的请求。
> 
> **💡 强烈建议开启流式模式**: 服务器将发送保活心跳包,可无限排队避免超时。

#### 文本对话

**端点**: `POST /v1/chat/completions`

**请求示例**:
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gemini-3-pro",
    "messages": [
      {"role": "user", "content": "你好,请介绍一下你自己"}
    ],
    "stream": true
  }'
```

#### 多模态请求(文生图/图生图)

**支持的图片格式**:
- **格式**: PNG, JPEG, GIF, WebP
- **数量**: 最大 10 张(具体限制因网站而异)
- **数据格式**: 必须使用 Base64 Data URL 格式
- **自动转换**: 服务器会自动将所有图片转换为 JPG 格式以保证兼容性

#### 参数说明

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `model` | string | ✅ | 模型名称,可通过 `/v1/models` 获取可用列表 |
| `stream` | boolean | 推荐 | 是否开启流式响应,包含心跳保活机制 |

> [!NOTE]
> **关于流式保活 (Heartbeat)**
>
> 为防止长连接超时,系统提供两种保活模式 (可在配置中切换):
> 1. **Comment 模式 (默认/推荐)**: 发送 `:keepalive` 注释,符合 SSE 标准,兼容性最好
> 2. **Content 模式**: 发送空内容的 data 包,仅用于必须收到 JSON 数据才重置超时的特殊客户端

### 2. 获取模型列表

**端点**: `GET /v1/models`

**请求示例**:
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 3. 获取 Cookies

**功能说明**: 利用本项目的自动续登功能获取最新 Cookie 供其他工具使用。

**端点**: `GET /v1/cookies`

**参数**:
- `name` (可选): 浏览器实例名称,默认为 `default`
- `domain` (可选): 过滤指定域名的 Cookie

**请求示例**:
```bash
# 获取指定实例和域名的 Cookie
curl "http://localhost:3000/v1/cookies?name=browser_default&domain=lmarena.ai" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 📊 设备配置参考

| 资源 | 最低配置 | 推荐配置 (单实例) | 推荐配置 (多实例) |
| :--- | :--- | :--- | :--- |
| **CPU** | 1 核 | 2 核及以上 | 2 核及以上 |
| **内存** | 1 GB | 2 GB 及以上 | 4 GB 及以上 |
| **磁盘** | 2 GB 可用空间 | 5 GB 及以上 | 7 GB 及以上 |

**实测环境表现** (均为单浏览器实例):
- **Oracle 免费机** (1C1G, Debian 12): 资源紧张,比较卡顿,仅供尝鲜或轻度使用
- **阿里云轻量云** (2C2G, Debian 11): 运行流畅,项目开发测试所用机型

---

## 📄 许可证和免责声明

本项目采用 [MIT License](LICENSE) 开源。

> [!CAUTION]
> **免责声明**
> 
> 本项目仅供学习交流使用。如果因使用该项目造成的任何后果 (包括但不限于账号被禁用),作者和项目均不承担任何责任。请遵守相关网站和服务的使用条款 (ToS),并做好相关数据的备份工作。

---

## 📋 更新日志

查看完整的版本历史和更新内容,请访问 [CHANGELOG.md](CHANGELOG.md)。

### 🕰️ 历史版本说明

本项目已从 Puppeteer 迁移至 Camoufox,以应对日益复杂的反机器人检测机制。基于 Puppeteer 的旧版本代码已归档至 `puppeteer-edition` 分支,仅作留存,**不再提供更新与维护**。

---

**感谢 LMArena、Gemini 等网站提供 AI 服务!** 🎉
