---
title: "Claude Code UI - 開發指南"
description: "部署架構、更新流程、環境變數處理與除錯指引"
last_modified: "2026-03-29 12:49"
---

# Claude Code UI - 開發指南

## 部署架構

本專案在本機有兩個版本同時運行：

| Port | 用途 | 來源 | Service 名稱 |
|------|------|------|--------------|
| 9001 | 開發測試版 | 本地 repo (`/home/ubuntu/Projects/ken/claudecodeui`) | `claude-code-ui-dev` |
| 9002 | 穩定回退版 | npm package (`@siteboon/claude-code-ui@1.10.5`) | `claude-code-ui` |

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
ExecStart=/usr/bin/node /home/ubuntu/Projects/ken/claudecodeui/server/index.js --port=9001
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**注意**：PORT 使用命令列參數 `--port=9001` 而非環境變數，避免子進程繼承導致衝突。

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

在 `server/index.js:942-950`，PTY spawn 時會傳遞完整的 `process.env`：

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

在 `server/index.js` 中，可以在 spawn 時過濾掉不想繼承的環境變數：

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
