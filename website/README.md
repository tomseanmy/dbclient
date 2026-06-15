# AI DB Client — 项目官网

AI DB Client 项目的官网着陆页。

纯静态单页站点 —— HTML / CSS / JS，**零构建步骤、零依赖**。

## 目录结构

```
website/
├── index.html              # 单页面（含全部内容）
├── assets/
│   ├── css/styles.css      # 主题 + 布局
│   ├── js/main.js          # 导航 + 滚动动效
│   └── images/favicon.svg
└── README.md
```

## 本地预览

任选一个：

```bash
# Python（无需额外安装）
python3 -m http.server 8080 --directory website

# 或 Node
npx serve website
```

然后浏览器打开 <http://localhost:8080>。

## 编辑

- **文案 / 内容** → 直接编辑 `index.html` 对应区块
- **主题 token**（颜色、间距、字体）→ `assets/css/styles.css` 顶部的 `:root` 变量
- **Hero 与架构图** → `index.html` 里的 inline SVG，viewBox 分别为 600×520 和 1100×560

## 页面分区

1. **导航** — 顶部固定，滚动后加深，移动端汉堡菜单
2. **Hero** — 工程蓝图风格：数据库柱体线稿 + AI 信号线穿过 + 扫描光束动画 + 浮动 MCP 工具标签
3. **核心数据** — 四个数字（4 库 / 3 路径 / 0 行数据 / 1 权限层）
4. **当前进度** — 从 README 同步过来的 ✅ / ⏳ 清单（连接管理 / 对象浏览 / SQL 工作台 / 安全层 / AI 双模式 / MCP / P1）
5. **核心特性** — 4 大卖点（AI 双模式 / MCP 内嵌 / Schema-only / 环境分级权限）
6. **架构** — 三条执行路径汇聚到统一的权限层闸门
7. **路线图** — M0~M4 + P1 六个阶段（M0–M3 已交付青色点 · M4 进行中紫色脉冲点 · P1 规划中）
8. **技术栈** — 8 张技术栈卡片（外壳 / 渲染层 / 驱动 / SQL 解析 / AI / MCP / 凭据 / 架构）
9. **CTA** — 引导到 GitHub 仓库
10. **页脚** — 品牌 + 项目 + 路线图 + 技术栈

## 说明

- 所有视觉元素都是 inline SVG（线稿风格），没有外部图片资源
- 字体只引入 Inter + JetBrains Mono（Google Fonts）
- 兼容 `prefers-reduced-motion`
- 移动端响应式最低支持 360px
