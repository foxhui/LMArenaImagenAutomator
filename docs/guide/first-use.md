# 首次使用

首次使用 WebAI2API 时，需要完成登录初始化才能正常使用。

## 登录模式

### 启动登录模式

登录模式会强制关闭无头模式

```bash
# 启动第一个 Worker 进行登录
npm start -- -login

# 启动指定 Worker 进行登录
npm start -- -login=workerName
```

### Linux 用户特殊说明

Linux 服务器用户可以使用 Xvfb + VNC 方式：

```bash
npm start -- -xvfb -vnc
```

然后通过 VNC 客户端连接 `:5900` 端口进行操作（也可使用 WebUI 中的虚拟显示器板块）

## 初始化步骤

1. **登录账号**
   - Linux 用户使用 `npm start -- -xvfb -vnc` 启动程序，然后使用 WebUI 或者第三方工具连接 VNC
   - 在打开的浏览器中登录相应平台的账号
   - 例如：Google 账号用于 Gemini，GitHub 账号用于 LMArena

2. **完成验证**
   - 在输入框发送任意消息
   - 触发并完成 CloudFlare/reCAPTCHA 验证
   - 同意服务条款

3. **验证成功**
   - 确认可以正常发送消息和接收回复
   - 关闭浏览器或按 `Ctrl+C` 退出登录模式


::: tip 运行建议
- 初始化完成后可使用无头模式运行，为降低风控风险，**强烈建议长期保持非无头模式运行**。
- **WebUI 和 VNC 传输过程均未加密，若在公网环境运行请走 SSH 隧道或者使用 Caddy/Nginx 为 WebUI 添加 HTTPS 连接**
   ```bash
   # SSH隧道方法：在本地终端运行，将服务器 5900 端口映射到本地
   ssh -L 5900:127.0.0.1:5900 root@服务器IP
   ```
:::

## 多 Worker 登录

如果配置了多个 Worker，需要分别为每个 Worker 完成登录：

```bash
# 依次登录各个 Worker
npm start -- -login=worker1
npm start -- -login=worker2
```

::: info 共享登录状态
同一 Instance（浏览器实例）下的多个 Worker 共享登录状态。如果使用 Google OAuth 等统一登录方式，只需登录一次即可。
:::

## WebUI 登录模式

服务运行后，也可以通过 WebUI 切换到登录模式：

1. 访问 http://localhost:3000
2. 进入「系统管理」页面
3. 点击「重启」按钮的下拉箭头
4. 选择「登录模式重启」或指定 Worker 登录

## 下一步

登录完成后，请阅读以下内容：

- [配置文件](/config/overview) - 了解完整配置选项
- [API 参考](/api/overview) - 开始使用 API
