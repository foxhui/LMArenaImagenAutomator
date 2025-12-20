# 快速部署

本项目支持 **手动部署（推荐）** 和 **Docker 容器化部署** 两种方式。

## 手动部署

### 1. 克隆项目

```bash
git clone https://github.com/foxhui/WebAI2API.git
cd WebAI2API
```

### 2. 复制配置文件

```bash
cp config.example.yaml config.yaml
```

### 3. 安装依赖

```bash
# 安装 Node.js 依赖
pnpm install

# 初始化预编译依赖
npm run init
```

::: warning 注意
`npm run init` 需要从 GitHub 下载文件，请确保网络畅通。
:::

### 4. 编辑配置

编辑 `config.yaml` 文件，设置鉴权密钥等配置：

```yaml
server:
  port: 3000
  auth: sk-your-secret-key  # 修改为你的密钥
```

### 5. 启动服务

```bash
# 标准运行
npm start

# Linux 命令行启动
npm start -- -xvfb -vnc
```

## Docker 部署

::: warning **特别说明**
登录相关操作可以在 WebUI 的虚拟显示器板块进行，也可通过 RealVNC 等工具连接（需添加映射 VNC 端口，默认非被占用的情况下为 5900）
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
