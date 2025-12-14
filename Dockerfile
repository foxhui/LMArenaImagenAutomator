FROM node:22-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

# 1. 安装系统依赖
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libgbm1 \
    libdbus-glib-1-2 \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 2. 复制依赖文件、脚本和补丁目录，然后安装
COPY package.json pnpm-lock.yaml ./
COPY scripts/ ./scripts/
COPY patches/ ./patches/
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 3. 复制源码并初始化
COPY . .
RUN npm run init

EXPOSE 3000 5900

# 4. 启动脚本
# 逻辑说明：
# A. 优先检查 /app/data/config.yaml (用户挂载的数据目录)
#    - 存在则使用它覆盖 /app/config.yaml
# B. 不存在 (首次运行)
#    - 复制 config.example.yaml 为 config.yaml
#    - 立即备份一份到 /app/data/config.yaml 供用户修改
CMD ["/bin/sh", "-c", "\
    if [ -f \"/app/data/config.yaml\" ]; then \
        cp /app/data/config.yaml /app/config.yaml; \
    else \
        echo '>>> First run detected. Generating default config...'; \
        cp config.example.yaml config.yaml; \
        echo '>>> Exporting default config to /app/data/config.yaml for you...'; \
        cp config.yaml /app/data/config.yaml; \
    fi; \
    \
    ARGS='-xvfb -vnc'; \
    if [ -n \"$LOGIN_MODE\" ]; then \
        if [ \"$LOGIN_MODE\" = \"true\" ]; then \
            echo '>>> ENABLED LOGIN MODE'; \
            ARGS=\"$ARGS -login\"; \
        else \
            echo \">>> ENABLED LOGIN MODE for worker: $LOGIN_MODE\"; \
            ARGS=\"$ARGS -login:$LOGIN_MODE\"; \
        fi; \
    fi; \
    \
    echo \">>> Starting application with args: $ARGS\"; \
    npm start -- $ARGS \
"]