# 订餐小程序 · 后端部署指南（公网跨设备共享）

目标：把 `server/` 跑到一个**公网可达、支持常驻进程**的平台，让所有用户访问同一个后端、
数据进同一个 SQLite，从而「别人能注册 + 你后台能看到所有人的订单」。

> ⚠️ 前提：公网链接必须跑**后端(remote 模式)**，纯静态托管(如 CloudStudio)做不到跨设备共享。
> 本项目 `web/js/store.js` 会自动探测同源 `/api`，可达即 remote、不可达降级 local，无需改前端。

## 目录结构（部署时保持即可）
```
meal-reservation/
├── server/
│   ├── server.js        # 后端（Node22 + node:sqlite，零第三方依赖）
│   ├── package.json      # start: node server.js, engines.node >=22
│   └── data.db           # 运行时自动生成（不要提交进仓库）
└── web/                  # 前端静态文件（后端同源托管，无需单独部署）
```

## 方案 A：Render（推荐，免费额度，原生支持 Node 22）
1. 把整个 `meal-reservation/` 推到你的 GitHub 仓库。
2. 打开 https://render.com → New → Web Service → 关联该仓库。
3. 设置：
   - **Root Directory**：留空（仓库根）
   - **Build Command**：留空（无构建步骤）
   - **Start Command**：`npm start`（根目录 package.json 已声明，等价于 `node server/server.js`）
   - **Node Version**：22（根 package.json 的 `engines.node` 已声明，Render 会自动选用，无需手动选）
4. ⚠️ **【重要】数据持久化（否则改密/白名单会"丢失"）**
   Render 免费版的磁盘是**临时**的：每次自动重部署 / 实例重启都会清空 `data.db`，
   于是你刚改的后台密码会被重置回 `admin123`、你加的白名单会被抹掉——表现就是
   「改完密码登不上」「别人注册被拒」。**这正是公网链接出问题的根因。**
   解决：在 Render 后台给该服务加一个 **Disk**，挂载路径填 **`/data`**（容量 1GB 即可）。
   - 本项目 `server.js` 已支持：检测到 `/data` 目录会自动把数据库落到 `/data/data.db`，
     无需再手动设环境变量（当然也可显式设 `DB_PATH=/data/data.db` 覆盖）。
   - 挂盘后重新部署，数据即跨重启/重部署保留；之后你改的密码、加的白名单都永久有效。
5. 部署完成后得到 `https://xxx.onrender.com`，浏览器打开即是 remote 模式，
   后台密码 `admin123`（设置里可改）。把链接发给别人，他们用白名单手机号注册即可。

## 方案 B：Railway
步骤类似：New Project → Deploy from GitHub repo → Start Command `node server/server.js`，
Node 版本选 22。持久化同样需挂 Volume 并设置 `DB_PATH`。

## 方案 C：自有云服务器（ECS / 轻量应用服务器）
1. 安装 Node 22：`node -v` 需 >= 22。
2. 上传 `server/` 与 `web/`，`npm install`（无依赖，仅生成 lock）后 `node server/server.js`。
3. 用 pm2 守护：`npm i -g pm2 && pm2 start server/server.js --name meal`。
4. Nginx 反代 80/443 到该端口，并配置 HTTPS（微信小程序要求 HTTPS）。

## 验证（部署后）
- 浏览器打开你的公网地址 → 能看到菜单即成功（remote 模式）。
- 后台：点底部「后台」→ 输入 `admin123` → 进入可管理菜单/白名单/订单。
- 让别人注册：在后台把他的手机号加入白名单 → 他打开链接用该号 + 自设密码注册 →
  你后台「用户 / 订单」里立刻能看到。

## 本地自测
```bash
cd server && PORT=8137 node server.js
# 另开终端
curl http://127.0.0.1:8137/api/settings
```
