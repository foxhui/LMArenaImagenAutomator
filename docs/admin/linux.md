# Linux 部署

【Docker用户可无视】在 Linux 服务器上运行 WebAI2API 的特殊配置说明。

## 1.安装必要依赖

Linux 命令行模式下必要的依赖，他们可以让你在没有图形桌面的 Linux 环境下运行图形化应用。

### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install xvfb x11vnc
```

### CentOS/RHEL

```bash
sudo yum install xorg-x11-server-Xvfb x11vnc
```

### Arch Linux

```bash
sudo pacman -S xorg-server-xvfb x11vnc
```

## 2.运行程序

使用虚拟显示器运行程序，通过 VNC 远程查看。(程序会帮你处理好一切)

```bash
npm start -- -xvfb -vnc
```

这会自动：
- 启动 Xvfb 虚拟显示器
- 启动 x11vnc 服务器
- 可通过 WebUI 直接查看 VNC 画面

## 3.连接程序

### 通过 WebUI (推荐)

服务启动后，访问 WebUI 的「VNC 显示」页面即可直接查看。

### 通过 SSH 隧道

::: tip 小贴士
实际运行不一定是5900端口，程序会自动在 5900-5999 中寻找可用的 VNC 端口
:::

```bash
# 本地终端
ssh -L 5900:127.0.0.1:5900 root@服务器IP
```

然后使用 VNC 客户端连接 `127.0.0.1:5900`。


## 额外方式：终端 X11 转发

不推荐该方式，除非你愿意自己配置运行环境。

1. 在本地安装 X Server（如 VcXsrv、Xming）
2. 使用支持 X11 转发的终端（如 WindTerm）
3. 在 SSH 会话中启用 X11 转发

```bash
ssh -X user@server
```

## 常见问题

### 端口被占用

如果 5900 端口已被占用，VNC 服务器会自动查找 5901-5999 范围内可用的端口。

### 显示号冲突

Xvfb 会自动从 50 开始查找可用的显示号，避免与现有 X 服务器冲突。

### 无法连接至 VNC

请检查依赖是否被安装成功。