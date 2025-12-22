# 首次使用

首次使用 WebAI2API 时，需要完成登录初始化才能正常使用。

## 1. 调整配置文件

程序初次运行会从`config.example.yaml`复制配置文件到`data/config.yaml`

::: tip 小贴士
**配置文件的生效需要重启程序！**
:::

```yaml
server:
  # 监听端口
  port: 3000
  # 鉴权 API Token (可使用 npm run genkey 生成)
  # 该配置会对 API 接口和 WebUI 生效
  auth: sk-change-me-to-your-secure-key
```

## 2. 访问 Web 管理界面

服务启动后, 打开浏览器访问:
```
http://localhost:3000
```

::: tip 小贴士
**远程访问**: 将 `localhost` 替换为服务器 IP 地址即可远程访问。
**API Token**: 配置文件中的`auth`所配置的鉴权密钥。
**安全建议**: 公网环境建议使用 Nginx/Caddy 配置 HTTPS 或通过 SSH 隧道访问。
:::


## 3. 初始化账号登录

> [!IMPORTANT]
> **首次使用必须完成以下初始化步骤**:

1. **连接虚拟显示器**:
   - Linux/Docker: 在 WebUI 的"虚拟显示器"板块连接
   - Windows: 直接在弹出的浏览器窗口中操作

2. **完成账号登录**:
   - 手动登录所需的 AI 网站账号
   - 在输入框发送任意消息, 触发并完成人机验证 (如需要)
   - 同意服务条款或者新手指引 (如需要)
   - 确保不再有初次使用相关内容的阻拦

3. **SSH 隧道连接示例**(公网服务器推荐):
   ```bash
   # 在本地终端运行,将服务器的 WebUI 映射到本地
   ssh -L 3000:127.0.0.1:3000 root@服务器IP
   
   # 然后在本地访问
   # WebUI: http://localhost:3000
   ```

::: tip 运行建议
为降低风控, **强烈建议长期保持非无头模式运行**(或使用虚拟显示器 Xvfb)。

**关于有头/无头模式**:
- **有头模式**(默认): 显示浏览器窗口, 便于调试和人工干预
- **无头模式**: 后台运行, 节省资源但无法查看浏览器界面, 且可能会被网站检测
:::

## 登录模式

登录模式会强制关闭无头模式

### 基础用法
```bash
# 启动第一个 Worker 进行登录
npm start -- -login

```

### 多 Worker 登录

如果配置了多个 Worker，需要分别为每个 Worker 完成登录：

```bash
# 依次登录各个 Worker
npm start -- -login=worker1
npm start -- -login=worker2
```

::: info 共享登录状态
同一 Instance（浏览器实例）下的多个 Worker 共享登录状态。如果使用 Google OAuth 等统一登录方式，只需登录一次即可。
:::

### WebUI 登录模式

服务运行后，也可以通过 WebUI 切换到登录模式：

1. 访问 http://localhost:3000
2. 进入「系统管理」页面
3. 点击「重启」按钮的下拉箭头
4. 选择「登录模式重启」或指定 Worker 登录

## 4.下一步

登录完成后，请阅读以下内容：

- [配置文件](/config/overview) - 了解完整配置选项
- [API 参考](/api/overview) - 开始使用 API
