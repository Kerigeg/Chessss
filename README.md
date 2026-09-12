# Chessss / 国际象棋对战

[English](#english) · [中文](#中文)

---

## English

Chessss is a server-authoritative chess application for local-area-network multiplayer and human-versus-computer games. The Node.js server owns room state, clocks, legal-move validation, and game results; the browser only renders state and submits commands.

### Features

- LAN game rooms for two human players, with automatic rated/casual matchmaking by time control, private room-code joining, cancellation, and reconnect support.
- Manual username/password sign-up and sign-in. Passwords are salted and hashed; browser sessions restore after a refresh.
- A live role-based administrator control center for users, games, analysis jobs, audit activity, fair-play reviews, website controls, alerts, trends, and read-only spectating. Existing installations can use the legacy bootstrap code once, then enroll each administrator with an individual salted password and TOTP authenticator code.
- Server-validated standard chess: legal moves, promotion, check, checkmate, stalemate, supported draws, and move history.
- Server-authoritative clocks and timeout losses.
- Computer play as White versus a Black computer controller:
  - Beginner — approximately Elo 250
  - Medium — approximately Elo 700
  - High — approximately Elo 1400
  - Hell — approximately Elo 2100
  - Stockfish — unrestricted engine mode
- Computer games offer 1, 3, 5, 10, 30, or 45 minutes per player.
- The computer waits at least two seconds before replying; engine thinking can make it take longer.
- End-of-game choices to play a rematch in the same room or return to the home screen.
- Finished games can be replayed move by move and exported as PGN.
- Finished games can be analyzed with Stockfish to show basic move labels, evaluation, and a suggested best move. Analysis is unavailable during live games.
- Completed games are archived locally for account history, later spectating, PGN export, and administrator analysis.
- Human rooms can be **Rated** or **Casual**. Rated games use independent Bullet (under 3 minutes), Blitz (3–7 minutes), and Rapid (over 7 through 30 minutes) Elo pools, with provisional ratings for the first ten games.
- Public pool leaderboards require five qualifying games and recent activity. Player profiles show ratings, peaks, records, recent rating transactions, and tournament history.
- Persistent 4–32 player Swiss tournaments support player-submitted private drafts, admin/moderator approval and permanent deletion, creator-managed event lifecycles, registration, optional check-in, 3–7 rounds, automatic assigned rooms, live standings, Buchholz tie-breaks, byes, spectating, forfeits, pause/resume, and restart recovery.
- Competitive state is server-authoritative and idempotent: duplicate completion events cannot award Elo or tournament points twice, and administrative forfeits never affect Elo.

### Magic board

Click **Enter Magic** above any board to open the immersive 2.5D chamber. Select pieces and destinations as usual; White and Black can independently use **Astral**, **Sovereign**, or **Neon** models. Skins are saved on this browser. The scene includes move trails, capture bursts, legal destinations, and check rings. Arrow keys navigate the keyboard board, and Enter selects a square.

Click **Exit Magic** or press **Esc** to return to the standard interface for replay, analysis, exports, resignation, or other features. Clocks continue normally. Spectator and replay positions stay read-only. Motion respects the system preference and can be switched off. WebGL2 is required for the 3D scene; the standard board remains available if graphics initialization fails.

### Prerequisites

- Node.js 24, or a current Node.js LTS release with Corepack.
- pnpm 10. The expected package-manager version is pinned in `package.json`.

### Local installation and startup

```bash
git clone https://github.com/Kerigeg/Chessss.git
cd Chessss
corepack enable
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in a browser.

| Service | Address | Purpose |
| --- | --- | --- |
| Web app | `http://localhost:5173` | Lobby, board, and game UI |
| API / realtime server | `http://localhost:3001` | Health endpoint and Socket.IO game state |

Use `Ctrl+C` in the terminal to stop both development services.

### Play on a LAN

1. Run `pnpm dev` on the host computer.
2. Find its local IP address, for example `192.168.1.20`.
3. On both devices, open `http://192.168.1.20:5173`.
4. Create an account or sign in on each device. For human multiplayer, one player chooses **Play a person → Create room** and shares the six-character room code. The other player chooses **Play a person → Join room** and enters the code.

Both devices must be on the same network. If macOS asks, allow incoming connections for Node.js. Do not expose these development ports directly to the public internet.

### Computer games

From the home screen choose **Play the computer**, then select a difficulty and a time control. You always play White in the current version.

The High and Hell levels use Stockfish limited-strength Elo controls. Beginner and Medium intentionally mix weaker/random legal moves because Stockfish’s native minimum Elo is above the requested low ratings, so their ratings are approximate rather than calibrated.

### Time controls

- Human LAN rooms start at one minute per side.
- Computer rooms use the time you choose before starting.
- A player loses automatically when their clock reaches zero.
- If a player has 20 seconds or less and completes a move within two seconds of their turn starting, two seconds are added to that player’s clock.
- Clocks pause while a required human player is disconnected.

### Commands

```bash
pnpm dev        # Start web and server in watch mode
pnpm build      # Build all workspace packages
pnpm test       # Build, then run unit tests
pnpm typecheck  # Build, then run TypeScript checks
```

### Project layout

```text
apps/web              React + Vite browser client
apps/server           Fastify + Socket.IO authoritative server
packages/chess-core   Pure chess.js-based domain helpers
packages/shared       Shared protocol and domain types
docs/adr              Architecture decisions
```

### Current limitations

- Room state is in memory; restarting the server removes active rooms.
- User accounts are stored locally in `data/users.json`; this LAN-focused credential storage is not yet production-grade.
- Active rooms still live in memory, but completed games, moderation audit records, fair-play reviews, accounts, and site configuration persist locally.
- Ratings and tournaments use versioned, atomically replaced JSON files. This is suitable for the current LAN/small-community deployment, but a transactional database is required before public, multi-server operation.
- A computer game currently assigns the human to White.
- This repository provides development/LAN startup, not a production deployment configuration.

### Stockfish license

Computer play uses Stockfish.js, a GPL-3.0 Stockfish WASM distribution. Any public distribution or deployment must retain the required notices and meet GPL obligations. See [ADR 0003](docs/adr/0003-computer-player-controller.md).

For product scope and architecture, see [requirements](docs/requirements.md), the [roadmap](docs/roadmap.md), and [ADRs](docs/adr/).

---

## 中文

Chessss 是一款支持局域网双人对战和人机对战的国际象棋应用。Node.js 服务端拥有房间状态、计时器、合法走子判定与棋局结果；浏览器只负责显示棋盘和提交操作。

### 功能

- 局域网双人房间：通过六位房间码加入，并提供基础断线重连。
- 支持手动用户名/密码注册和登录。密码会加盐哈希处理，刷新页面后会自动恢复浏览器会话。
- 提供实时、分角色的管理员控制中心，包含用户和棋局管理、分析任务、审计活动、公平竞赛审核、网站设置、告警、趋势图与只读观战。旧安装可先使用一次旧管理员代码，再为每位管理员启用独立加盐密码与 TOTP 验证器。
- 服务端判定标准国际象棋规则：合法走子、升变、将军、将死、逼和、支持的和棋与走子记录。
- 服务端权威计时与超时判负。
- 人机对战中人类执白、电脑执黑，提供五档难度：
  - Beginner：约 Elo 250
  - Medium：约 Elo 700
  - High：约 Elo 1400
  - Hell：约 Elo 2100
  - Stockfish：不限制 Elo 的引擎模式
- 人机模式可选择每方 1、3、5、10、30 或 45 分钟。
- 电脑每次走子前至少等待 2 秒；引擎计算较慢时会更久。
- 对局结束后可选择同一房间再战，或返回首页。
- 对局结束后可逐步回放，并下载 PGN 棋谱。
- 对局结束后可使用 Stockfish 进行基础复盘，查看走子标签、局面评价和建议最佳着法；进行中的对局不会提供分析。
- 已结束棋局会保存在本机，可用于账号历史、后续观战、PGN 导出和管理员分析。
- 真人房间可选择 **Rated（计分）** 或 **Casual（休闲）**。计分对局分为 Bullet（少于 3 分钟）、Blitz（3–7 分钟）和 Rapid（大于 7 分钟且不超过 30 分钟）三个独立 Elo 分池，前 10 局为暂定等级分。
- 各分池公开排行榜要求至少完成 5 局合资格对局并保持近期活跃；棋手档案包含当前/峰值等级分、战绩、近期分数记录与锦标赛历史。
- 支持持久化的 4–32 人 Swiss 锦标赛：报名、可选 check-in、3–7 轮、自动分配房间、实时排名、Buchholz 同分判定、轮空、观战、弃权与管理员全生命周期控制。
- 等级分和锦标赛结果均由服务端权威处理且具有幂等性；重复终局事件不会重复加分，管理员判定的弃权不会改变 Elo。

### Magic 沉浸式棋盘

在任意棋盘上方点击 **Enter Magic**，即可进入悬浮 2.5D 棋盘。黑白双方可分别选择 **星辉水晶 / 鎏金王朝 / 霓虹机甲** 三套建模皮肤，并在当前浏览器保存选择。支持走子轨迹、吃子粒子、合法落点提示、将军光环，以及方向键导航和 Enter 选格。

点击 **Exit Magic** 或按 **Esc** 返回普通模式后，才能使用复盘、分析、导出、认输等其他功能。切换不会暂停计时或重开棋局；观战和历史局面保持只读。可关闭动态特效，默认尊重系统的减少动态效果设置。3D 场景需要 WebGL2，加载失败时可返回普通棋盘继续。

### 环境要求

- Node.js 24，或启用了 Corepack 的当前 Node.js LTS 版本。
- pnpm 10；项目所需版本已固定在 `package.json` 中。

### 本地安装与启动

```bash
git clone https://github.com/Kerigeg/Chessss.git
cd Chessss
corepack enable
pnpm install
pnpm dev
```

然后在浏览器打开 [http://localhost:5173](http://localhost:5173)。

| 服务 | 地址 | 用途 |
| --- | --- | --- |
| 网页应用 | `http://localhost:5173` | 首页、棋盘与对局界面 |
| API / 实时服务 | `http://localhost:3001` | 健康检查与 Socket.IO 对局状态 |

在终端按 `Ctrl+C` 可停止前后端开发服务。

### 局域网部署与联机

1. 在主机上运行 `pnpm dev`。
2. 查找主机局域网 IP，例如 `192.168.1.20`。
3. 两位玩家都在浏览器访问 `http://192.168.1.20:5173`。
4. 两台设备都先注册或登录。真人对战中，一位玩家选择 **Play a person → Create room** 创建房间并分享六位房间码；另一位玩家选择 **Play a person → Join room** 并输入房间码。

两台设备必须接入同一个局域网。如 macOS 弹出防火墙提示，请允许 Node.js 的入站连接。开发端口不应直接暴露到公网。

### 人机对战

在首页选择 **Play the computer**，再选择电脑难度与每方用时。当前版本中玩家固定执白。

High 和 Hell 使用 Stockfish 的 Elo 限制选项。由于 Stockfish 原生最低 Elo 高于低难度要求，Beginner 与 Medium 会混合较弱或随机的合法走子，因此其 Elo 为近似值，而不是经过标定的等级分。

### 计时规则

- 真人局域网房间默认每方 1 分钟。
- 人机对局使用开始前所选择的时间。
- 任意一方时间归零即自动判负。
- 当某方剩余时间不超过 20 秒，且在自己回合开始后的 2 秒内完成走子，会增加 2 秒。
- 必须参与对局的人类玩家断线时，计时会暂停。

### 常用命令

```bash
pnpm dev        # 以监听模式启动网页和服务端
pnpm build      # 构建所有工作区包
pnpm test       # 构建后运行单元测试
pnpm typecheck  # 构建后执行 TypeScript 类型检查
```

### 项目结构

```text
apps/web              React + Vite 浏览器客户端
apps/server           Fastify + Socket.IO 权威服务端
packages/chess-core   基于 chess.js 的纯棋局领域逻辑
packages/shared       前后端共享协议和领域类型
docs/adr              架构决策记录
```

### 当前限制

- 房间状态只保存在内存中，服务端重启会清空进行中的房间。
- 用户账号保存于本机的 `data/users.json`；这种面向局域网的凭据存储尚未达到生产环境级别。
- 进行中的房间仍保存在内存中；已结束棋局、管理审计、公平竞赛审核、账号和网站设置会持久保存在本机。
- 等级分与锦标赛使用带版本号、原子替换写入的 JSON 文件。这适合当前局域网/小型社区版本；公开部署或多服务器运行前应迁移到事务型数据库。
- 人机对局中人类当前固定为白方。
- 仓库提供的是开发与局域网启动方式，不包含生产部署配置。

### Stockfish 许可证

人机模式使用 Stockfish.js（GPL-3.0 的 Stockfish WASM 发行版）。任何公开分发或部署都必须保留所需声明并满足 GPL 义务，详见 [ADR 0003](docs/adr/0003-computer-player-controller.md)。

更多产品范围和架构信息，请参阅 [requirements](docs/requirements.md)、[roadmap](docs/roadmap.md) 与 [ADR](docs/adr/)。
