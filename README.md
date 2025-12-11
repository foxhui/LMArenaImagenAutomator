# LMArenaImagenAutomator
![Image](https://github.com/user-attachments/assets/0a887137-64c3-4919-8ab6-b5cf23e5f751)

## 📝 项目简介

LMArenaImagenAutomator 是一个基于 Playwright + Camoufox 的自动化图像生成工具，通过模拟人类操作与 LMArena、Gemini 等网站交互提供图像生成服务到OpenAI格式的接口。

当前支持的网站：
  - [LMArena](https://lmarena.ai/)
  - [Gemini Enterprise Business](https://business.gemini.google/)
  - [Nano Banana Free](https://nanobananafree.ai/)
  - [zAI](https://zai.is/)
  - 未来可能支持更多网站。。。

### ✨ 主要特性

- 🤖 **拟人操作**：模拟人类打字行为和鼠标移动行为
- 🖼️ **多图支持**：最多支持同时上传 10 张参考图片
- 📊 **队列管理**：支持任务队列，防止请求过载或超时
- 🌐 **代理支持**：支持 HTTP 和 SOCKS5 代理配置
- 🎭 **特征伪装**：尽量伪装成非自动程序控制的浏览器
- 🔗 **流式保活**：复用标准接口的流式模式发送心跳包

---

## 🚀 快速部署

本项目支持 **源码直接运行** 和 **Docker 容器化部署** 两种方式。

### 📋 环境要求
- **Node.js**: v20.0.0+ (ABI 115+)
- **操作系统**: Windows / Linux / macOS
- **核心依赖**: Camoufox (安装过程中自动获取)

### 🛠️ 方式一：手动部署

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
   npm start -- -login  # 首次运行（进入登录模式）
   npm start            # 标准运行
   ```

### 🐳 方式二：Docker 部署

> ⚠️ **特别说明**：首次运行需设置 `LOGIN_MODE=true`，并通过 VNC 客户端连接 `localhost:5900` 完成网页登录验证。

**Docker CLI**
```bash
docker run -d --name lmarena-automator \
  -p 3000:3000 -p 5900:5900 \
  -v "$(pwd)/data:/app/data" \
  -e LOGIN_MODE=true \
  --shm-size=2gb \
  foxhui/lmarena-imagen-automator:latest
```

**Docker Compose**
```bash
# 确保 docker-compose.yml 中 LOGIN_MODE=true
docker-compose up -d
```

---

## 📖 使用方法

### ⚠️ 首次使用必读

1. **启动登录模式**：
   - 请使用 `npm start -- -login` 进入登录模式（关闭无头模式）。
   - Linux用户使用 `npm start -- -xvfb -vnc` 进入登录模式且创建虚拟显示器到VNC。
2. **完成初始化**：
   - 手动登录账号。
   - 在输入框发送任意消息，触发并完成 CloudFlare/reCAPTCHA 验证及服务条款同意。
3. **运行建议**：初始化完成后可切换回标准模式，但为降低风控，**强烈建议长期保持非无头模式运行**。


### 接口使用说明

#### 1. OpenAI 兼容接口

> [!WARNING]
> **并发限制与流式保活建议**
> 本项目通过模拟真实浏览器操作实现，**必须串行处理任务**，并发请求将进入队列。为防止排队过久导致客户端超时，当积压任务达到 3 个时将拒绝新请求。
> 
> **💡 强烈建议开启流式模式**：服务器将发送保活心跳包，有效避免因排队等待造成的连接超时。

**请求端点**
```
POST http://127.0.0.1:3000/v1/chat/completions
```

<details>
<summary>📄 查看API请求示例</summary>

**请求示例（非流式）**
```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "generate a cat"
          }
      ]
      }
    ]
  }'
```

**响应格式（非流式）**
```json
{
  "id": "chatcmpl-1732374740123",
  "object": "chat.completion",
  "created": 1732374740,
  "model": "gemini-3-pro-image-preview",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "![generated](data:image/jpeg;base64,/9j/4AAQ...)"
    },
    "finish_reason": "stop"
  }]
}
```

**请求示例（流式 - 推荐）**
```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "stream": true,
    "messages": [
      {
        "role": "user",
        "content": "generate a cat"
      }
    ]
  }'
```

**响应格式（流式）**
```
data: {"id":"chatcmpl-1732374740123","object":"chat.completion.chunk","created":1732374740,"model":"gemini-3-pro-image-preview","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

: keep-alive
: keep-alive

data: {"id":"chatcmpl-1732374740123","object":"chat.completion.chunk","created":1732374740,"model":"gemini-3-pro-image-preview","choices":[{"index":0,"delta":{"content":"![generated](data:image/jpeg;base64,/9j/4AAQ...)"},"finish_reason":"stop"}]}

data: [DONE]
```
</details>

#### 参数说明

| 参数 | 说明 |
| :--- | :--- |
| **model** | **必填**。指定使用的模型名称（如 `gemini-3-pro-image-preview`）。<br>可通过 `/v1/models` 接口或查看 `lib/backend/models.js` 获取完整列表。 |
| **stream** | **推荐开启**。流式响应包含心跳保活机制，防止生成耗时过长导致连接超时。 |

> **💡 关于流式保活（Heartbeat）**
>
> 为防止长连接超时，系统提供两种保活模式（可在配置中切换）：
> 1. **Comment 模式（默认/推荐）**：发送 `:keepalive` 注释。符合 SSE 标准，兼容性最好。
> 2. **Content 模式**：发送空内容的 data 包。仅用于必须收到 JSON 数据才重置超时的特殊客户端。

#### 2. 获取可用模型列表

**请求端点**
```
GET http://127.0.0.1:3000/v1/models
```

<details>
<summary>📄 查看API请求示例</summary>

**请求示例**
```bash
curl -X GET http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer your-secret-key"
```

**响应格式**
```json
{
  "object": "list",
  "data": [
    {
      "id": "seedream-4-high-res-fal",
      "object": "model",
      "created": 1732456789,
      "owned_by": "lmarena"
    },
    {
      "id": "gemini-3-pro-image-preview",
      "object": "model",
      "created": 1732456789,
      "owned_by": "lmarena"
    }
  ]
}
```

</details>

#### 3. 获取Cookies

**功能说明**：可利用本项目的自动续登功能获取最新Cookie给其他工具使用。

**请求端点**
```
GET http://127.0.0.1:3000/v1/cookies
```

<details>
<summary>📄 查看API请求示例</summary>

**请求示例**
```bash
curl -X GET http://127.0.0.1:3000/v1/cookies \
  -H "Authorization: Bearer your-secret-key"
```

**响应格式**
```json
{
  "cookies": [
    {
      "name": "_GRECAPTCHA",
      "value": "09ADxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "domain": "www.google.com",
      "path": "/recaptcha",
      "expires": 1780000000,
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    },
    {
      "name": "OTZ",
      "value": "8888888_24_24__24_",
      "domain": "accounts.google.com",
      "path": "/",
      "expires": 1760000000,
      "httpOnly": false,
      "secure": true,
      "sameSite": "None"
    }
    .......... more
  ]
}
```

</details>

#### 4. 多模态请求 (图生图/图生文)

**功能说明**：支持在消息中附带图片进行对话或生成。

| 限制项 | 说明 |
| :--- | :--- |
| **支持格式** | PNG, JPEG, GIF, WebP |
| **数量限制** | 最大为10，但根据不同网站有不同出入 |
| **数据格式** | 必须使用 Base64 Data URL 格式 (如 `data:image/jpeg;base64,...`) |
| **自动转换** | 为保证兼容性与传输速度，服务器会自动将所有图片转换为 JPG 格式 |

<details>
<summary>📄 查看API请求示例</summary>

**请求示例**
```json
{
  "model": "gemini-3-pro-image-preview",
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "make it more colorful"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA..."
        }
      }
    ]
  }]
}
```

</details>

---

## 🔧 常见问题

<details>
<summary>❌ 请求被拒绝 (429 Too Many Requests)</summary>

**问题**: 并发请求过多

**解决方案**:
- 该问题仅存在未开启流式保活时出现
- 队列限制：1 个并发 + 2 个排队 (总计 3 个)
- 修改 `config.yaml` 中的`queue.maxQueueSize` (不建议)
- 等待当前任务完成后再提交新任务

</details>

<details>
<summary>❌ reCAPTCHA 验证失败</summary>

**问题**: 返回 `recaptcha validation failed`

**解决方案**:
- 这是 LMArena 的人机验证机制
- 建议：
  - 降低请求频率
  - 首次使用时手动完成一次验证 (关闭 headless 模式)
  - 使用稳定和纯净的 IP 地址 (可使用 [ping0.cc](https://ping0.cc) 查询IP地址纯净度)

</details>

<details>
<summary>❌ 图像生成超时</summary>

**问题**: 任务超过 120 秒未完成

**解决方案**:
- 启用流式保活确保客户端不会主动断开连接
- 检查网络连接是否稳定
- 某些复杂提示词可能需要更长时间

</details>

<details>
<summary>🐧 【Linux 环境下非无头模式运行】</summary>

**问题**: 需要在 Linux 服务器上显示浏览器界面（如手动过验证码）

**解决方案**:

**方法一：X11 转发**
- 推荐使用 WindTerm 等终端工具，开启 X-Server 功能
- 在 SSH 会话设置中启用 X11 转发 (Forward X11)

**方法二：Xvfb + X11VNC (推荐)**
使用虚拟显示器运行程序，并通过 VNC 远程查看。

1. **使用内置命令启动 (简便)**
   ```bash
   npm start -- -xvfb -vnc
   ```

2. **手动配置**
   如果内置命令无法满足需求，可手动分步执行：
   
   a. **启动虚拟显示器并运行程序** (屏幕号 99 可按需修改):
      ```bash
      xvfb-run --server-num=99 --server-args="-ac -screen 0 1920x1080x24" npm start
      ```

   b. **将虚拟显示器映射至 VNC**:
      ```bash
      x11vnc -display :99 -localhost -nopw -once -noxdamage -ncache 10 -forever
      ```

3. **建立 SSH 隧道连接 VNC** (安全推荐):
   ```bash
   # 在本地终端运行，将服务器 5900 端口映射到本地
   ssh -L 5900:127.0.0.1:5900 root@服务器IP
   ```
   随后使用 VNC 客户端连接 `127.0.0.1:5900` 即可。

</details>

---

## 📊 设备配置参考

| 资源 | 最低配置 | 推荐配置 | 
| :--- | :--- | :--- | 
| **CPU** | 1 核 | 2 核及以上 | 
| **内存** | 1 GB | 2 GB 及以上 | 

**实测环境表现**：
- **Oracle 免费机** (1C1G, Debian 12)：资源紧张，比较卡顿，仅供尝鲜或轻度使用。
- **阿里云轻量云** (2C2G, Debian 11)：运行流畅稳定，为本项目开发测试基准环境。

## 📄 许可证和免责声明

本项目采用 [MIT License](LICENSE) 开源。

**免责声明**:
本项目仅供学习交流使用。如果因使用该项目造成的任何后果 (包括但不仅限于账号被禁用)，作者和该项目均不承担任何责任。请遵守相关网站和服务的使用条款 (ToS)，以及相关数据的备份工作。

---

## 📋 更新日志

查看完整的版本历史和更新内容，请访问 [CHANGELOG.md](CHANGELOG.md)。

## 🕰️ 历史版本说明

本项目已从 Puppeteer 迁移至 Camoufox，以应对日益复杂的反机器人检测机制。基于 Puppeteer 的旧版本代码已归档至 `puppeteer-edition` 分支，仅作留存，**不再提供更新与维护**。

---

**感谢 LMArena 、Gemini 等网站提供图像生成服务！** 🎉
