# 内网纪要本 · Intranet Notebook

公司内网可用的笔记软件：**按日期新建纪要 + OneNote 式自由画布**。在一篇纪要里，文字块、标题、便签、待办和图片都可以放在画布任意位置，自由拖动、缩放、组合，不受文档流式排版限制。

选型调研见 [docs/OPEN_SOURCE_RESEARCH.md](docs/OPEN_SOURCE_RESEARCH.md)（对比了 AFFiNE / tldraw / Excalidraw / Trilium 等，结论：现成最接近的是 AFFiNE Edgeless，但部署重、tldraw 生产需付费授权，所以做了这个零依赖轻量版）。

## 功能

- 📅 **按日期管理**：一键新建今天的纪要（新建即落库并聚焦标题栏）；日期选择器打开任意一天；左侧年/月/日三级日期树（可折叠，按日期正序）+ 搜索；顶部标题栏给纪要命名，树上双击可改名，每篇可删除（顶部“删除本篇”或树上 ✕，均有确认）；画布或左侧栏空白处**右键**可在屏幕中央弹出日历，点任意一天即新建/打开；新纪要默认名为“XX日 星期X”（如“17日 星期二”），可改名；文字块默认贴合内容宽度，选中后拖右下角可改成任意宽度（文字自动换行），双击右下角恢复自动宽度
- 📊 **简单表格**：工具栏“＋ 表格”插入 3×3 表格，单元格直接打字，块顶部可 ＋行/－行/＋列/－列，第一行自动加粗作表头
- 🖼️ **自由画布**：双击任意处加文字；工具栏加标题/便签/待办；图片可点选上传、拖拽拖入、Ctrl+V 直接粘贴截图
- ✒️ **格式栏**：选中文字可切换字体（宋体/黑体/楷体/仿宋等）和正文/标题 1/2/3 等级（按行生效，和 Word 的标题样式一样；快捷键 Ctrl+Alt+0/1/2/3）；字体颜色（6 个预设色 + 自定义取色 + 默认色）可**逐字**设置——选中几个字就染几个字，v0.2.8 的整行颜色会自动迁移
- 🔥 **补丁热升级**：后续更新发小体积补丁包，解压覆盖到原安装目录即可，数据（data/）和运行环境（runtime/）都不动；页面文件每次打开现读，覆盖后刷新浏览器即是新版，一般不用重启服务（详见包内 UPGRADE.txt）
- 🖱️ 每个块可拖动到任意位置、拉右下角缩放；画布可平移、缩放
- 💾 自动保存到本地 SQLite 数据库 `data/notebook.db`（Node 内置，零依赖）；旧版按天 JSON 首次启动自动导入；可导出单篇 JSON
- 🔒 **纯内网**：零 npm 依赖、零外网请求，不需要账号，数据不出公司网络

> **隔离内网部署**：不用 GitHub/npm/Docker 拉取，直接用离线安装包（内置 Node 运行时，免安装免联网），见 [docs/OFFLINE_INSTALL.md](docs/OFFLINE_INSTALL.md)。

## 快速开始

```bash
# 需要 Node.js >= 18（内网离线也能跑，不用 npm install）
node server.js
# 打开 http://localhost:4173
```

Docker（内网服务器）：

```bash
docker compose up -d
# 打开 http://服务器IP:4173
```

## 目录

```
server.js          # 零依赖 Node 服务 + REST API (/api/notes)
public/            # 前端：index.html / app.js / style.css
data/              # 本地 SQLite 数据库 notebook.db（已 gitignore 内容）
docs/              # 选型调研
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/notes` | 全部纪要列表（日期、标题、块数） |
| GET | `/api/notes/2026-11-16` | 打开某天，没有则返回空白模板 |
| PUT | `/api/notes/2026-11-16` | 保存 `{title, elements:[{id,type,x,y,w,h,text/src}]}` |
| DELETE | `/api/notes/2026-11-16` | 删除某天 |

## 后续可加（v2 候选）

- 多人同时编辑（WebSocket 协同）、登录与权限、全文检索、图片独立文件存储（现在图片以 dataURL 存 JSON，适合截图类小图，单篇建议 < 30MB）

## License
MIT
