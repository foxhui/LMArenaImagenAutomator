# WebAI2API

## 项目简介

**WebAI2API** 是一个基于 **Camoufox (Playwright)** 的网页版 AI 服务转通用 API 的工具。通过模拟人类操作与 LMArena、Gemini 等网站交互，提供兼容 **OpenAI 格式** 的接口服务，同时支持 **多窗口并发** 与 **多账号管理**（浏览器实例数据隔离）。

### 📋 当前支持列表

| 网站名称 | 文本生成 | 图片生成 | 视频生成 |
| :--- | :---: | :---: | :---: | 
| [**LMArena**](https://lmarena.ai/) | ✅ | ✅ | 🚫 |
| [**Gemini Enterprise Business**](https://business.gemini.google/) | ✅ | ✅ | ✅ |
| [**Nano Banana Free**](https://nanobananafree.ai/) | 🚫 | ✅ | 🚫 |
| [**zAI**](https://zai.is/) | ❌ | ✅ | 🚫 |
| [**Google Gemini**](https://gemini.google.com/) | ✅ | ✅ | ✅ | 
| [**ZenMux**](https://zenmux.ai/) | ✅ | ❌ | 🚫 | 
| [**ChatGPT**](https://chatgpt.com/) | ❌ | ✅ | 🚫 | 
| 待续... | - | - | - | 

::: tip 实测环境表现
**获取完整模型列表**: 通过 `GET /v1/models` 接口查看当前配置下所有可用模型及其详细信息。

✅目前支持；❌目前不支持，但未来可能会支持；🚫网站不支持, 未来是否在支持看网站具体情况；
:::

## 项目截图

![Image](https://github.com/user-attachments/assets/296a518e-c42b-4e39-8ff6-9b4381ed4f6e)

![Image](https://github.com/user-attachments/assets/bfa30ece-6947-4f18-b2c9-ccc8087b7e89) 

![Image](https://github.com/user-attachments/assets/5b15ebd2-7593-4f0e-8561-83d6ba5d88ab) 

![Image](https://github.com/user-attachments/assets/53deea29-4071-4a07-8a61-211761c5f2f7) 
