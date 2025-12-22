# 快速部署

本项目支持 **手动部署（推荐）** 和 **Docker 容器化部署** 两种方式。

## 手动部署

### 1. 克隆项目

```bash
git clone https://github.com/foxhui/WebAI2API.git
cd WebAI2API
```

### 2. 安装依赖

```bash
# 1. 安装 NPM 依赖
pnpm install
# 2. 安装浏览器等预编译依赖
npm run init 
# 使用代理
# 直接使用 -proxy 可交互式输入代理配置
npm run init -- -proxy=http://username:passwd@host:port
```

::: warning 注意
`npm run init` 需要从 GitHub 下载文件，请确保网络畅通。
:::

### 3. 启动服务

```bash
# 标准启动
npm start
# Linux 系统 - 虚拟显示启动
npm start -- -xvfb -vnc
# 登录模式 (会临时强行禁用无头模式和自动化)
npm start -- -login (-xvfb -vnc)
```

## Docker 部署

::: warning **安全提醒**
- Docker 镜像默认开启虚拟显示器 (Xvfb) 和 VNC 服务
- 可通过 WebUI 的虚拟显示器板块连接
- **WebUI 传输过程未加密, 公网环境请使用 SSH 隧道或 HTTPS**
:::

### Docker CLI

```bash
docker run -d --name webai-2api \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  --shm-size=2gb \
  foxhui/webai-2api:latest
```

### Docker Compose

```yaml
services:
  webai-2api:
    image: foxhui/webai-2api:latest
    container_name: webai-2api
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    shm_size: '2gb'
    init: true
```

启动服务：

```bash
docker compose up -d
```

## 验证安装

服务启动后，访问以下地址验证：

- **Web 管理界面**: http://localhost:3000
- **API 接口测试**: http://localhost:3000/v1/chat/completions

## 下一步

部署完成后，请阅读 [首次使用](/guide/first-use) 完成登录初始化。
