# LMArenaImagenAutomator

## 📝 项目简介

LMArenaImagenAutomator 是一个基于 Puppeteer 的自动化图像生成工具，通过模拟人类操作与 LMArena 网站交互，提供图像生成服务。

项目支持两种运行模式：
- **OpenAI 兼容模式**：提供标准的 OpenAI API 接口，便于集成到现有应用
- **Queue 队列模式**：使用 Server-Sent Events (SSE) 实时推送生成状态

### ✨ 主要特性

- 💁‍♂️ **拟人操作**：模拟真实鼠标移动轨迹和抖动
- 🤖 **智能输入**：模拟人类打字速度和错误纠正行为
- 🖼️ **多图支持**：最多支持同时上传 5 张参考图片
- 🔐 **安全认证**：基于 Bearer Token 的 API 鉴权
- 📊 **队列管理**：智能任务队列，防止请求过载
- 🌐 **代理支持**：支持 HTTP 和 SOCKS5 代理配置
- 🎭 **特征伪装**：尽量伪装成真实浏览器的特征（详情参考文档结尾）

---

## 🚀 快速开始

### 系统要求

- **Node.js**: 16.0 或更高版本
- **操作系统**: Windows、Linux 或 macOS
- **浏览器**: Google Chrome 或 Chromium (Puppeteer 会自动下载，但是**更推荐**使用Google Chrome)

### 安装步骤

1. **克隆项目**（如果从仓库获取）或解压项目文件

2. **安装依赖**
   ```bash
   pnpm install
   ```

3. **生成 API 密钥**
   ```bash
   npm run genkey
   ```
   此命令会生成一个安全的随机密钥，请保存并配置到 `config.yaml` 中。

---

## ⚙️ 配置说明

配置文件位于项目根目录下的 `config.yaml`，首次运行时会自动生成默认配置。

<details>
<summary>📝 查看详细配置说明</summary>

### 服务器配置
```yaml
server:
  # 运行模式: 'openai' (OpenAI 兼容) 或 'queue' (SSE 队列)
  type: queue
  # 监听端口
  port: 3000
  # API 鉴权密钥 (使用 npm run genkey 生成)
  auth: sk-change-me-to-your-secure-key
```

### 浏览器配置
```yaml
chrome:
  # Chrome 可执行文件路径 (留空使用 Puppeteer 内置版本)
  # Windows 示例: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  # Linux 示例: "/usr/bin/chromium"
  path: ""
  
  # 是否启用无头模式 (true = 后台运行，false = 显示浏览器)
  headless: false
  
  # 是否启用 GPU 加速 (无显卡服务器设为 false)
  gpu: false
```

### 代理配置
```yaml
chrome:
  proxy:
    # 是否启用代理
    enable: false
    # 代理类型: 'http' 或 'socks5'
    type: http
    # 代理服务器地址
    host: 127.0.0.1
    # 代理端口
    port: 7890
    # 代理认证 (可选)
    # user: username
    # passwd: password
```

### 重要配置建议

| 配置项 | 建议值 | 说明 |
|-------|--------|------|
| `server.type` | `queue` | 使用队列模式可获得实时状态反馈 |
| `server.auth` | 强密钥 | 务必修改默认值，使用 `npm run genkey` 生成 |
| `chrome.headless` | `false` / `true` | 建议保持非无头模式（true已映射为new模式） |
| `chrome.gpu` | `false` / `true` | 无显卡环境强烈建议关闭 |

</details>


---

## 📖 使用方法

### 首次使用重要指引

#### 1. 首次启动与登录
- **关闭无头模式**：第一次启动程序时，请务必关闭无头模式。（**Linux无界面用户请参阅文档结尾**）
- **完成账号登录**：等待网页加载完毕后，请手动登录您的账号，以避免后续使用中弹出登录界面。

#### 2. 验证流程
- **触发验证**：在输入框中输入任意内容并发送，等待服务条款和CloudFlare Turnstile验证码弹出。
- **通过验证**：点击验证码并同意服务条款，然后再次点击发送。此过程可能会弹出reCAPTCHA验证码，请一并完成。

#### 3. 后续运行建议
- **模式选择**：完成上述步骤后，您可以选择切换为无头模式运行。
- **推荐模式**：为减少触发人机验证的频率，建议仍保持非无头模式运行。


### 方式一：使用 HTTP API

**启动服务器**
```bash
npm start
```

#### OpenAI 兼容模式
> [!WARNING]
> 由于模拟真实浏览器操作，每次只能处理一个任务，其余任务将进入队列等待。为避免客户端超时影响体验，若当前任务数已达3个，后续请求将直接返回错误。因此，强烈推荐使用队列模式（`queue`），该模式下服务器会向客户端发送心跳包以确保连接持续活跃。

**配置文件设置**
```yaml
server:
  type: openai
  port: 3000
  auth: your-secret-key
```

**请求端点**
```
POST http://127.0.0.1:3000/v1/chat/completions
```

<details>
<summary>📄 查看API请求示例</summary>

**请求示例**
```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "messages": [
      {
        "type": "text",
        "text": "generate a cat"
      }
    ]
  }'
```

**响应格式**
```json
{
  "id": "chatcmpl-1732374740123",
  "object": "chat.completion",
  "created": 1732374740,
  "model": "lmarena-image",
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
</details>

> **关于 `model` 参数**：
> - **必填**：必须填写支持的模型名称，否则将使用 LMArena 网页默认模型
> - **查看可用模型**：
>   - 方式 1：访问 `/v1/models` 接口查询
>   - 方式 2：直接查看 `lib/models.js` 文件
> - **示例模型**：`seedream-4-high-res-fal`、`gemini-3-pro-image-preview`、`dall-e-3` 等

#### 获取可用模型列表

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

> **说明**：
> - 此接口在 **OpenAI 兼容模式** 和 **Queue 队列模式** 下均可用
> - `created` 字段为当前请求时的时间戳
> - 完整模型列表可在 `lib/models.js` 文件中查看

#### Queue 队列模式（SSE）（推荐）

**配置文件设置**
```yaml
server:
  type: queue
```

**请求端点**
```
POST http://127.0.0.1:3000/v1/queue/join
```

**SSE 事件类型**

| 事件类型 | 数据格式 | 说明 |
|---------|---------|------|
| `status` | `{status: "queued", position: 1}` | 任务已入队 |
| `status` | `{status: "processing"}` | 开始处理 |
| `result` | `{status: "completed", image: "base64..."}` | 生成成功 |
| `result` | `{status: "error", msg: "错误信息"}` | 生成失败 |
| `heartbeat` | 时间戳 | 保持连接 |
| `done` | `"[DONE]"` | 流结束 |

<details>
<summary>📄 查看 Node.js 示例代码</summary>

```javascript
import http from 'http';

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/v1/queue/join',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-secret-key'
  }
};

const req = http.request(options, (res) => {
  res.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        const event = line.substring(7).trim();
        console.log('事件类型:', event);
      } else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.substring(6));
        console.log('数据:', data);
      }
    }
  });
});

req.write(JSON.stringify({
  model: "gemini-3-pro-image-preview",
  messages: [{ role: "user", content: "a cute cat" }]
}));
req.end();
```

</details>


> **提示**：Queue 模式同样支持 `model` 参数，用法与 OpenAI 兼容模式一致。

#### 带图片的请求

**支持格式**：PNG、JPEG、GIF、WebP  
**最大数量**：5 张图片  
**数据格式**：Base64 编码

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

### 方式二：使用CLI客户端脚本

**启动CLI工具**
```bash
npm test
```
根据指引填写图片路径和提示词即可

---

## 📁 项目结构

<details>
<summary>🗂️ 查看目录结构</summary>

```
lmarena/
├── server.js          # HTTP 服务器 (主入口)
├── config.yaml        # 配置文件
├── package.json       # 项目依赖
├── lib/
│   ├── lmarena.js     # 核心生图逻辑 (Puppeteer 操作)
│   ├── models.js      # 模型映射配置
│   ├── config.js      # 配置加载器
│   ├── genApiKey.js   # API 密钥生成工具
│   └── test.js        # 功能测试脚本
└── data/
    ├── chromeUserData/  # Chrome 用户数据 (自动创建)
    └── temp/            # 临时图片存储
```

</details>

---

## 🔧 常见问题

<details>
<summary>❌ 浏览器启动失败</summary>

**问题**: `Error: Failed to launch the browser process`

**解决方案**:
- 确保已安装 Chrome 或 Chromium
  - 大陆地区设备可能因网络原因 Puppeteer 自动安装失败
  - 可尝试手动安装后填写 `chrome.path` (Linux 可使用 `which` 指令检索路径)
- 检查 `config.yaml` 中的 `chrome.path` 是否正确
- 尝试删除 `data/chromeUserData` 目录后重新运行

</details>

<details>
<summary>❌ GPU 相关错误</summary>

**问题**: 无显卡服务器运行时出现 GPU 错误

**解决方案**:
- 该报错并不会影响程序运行，但是强烈建议在无显卡的设备上关闭GPU加速
```yaml
chrome:
  gpu: false  # 禁用 GPU 加速
```

</details>

<details>
<summary>❌ 请求被拒绝 (429 Too Many Requests)</summary>

**问题**: 并发请求过多

**解决方案**:
- 该问题仅存在于OpenAI兼容模式
- 当前限制：1 个并发 + 2 个排队 (总计 3 个)
- 修改 `server.js` 中的 `MAX_CONCURRENT` 和 `MAX_QUEUE_SIZE` (不建议，应为大多数客户端HTTP请求是有超时时间的)
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
- 检查网络连接是否稳定
- 某些复杂提示词可能需要更长时间

</details>

<details>
<summary>🐧 【Linux 环境下非无头模式运行】</summary>

**问题**: 需要在 Linux 服务器上显示浏览器界面（如手动过验证码）

**解决方案**:

**方法一：X11 转发 (轻量级)**
- 推荐使用 WindTerm 等终端工具，开启 X-Server 功能
- 在 SSH 会话设置中启用 X11 转发 (Forward X11)

**方法二：Xvfb + X11VNC (推荐)**
使用虚拟显示器运行程序，并通过 VNC 远程查看。

1. **启动虚拟显示器并运行程序** (屏幕号 99 可按需修改):
   ```bash
   xvfb-run --server-num=99 --server-args="-ac -screen 0 1280x720x24" npm start
   ```

2. **将虚拟显示器映射至 VNC**:
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

<details>
<summary>🎭 【浏览器特征伪装】</summary>

**问题**: 如何优化浏览器特征伪装，减少验证码弹出频率？

**浏览器指纹伪装状态**:

- **Windows 10 (官方 Chrome)**:
  - ✅ 已通过 [antibot](https://bot.sannysoft.com/) 和 [CreepJS](https://abrahamjuliot.github.io/creepjs/) 测试，无红色警示。
- **Linux 环境**:
  - ⚠️ 未完全通过 CreepJS 测试，但实际使用中影响较小，检测严格程度可能低于测试工具。

**进一步优化建议**:

完成后，可有效缓解验证码的弹出频率。

**1. 使用官方 Chrome（推荐）**

不推荐使用 Chromium，因为它缺少 MP4/H.264 解码器等插件，且被大量爬虫使用，会成为明显特征。

**Linux 安装官方 Chrome**:
```bash
# 从 Google 官方下载 Chrome deb 安装包
# 大陆服务器可手动下载deb安装包 https://www.google.com/chrome/?platform=linux
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt-get install -f  # 修复可能的依赖问题
```

**配置方式**:

修改 `config.yaml`，可使用`which google-chrome`指令查询路径
```yaml
chrome:
  path: "/usr/bin/google-chrome"
```

使用环境变量可跳过 Puppeteer 自动下载 Chromium
```bash
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
```

**2. 优化字体指纹**

Linux 服务器通常只安装了极少量字体（甚至没有中文），这会增加指纹特征。

**安装常用字体**:
```bash
# 安装中文字体（必备，否则中文提示词将显示方框）
sudo apt install fonts-wqy-zenhei fonts-wqy-microhei

# 安装微软核心字体（减少字体指纹差异）
sudo apt install ttf-mscorefonts-installer
```

</details>

---

## 📊 设备配置
| 资源 | 最低配置 | 推荐配置 |
|------|---------|---------|
| CPU | 1核 | 2核及以上 |
| 内存 | 1GB | 2GB 及以上 |

经测试，本项目可在以下环境中稳定运行：
- Oracle 免费机：1C1G 配置，基于 Debian 系统。
- 阿里云轻量应用服务器：2C2G 配置，基于 Debian 系统。

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

**注意**: 本项目仅供学习和研究使用，请遵守 LMArena.ai 的使用条款。

---

## 📋 更新日志

查看完整的版本历史和更新内容，请访问 [CHANGELOG.md](CHANGELOG.md)。

---

**感谢 LMArena 提供图像生成服务！** 🎉
