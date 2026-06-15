# 🤖 BOSS直聘 AI 智能助手

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一款基于 **Tampermonkey + FastAPI + DeepSeek** 的 BOSS 直聘一站式求职效率工具，集智能筛选、批量投递、AI 自动回复、简历自动发送、实时监控于一体。

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🔍 **智能筛选** | 包含/排除关键词过滤，精准投递 |
| 📤 **批量投递** | 自动遍历职位列表，一键海投 |
| 💬 **AI 代聊巡航** | 自动检测红点/未读消息，DeepSeek 生成回复 |
| 📎 **简历自动发送** | 巡到新对话自动发送简历图片 |
| 📊 **实时监控** | 后台 Dashboard + SSE 实时推送投递记录 |
| 🧠 **面板记忆** | 所有配置（API Key / 招呼语 / 关键词）永久保存 |
| 🛡️ **安全风控** | 日上限 + 随机延迟 + 不修改 DOM + 异常熔断 |

## 🚀 快速开始

### 1. 安装篡改猴（Tampermonkey）

Edge：`edge://extensions` → 搜索「篡改猴」→ 安装

Chrome：`chrome://extensions` → 搜索「Tampermonkey」→ 安装

### 2. 安装脚本

篡改猴 → 管理面板 → 新建脚本 → 粘贴 `BOSS助手.user.js` 全部内容 → `Ctrl+S` 保存

### 3. 启动后台（可选，投递记录监控用）

```bash
cd boss-automation
pip install fastapi uvicorn sqlalchemy
python app.py
```

浏览器打开 `http://127.0.0.1:8899` 查看实时投递监控。

### 4. 开始使用

1. 打开 `zhipin.com` → 登录
2. 页面右下角出现紫色面板「🤖 BOSS助手」
3. **设置 Tab**：填写 DeepSeek API Key、招呼语、关键词
4. **海投 Tab**：打开职位列表页 → 点「开始海投」
5. **代聊 Tab**：打开消息页 → 点「AI巡航代聊」

## 🏗️ 技术架构

```
Tampermonkey 脚本（注入 BOSS 页面）
├── 三层 PointerEvent 点击（穿透 Shadow DOM）
├── 五层 execCommand 输入（触发 Vue 响应式）
├── 12组多备选 CSS 选择器（应对平台改版）
└── GM_setValue 持久化配置

Python FastAPI 后端（:8899）
├── SQLite 投递记录存储
├── SSE 实时推送
├── 简历图片托管
└── Dashboard 监控页面
```

## 📁 项目结构

```
boss-automation/
├── BOSS助手.user.js      # 核心 Tampermonkey 脚本
├── app.py                # Python 后端（FastAPI）
├── dashboard.html        # 后台监控页面
├── requirements.txt      # Python 依赖
├── LICENSE               # MIT 开源协议
└── README.md
```

## ⚠️ 免责声明

本项目仅供**学习交流**使用，请勿用于商业用途。

- 使用者自行承担账号风险
- 建议设置合理日上限，模拟人类操作节奏
- 遇到验证码或风控提示请立即停止
- 作者不对因使用本项目导致的任何后果负责

## 📄 License

MIT © 2025
