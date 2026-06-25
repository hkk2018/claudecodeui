---
title: "Claude Code UI - 開發指南"
description: "部署架構、更新流程、環境變數處理與除錯指引"
last_modified: "2026-05-31 16:25"
---

# Claude Code UI - 開發指南

## 部署架構

本專案在本機有兩個版本同時運行：

| Port | 用途 | 來源 | Service 名稱 |
|------|------|------|--------------|
| 9001 | 開發測試版 | 本地 repo (`/home/ubuntu/Projects/ken/claudecodeui`) | `claude-code-ui-dev` |
| 9002 | 穩定回退版 | npm package (`@siteboon/claude-code-ui@1.10.5`) | `claude-code-ui` |

## 系統依賴（apt 套件，⚠️ 不在版控）

IDE overlay 功能（列出/聚焦/置頂桌面上的 Cursor / VS Code 窗口，`server/routes/overlay.ts`）依賴以下**系統執行檔**。它們是 apt 套件，不是 npm 依賴，`pnpm install` 不會帶上 — 換機器或重灌系統必須手動補裝：

```bash
sudo apt install -y wmctrl   # 列窗 / 聚焦 / 置頂（核心，缺了會「No IDE windows」）
sudo apt install -y xdotool  # 舊版列窗用，部分輔助操作仍可能用到
```

**症狀對照**：UI 一直顯示「No IDE windows」、`/api/overlay/ide-projects` 回 500 而 X display 偵測看起來正常 → 多半是 `wmctrl` 沒裝（`command -v wmctrl` 確認）。code 無條件呼叫 `wmctrl -lx`，缺執行檔會 ENOENT，所有候選 display 一起失敗。

> 踩坑紀錄：列窗邏輯從 xdotool 改成 wmctrl（commit 1e81158 起）後，這台機器一直沒裝 wmctrl，導致「No IDE windows」。2026-06-25 補裝 wmctrl 後恢復；同時補上此依賴說明。

## 更新測試流程

當你修改了前端程式碼，需要部署到 port 9001 測試時，執行以下步驟：

### 1. 建置前端

```bash
pnpm run build
```

這會：
- 編譯 React 程式碼到 `dist/` 目錄
- 自動注入 `__BUILD_TIME__` 建置時間戳（可在 Settings → About 查看）

### 2. 複製 Service Worker

```bash
cp public/sw.js dist/sw.js
```

**重要**：`sw.js` 在 `public/` 目錄，Vite 建置時會複製到 `dist/`，但如果你修改了 `public/sw.js`，需要手動複製確保最新版本。

### 3. 重啟服務

```bash
sudo systemctl restart claude-code-ui-dev
```

### 一鍵更新指令

```bash
pnpm run build && cp public/sw.js dist/sw.js && sudo systemctl restart claude-code-ui-dev
```

## Systemd 服務配置

### 開發版 (`/etc/systemd/system/claude-code-ui-dev.service`)

```ini
[Unit]
Description=Claude Code UI Web Interface (Dev - local repo)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Projects/ken/claudecodeui
Environment="NODE_ENV=production"
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/usr/bin/node /home/ubuntu/Projects/ken/claudecodeui/dist-server/index.js --port=9001
Restart=always
RestartSec=10

# 資源硬限制：防止 busy-loop / 記憶體洩漏拖垮整台機器（16 核機器）
# CPUQuota=400% → 最多用 4 顆核心（100% = 1 核），剩 12 核留給系統
# MemoryHigh    → 軟限制，超過時 systemd 先嘗試回收記憶體
# MemoryMax     → 硬限制，壓不下去就 OOM kill 此 service（Restart=always 會自動重啟）
CPUQuota=400%
MemoryHigh=900M
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

**注意**：
- PORT 使用命令列參數 `--port=9001` 而非環境變數，避免子進程繼承導致衝突。
- `ExecStart` 指向 `dist-server/index.js`（TypeScript 編譯後的產物），不是 source 的 `server/index.ts`。
- 資源限制由 systemd cgroup 強制執行，程式碼層的 bug（busy-loop、記憶體洩漏）無法繞過。詳見下方「資源限制」章節。

### 穩定版 (`/etc/systemd/system/claude-code-ui.service`)

```ini
[Unit]
Description=Claude Code UI Web Interface (Stable - npm package)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
Environment="PORT=9002"
ExecStart=/usr/bin/npx @siteboon/claude-code-ui@1.10.5
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 資源限制（systemd cgroup）

### 為什麼需要

dev service 在本機跑了一陣子後曾出現程式碼層的 busy-loop（Gemini 自動分析迴圈，已於 commit `d634304` 修掉），導致 CPU 飆到 60%+ 拖垮整台機器畫面當機。即使該 bug 已修，未來新功能仍可能出現類似問題。**程式自己不可能可靠地限制自己的 CPU**——若卡在 busy-loop，那段「監控並自殺」的程式碼也會卡住。唯一可靠的防線是 OS 層強制限制。

### 機制

由 systemd 透過 Linux cgroup 強制執行，**只套用在 dev service (9001)**，stable 不動。三個關鍵設定（在 unit 檔的 `[Service]` 區塊）：

| 設定 | 值 | 行為 |
|------|----|------|
| `CPUQuota` | `400%` | 最多用 4 顆 CPU 核心（100% = 1 核）。本機 16 核，留 12 核給系統 |
| `MemoryHigh` | `900M` | 軟限制：超過時 kernel 先嘗試回收記憶體並節流 |
| `MemoryMax` | `1G` | 硬限制：壓不下去就 OOM kill 此 service，`Restart=always` 自動重啟 |

### 故障時的行為

| 情境 | 結果 |
|------|------|
| 程式 busy-loop | CPU 卡在 400%，系統其他 14 核不受影響，使用者畫面不會當 |
| 記憶體洩漏到 1GB | systemd 只殺 `claude-code-ui-dev`，自動重啟，**不影響系統其他程式** |
| 正常運作 | 一般用量約 280-500MB，遠低於限制 |

### 自行查證

```bash
# 看實際生效的限制值
systemctl show claude-code-ui-dev -p CPUQuotaPerSecUSec -p MemoryHigh -p MemoryMax -p MemoryCurrent

# CPUQuotaPerSecUSec=4s 代表每秒最多 4 秒 CPU 時間 = 400%
```

### ⚠️ 此設定不在版控

systemd unit 檔位於 `/etc/systemd/system/`，**不會跟著 git repo 走**。換機器或重灌系統時，需依本文檔重新建立 unit 檔，再執行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart claude-code-ui-dev
```

## 常用除錯指令

```bash
# 查看服務狀態
sudo systemctl status claude-code-ui-dev
sudo systemctl status claude-code-ui

# 查看服務日誌
journalctl -u claude-code-ui-dev -f
journalctl -u claude-code-ui -f

# 確認 port 使用情況
lsof -i :9001
lsof -i :9002

# 確認建置時間
ls -lh dist/assets/index-*.js
```

## PWA 快取說明

Service Worker (`public/sw.js`) 使用 **Network-First** 策略：
- 優先從網路載入最新版本
- 只有在離線時才使用快取
- 每次部署時版本號會自動更新（使用 `Date.now()`）

這解決了手機 PWA 無法清除快取的問題。用戶只需重新載入頁面即可獲取最新版本。

## 版本確認

在手機或桌面瀏覽器中，可以透過以下方式確認目前載入的版本：

1. 打開 **Settings**（齒輪圖示）
2. 切換到 **About** tab（可能需要向右滑動）
3. 查看 **Build Time** 顯示的建置時間

如果建置時間與預期不符，表示瀏覽器載入了舊版本，可以：
- 關閉瀏覽器後重新開啟
- 或等待 Service Worker 自動更新（通常幾秒內）

## 環境變數繼承行為

### 問題描述

透過 Claude Code UI 執行的所有指令（包括透過 WebSocket shell 執行的指令）都會**自動繼承** systemd 服務設定的環境變數。

**關鍵繼承的環境變數**：
- `NODE_ENV=production` - 來自 systemd 服務設定
- 其他所有 `process.env` 中的變數

### 程式碼位置

在 `server/index.ts:1146-1158`，PTY spawn 時會傳遞完整的 `process.env`：

```javascript
env: {
    ...process.env,  // ← 繼承所有環境變數
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    BROWSER: ...
}
```

### 影響範圍

所有透過 Claude Code UI 執行的指令都會看到這些環境變數，包括：
- 直接在 Terminal 中執行的指令
- Claude/Cursor 啟動的子進程
- 任何開發服務器（如 Vite、Next.js 等）

### 解決方案：選擇性過濾環境變數

如果你不希望某些指令繼承特定環境變數（例如 `PORT`），有以下選項：

#### 選項 1：在指令執行時明確覆蓋（推薦）

```bash
# 單一指令覆蓋
PORT=3000 pnpm run dev

# 或完全移除 PORT
env -u PORT pnpm run dev
```

#### 選項 2：修改程式碼，設定黑名單過濾

在 `server/index.ts` 中，可以在 spawn 時過濾掉不想繼承的環境變數：

```javascript
// 定義不要繼承的環境變數黑名單
const ENV_BLACKLIST = ['PORT'];

// 過濾環境變數
const filteredEnv = Object.keys(process.env)
    .filter(key => !ENV_BLACKLIST.includes(key))
    .reduce((obj, key) => {
        obj[key] = process.env[key];
        return obj;
    }, {});

shellProcess = pty.spawn(shell, shellArgs, {
    // ...
    env: {
        ...filteredEnv,  // ← 使用過濾後的環境變數
        TERM: 'xterm-256color',
        // ...
    }
});
```

#### 選項 3：使用命令列參數（已採用）

透過命令列參數 `--port=9001` 傳遞 PORT，而非環境變數。這樣子進程就不會繼承 PORT。

程式碼中的優先順序：
```javascript
const PORT = cliArgs.port || process.env.PORT || 3001;
```

### 建議做法

1. **保持現狀**：大多數情況下，環境變數繼承是有益的
2. **需要時覆蓋**：在執行特定指令時使用 `PORT=xxxx` 明確指定
3. **文檔記錄**：讓團隊成員知道這個行為，避免意外衝突

## SDK / 對話功能測試規範

測試 SDK 升級、slash command、對話流程等功能時，**必須使用測試專用 sandbox repo**，禁止使用任何有實際工作內容的 repo。

- **測試 repo 路徑**：`/home/ubuntu/Projects/ken/claudecodeui-sandbox`
- **測試方式**：透過 WebSocket API 送 `claude-command`，`projectPath` 指向 sandbox repo
- **禁止事項**：
  - ❌ 使用 `claudecodeui` 本身或其他有實際工作的 repo 進行對話測試
  - ❌ 使用使用者正在操作的 session
- **測試後清理**：測試產生的 session 可保留供除錯，但不要累積過多
