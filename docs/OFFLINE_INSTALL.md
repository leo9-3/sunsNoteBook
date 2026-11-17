# 离线安装说明（隔离内网）

内网与外网隔离时，不用 GitHub、不用 npm、不用 Docker 拉镜像。用**离线安装包**拷进去（U 盘 / 内网文件共享均可）：

| 包 | 适用 | 内容 |
|---|---|---|
| `sunsNoteBook-v0.2.4-win-x64-offline.zip` | Windows 电脑/服务器（x64） | 程序本体 + 内置 Node.js 运行时（官方版 v24.22.1，SHA256 已校验） |
| `sunsNoteBook-v0.2.4-linux-x64-offline.tar.gz` | Linux 服务器（x64） | 程序本体 + 内置 Node.js 运行时 |

两个包都**免安装、不联网、不需要管理员权限**（开机自启/服务化除外）。

## Windows

1. 解压 zip 到任意目录，例如 `D:\sunsNoteBook\`
2. 双击 `start-windows.bat`（或直接双击 `start-windows.vbs`）：服务在后台静默启动，**没有黑窗口**
3. 浏览器会自动打开 `http://localhost:4173`；同事在内网打开 `http://这台电脑的IP:4173`
4. 如弹防火墙提示，勾选“专用网络”允许访问；要停止服务，双击 `stop-windows.bat`

长期运行：用“任务计划程序”建一个任务，开机/登录时运行 `start-windows.bat` 即可。

## Linux

```bash
tar -xzf sunsNoteBook-v0.2.4-linux-x64-offline.tar.gz
cd sunsNoteBook
sh start-linux.sh            # 前台运行，先试用
# 或装成系统服务（开机自启、后台运行）：
sudo sh install-service-linux.sh
```

然后内网打开 `http://服务器IP:4173`。

## 数据在哪、怎么备份

- 所有纪要都在程序目录的 `data/notebook.db`（本地 SQLite 数据库）里，图片也在其中（dataURL）
- 从 v0.1.x 升级：旧版 `data/YYYY-MM-DD.json` 会在首次启动时自动导入数据库，原文件移到 `data/legacy-json/` 留底，不用手工处理
- 备份 = 拷贝整个 `data/` 文件夹（服务停止时拷贝最稳妥）；迁移/升级 = 把 `data/` 拷进新目录覆盖

## 说明

- 离线包内置运行时来自 Node.js 官方发行版 v24.22.1（nodejs.org），遵循其 MIT 许可证，校验值见包内 `SHA256SUMS.txt`
- 已有 Node.js >= 18 的机器也可以只用 GitHub 源码包：`node server.js` 直接运行，无任何第三方依赖
