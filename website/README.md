# AI DB Client — 项目官网

AI DB Client 项目的多页官网。

纯静态多页站点 —— HTML / CSS / JS，**零构建步骤、零依赖**，由 GitHub Pages 直接部署 `website/` 目录。

## 目录结构

```
website/
├── index.html              # 产品介绍页
├── docs.html               # 文档页（侧栏目录 + 手写正文）
├── download.html           # 下载页（三平台卡 + 动态拉取 Release）
├── pricing.html            # 定价页（开源免费档 + 功能矩阵）
├── roadmap.html            # 路线图页（M0–M5 已交付 / M6 / P1 规划中）
├── assets/
│   ├── css/styles.css      # 设计 token + 共享组件 + 各页专属样式
│   ├── js/main.js          # nav/mobile/reveal/scroll-spy + 下载页 OS 检测与 Release 拉取
│   └── images/
│       ├── favicon.svg
│       └── logo.svg        # header/footer logo
└── README.md
```

## 本地预览

任选一个：

```bash
python3 -m http.server 8080 --directory website
# 或
npx serve website
```

然后浏览器打开 <http://localhost:8080>。

## 页面清单

| 页面   | 文件            | 内容                                                                                                                                         |
| ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 产品   | `index.html`    | Hero + 数据条 + 为什么用（痛点→解法）+ 六大能力 + 安全架构 + CTA                                                                             |
| 文档   | `docs.html`     | 侧栏目录 + 正文：快速开始 / 命令打包 / 连接管理 / SQL 工作台 / AI 能力 / 数据库迁移 / 表结构编辑 / 权限安全 / 架构概览 / 自动更新 / 扩展指南 |
| 下载   | `download.html` | macOS / Windows / Linux 三平台卡（OS 自动检测高亮）+ 动态拉取 GitHub Releases 版本与直链 + 源码运行 + 签名说明                               |
| 定价   | `pricing.html`  | 单一开源免费档（¥0）+ 完整功能矩阵（数据库/AI/数据/SQL/迁移/安全/体验）+ 规划中能力                                                          |
| 路线图 | `roadmap.html`  | M0–M5 已交付时间线 + M6 MCP 与 P1 规划中                                                                                                     |

## 编辑

- **文案 / 内容** → 直接编辑对应 `*.html`
- **共享导航 / 页脚** → 每页的 `<header class="nav">` 与 `<footer class="footer">`（多页站点，各页独立维护；保持一致即可）
- **主题 token**（颜色、间距、字体）→ `assets/css/styles.css` 顶部的 `:root` 变量
- **各页专属样式** → `styles.css` 末尾的「MULTI-PAGE EXTENSION」区段（docs-layout / platform-card / pricing / roadmap-detail / why-grid / cap-grid 等）

## 交互（main.js）

- 导航滚动加深、移动端汉堡菜单
- 当前页导航高亮（按 `location.pathname` 匹配文件名）
- 滚动进入视口的元素渐显（IntersectionObserver）
- 文档侧栏 scroll-spy 高亮当前章节
- 下载页：OS 检测高亮推荐平台 + 拉取 GitHub Releases 渲染版本号 / 发布日期 / 各平台下载直链（失败回退到 Release 页）
- Hero / 页脚版本号：拉取最新 tag

## 说明

- 所有视觉元素都是 inline SVG（线稿风格），没有外部图片资源
- 字体只引入 Inter + JetBrains Mono（Google Fonts）
- 兼容 `prefers-reduced-motion`
- 移动端响应式最低支持 360px
- 文案严格对齐代码真实功能：MCP Server 仅作为「规划中」出现，不做已交付宣传
