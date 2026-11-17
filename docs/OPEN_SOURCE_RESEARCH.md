# 开源选型调研（2026-11-16）

需求拆解：① 公司内网可用（自托管、不依赖外网/云）② 按日期新建纪要 ③ 每篇像 OneNote 一样，文字和图片可在页面任意位置自由组合。

| 候选 | 自由画布（图文任意位置） | 按日期/日记 | 内网自托管 | 许可证风险 | 结论 |
|---|---|---|---|---|---|
| **AFFiNE**（github.com/toeverything/AFFiNE） | ✅ Edgeless 无限画布，文档与画布可切换，底层 BlockSuite 块编辑器 | ✅ 有 Journal | ✅ 可完全自托管、本地优先 | ⚠️ 编辑器 MIT，但并非所有后端/企业组件都是 MIT，需逐项核对；整套部署较重（数据库/存储/协同服务），二次开发成本高 | **最佳现成参考**：如果只想直接部署、不改代码，优先试它 |
| **tldraw** | ✅ 无限画布 SDK，文字/图片/绘图齐全 | ❌ 需自建 | ✅ 可自建后端 | ❌ **生产使用需付费 license key**，其许可证自述并非开源定义 | **排除**：公司内网正式使用有授权风险 |
| **Excalidraw** | ✅ 无限画布，MIT，可自托管为静态站 | ❌ 无笔记本/日期结构 | ✅ 极轻 | ✅ MIT | 适合做画布组件参考，不适合单独当纪要本 |
| **TriliumNext / Trilium** | ⚠️ 有 Excalidraw 画布笔记类型，但画布与正文是分开的笔记类型 | ✅ 有 daily notes | ✅ Docker 自托管，内网浏览器访问 | ✅ 开源 | 适合个人知识库，不满足“一页内图文自由混排”这一核心要求 |
| **Joplin / AppFlowy** | ❌ Markdown / 文档流式排版，无自由画布 | 部分 | ✅ | ✅ | 排除：排版方式不对 |

## 本项目的选择

不直接 fork AFFiNE（太重、内网改一处要懂整套 BlockSuite + 协同后端），也不用 tldraw（授权）。
本仓库 `intranet-notebook` 借鉴 AFFiNE Edgeless + Excalidraw 的画布交互，自研轻量实现：

- 零 npm 依赖（Node 标准库 + 原生前端），内网离线机器 `git clone` 后直接 `node server.js`，不用连 npm 源
- 数据按日期落盘 `data/YYYY-MM-DD.json`，备份就是拷贝文件夹
- 后续如果团队变大、需要多人实时协同，再评估迁移到 AFFiNE 自托管版，数据结构（日期 + 元素块 x/y/w/h）可做转换脚本

## 参考链接
- AFFiNE: https://github.com/toeverything/AFFiNE
- Excalidraw: https://github.com/excalidraw/excalidraw
- TriliumNext: https://github.com/TriliumNext/Trilium
