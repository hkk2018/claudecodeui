---
title: "Session 載入效能優化"
description: "優化 getSessionMessages 函數，從掃描全部檔案改為直接定位 session 檔案"
last_modified: "2025-12-22 01:40"
---

# Session 載入效能優化

## 問題描述

載入 Claude 對話內容時速度緩慢，特別是專案有大量 session 檔案時。

### 根本原因分析

在 `server/projects.js` 的 `getSessionMessages()` 函數中，原本的實作會：

1. 列出專案目錄下所有 JSONL 檔案
2. 過濾掉 `agent-*.jsonl` 檔案
3. **遍歷所有剩餘檔案**，逐行讀取並解析 JSON
4. 檢查每行的 `sessionId` 是否匹配目標

### 原本實作的執行流程圖解

假設要載入 session `0a8ada05-8d1f-4c30-b44d-164c91b4a019`：

```
步驟 1: 列出目錄下所有檔案
~/.claude/projects/-home-ubuntu-Projects-ken-claudecodeui/
├── 00aaa3c5-01e1-496b-aa00-aa56b2aedaea.jsonl  ← 要讀
├── 01933418-421d-4510-94cb-c536742dcbcb.jsonl  ← 要讀
├── 037e304d-be3d-408f-8a27-29b43391e0ba.jsonl  ← 要讀
├── ...
├── 0a8ada05-8d1f-4c30-b44d-164c91b4a019.jsonl  ← 要讀 (目標檔案！)
├── ...
├── agent-732abc12.jsonl                         ← 過濾掉
├── agent-84def345.jsonl                         ← 過濾掉
└── ... (共 938 個檔案，過濾後剩 206 個)

步驟 2: 逐一開啟每個檔案，逐行讀取並比對 sessionId
```

具體執行過程：

```javascript
// 檔案 1: 00aaa3c5-01e1-496b-aa00-aa56b2aedaea.jsonl (0 bytes，空檔案)
// → 開啟檔案，讀取 0 行，找到 0 個匹配

// 檔案 2: 01933418-421d-4510-94cb-c536742dcbcb.jsonl (0 bytes)
// → 開啟檔案，讀取 0 行，找到 0 個匹配

// ... 繼續讀取第 3~49 個檔案 ...

// 檔案 50: 0a8ada05-8d1f-4c30-b44d-164c91b4a019.jsonl (1.1MB, 152 行)
// → 開啟檔案，逐行讀取：
行 1: {"sessionId":"0a8ada05-...","type":"queue-operation",...}
      ↓ JSON.parse() 解析整行
      ↓ 檢查 entry.sessionId === "0a8ada05-..." ? ✓ 匹配！加入 messages[]

行 2: {"sessionId":"0a8ada05-...","type":"user",...}
      ↓ JSON.parse() 解析整行
      ↓ 檢查 entry.sessionId === "0a8ada05-..." ? ✓ 匹配！加入 messages[]

// ... 讀完這個檔案的全部 152 行 ...

// 檔案 51-206: 即使目標已全部找到，仍繼續讀取剩餘 155 個檔案
// → 每個檔案都開啟、讀取、解析、比對... 全部不匹配
```

### 問題點總結

```
❌ 明明檔案名稱就是 sessionId，卻完全沒有利用這個資訊
❌ 讀了 206 個檔案，只有 1 個檔案包含目標資料
❌ 即使找到目標檔案後，程式碼沒有 break，還是繼續讀完剩餘的 155 個檔案
❌ 每一行都要執行 JSON.parse() 然後比對 sessionId 字串
```

### 時間消耗分佈

| 動作 | 次數 | 說明 |
|------|------|------|
| `fs.readdir()` | 1 次 | 列出 938 個檔案名稱 |
| `createReadStream()` | 206 次 | 開啟 206 個檔案的讀取串流 |
| `readline` 逐行讀取 | ~7,854 行 | 讀取所有檔案的總行數 |
| `JSON.parse()` | ~7,854 次 | 每行都要解析成 JavaScript 物件 |
| `sessionId` 字串比對 | ~7,854 次 | 每行都要檢查是否匹配 |

### 效能數據（claudecodeui 專案為例）

| 指標 | 數值 |
|------|------|
| 總 JSONL 檔案數 | 938 個 |
| agent-*.jsonl | 732 個（被過濾） |
| 實際掃描檔案數 | **206 個** |
| 總行數 | ~7,854 行 |
| 平均每檔案行數 | 8.4 行 |
| 最大檔案 | 10MB (1,650 行) |

**問題：每次載入一個 session，都要讀取 206 個檔案的全部內容！**

## 解決方案

### 關鍵發現

Claude 的目錄結構設計中，**檔案名稱就是 sessionId**：

```
~/.claude/projects/{projectName}/
├── 0a8ada05-8d1f-4c30-b44d-164c91b4a019.jsonl  ← sessionId = 檔案名
├── ef504fbd-2891-4e7a-842c-faf25bac3bb7.jsonl
└── ...
```

### 優化策略

直接用 `sessionId` 定位檔案，無需掃描：

```javascript
// 優化前：掃描所有檔案
const files = await fs.readdir(projectDir);
const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
for (const file of jsonlFiles) { // 206 個檔案！
  // 逐行讀取...
}

// 優化後：直接定位
const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
// 只讀取這一個檔案
```

## 實作細節

### 修改檔案

`server/projects.js` - `getSessionMessages()` 函數

### 程式碼變更

```javascript
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);

  try {
    // OPTIMIZATION: Directly read the session file by sessionId
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    const messages = [];

    try {
      await fs.access(sessionFile);

      // Read only the target session file
      const fileStream = fsSync.createReadStream(sessionFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    } catch (accessError) {
      // Fallback to scanning all files (legacy behavior)
      if (accessError.code === 'ENOENT') {
        // ... 原本的全掃描邏輯作為 fallback
      } else {
        throw accessError;
      }
    }

    // ... 排序和分頁邏輯不變
  }
}
```

### 向後相容

- 如果 `{sessionId}.jsonl` 檔案不存在，自動 fallback 到原本的全掃描邏輯
- 確保舊版本 Claude 或特殊情況下仍能正常運作

## 效能提升

| 指標 | 優化前 | 優化後 | 提升 |
|------|--------|--------|------|
| 檔案讀取數 | 206 個 | 1 個 | **206x** |
| I/O 操作 | ~7,854 行 | 平均 8.4 行 | **~900x** |
| 預估載入時間 | 1-2 秒 | 10-50 毫秒 | **20-200x** |

## 測試驗證

1. 重啟開發版服務：`sudo systemctl restart claude-code-ui-dev`
2. 在 port 9001 測試切換不同 session
3. 確認載入速度明顯提升
4. 確認歷史對話內容正確顯示

## 相關檔案

- `server/projects.js:806-906` - getSessionMessages 函數
- `src/components/ChatInterface.jsx:2129-2174` - loadSessionMessages 前端呼叫

## 未來優化方向

1. **記憶體快取**：快取最近 10 個 session 的訊息
2. **預先索引**：建立 `sessions.index.json` 加速 session 列表載入
3. **增量載入**：WebSocket 推送新訊息，減少完整重載
