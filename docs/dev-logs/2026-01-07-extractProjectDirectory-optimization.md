---
title: "extractProjectDirectory 效能優化"
description: "使用 head -1 優化專案目錄提取，從 96 秒降到 0.2 秒"
last_modified: "2026-01-07 12:43"
---

# extractProjectDirectory 效能優化

## 問題描述

`getProjects()` API 載入時間過長（約 100 秒），經 `[PERF]` log 分析發現 `extractProjectDirectory()` 佔用 96,873ms（96 秒）。

## Claude CLI 資料結構

### 目錄架構

```
~/.claude/projects/
└── -home-ubuntu-Projects-ken-claudecodeui/    # 專案目錄（路徑以 - 編碼）
    ├── 01942bc8-xxxx-xxxx.jsonl               # Session 1
    ├── 01943def-xxxx-xxxx.jsonl               # Session 2
    ├── 01944abc-xxxx-xxxx.jsonl               # Session 3 (最新)
    └── ...（每次啟動 claude 都會建立新 session）
```

### 關係說明

| 概念 | 說明 |
|------|------|
| Project | 一個工作目錄，名稱是路徑編碼（`/` → `-`） |
| Session | 一次 `claude` CLI 執行，對應一個 JSONL 檔案 |
| JSONL 內容 | 每行一個 JSON，記錄對話事件（user/assistant/tool_use） |

### 實際資料規模

| 項目 | 數量 |
|------|------|
| 專案總數 | 21 個 |
| claudecodeui 專案的 sessions | 1,465 個 JSONL 檔案 |
| 所有專案 JSONL 總數 | 5,615 個檔案 |
| 總行數 | 101,973 行 |

### JSONL 檔案格式

每一行包含 `cwd` 欄位，記錄當時的工作目錄：

```json
{"type":"user","message":"幫我修 bug","cwd":"/home/ubuntu/Projects/ken/claudecodeui","timestamp":"..."}
{"type":"assistant","message":"好的...","cwd":"/tmp/test-build","timestamp":"..."}  // Claude 可能 cd 到別的目錄
```

## 原本的實作（慢）

```javascript
// 讀取所有 JSONL 檔案的所有行
for (const file of jsonlFiles) {
  const rl = readline.createInterface({ input: createReadStream(file) });
  for await (const line of rl) {
    const entry = JSON.parse(line);
    if (entry.cwd) {
      cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);
    }
  }
}
// 選擇出現最多次的 cwd
```

**問題**：讀取 101,973 行 JSON，耗時 96 秒

## 優化後的實作（快）

```javascript
// Helper: 用 head -1 讀取檔案第一行（O(1) 不管檔案多大）
async function readFirstLine(filePath) {
  const { stdout } = await execFileAsync('head', ['-1', filePath], { timeout: 5000 });
  return stdout.trim();
}

// 1. 找最新的 JSONL（按 mtime 排序）
const fileStats = await Promise.all(jsonlFiles.map(async (file) => {
  const stat = await fs.stat(filePath);
  return { file, filePath, mtime: stat.mtimeMs };
}));
fileStats.sort((a, b) => b.mtime - a.mtime);

// 2. 只讀最新檔案的第一行
const firstLine = await readFirstLine(fileStats[0].filePath);
const entry = JSON.parse(firstLine);
const cwd = entry.cwd;
```

**關鍵優化**：
- `head -1` 只讀檔案開頭幾 KB，O(1) 時間複雜度
- 只讀 1 個檔案的 1 行，而非 5,615 個檔案的 101,973 行

## 為什麼讀第一行而非最後一行？

**問題**：Claude 在對話過程中可能 `cd` 到臨時目錄執行指令

```
Session 開始 → cwd: /home/ubuntu/Projects/myapp     ← 使用者啟動的目錄
Claude 工作 → cwd: /tmp/test-build                  ← 臨時目錄
Claude 工作 → cwd: /home/ubuntu/.npm                ← 其他目錄
Session 結束 → cwd: /tmp/test-build                 ← tail -1 會讀到這個！
```

**解法**：讀第一行（`head -1`），因為 session 開始時的 `cwd` 一定是使用者啟動 `claude` 的專案目錄。

## 效能改善

| 項目 | 優化前 | 優化後 | 改善倍數 |
|------|--------|--------|----------|
| extractProjectDirectory | 96,873ms | 233ms | **416x** |
| getProjects() 總時間 | ~100s | ~6s | **16x** |

## Fallback 機制

1. 如果最新檔案第一行沒有 `cwd`，嘗試前 3 個檔案
2. 如果都沒有，fallback 到路徑解碼（`-home-ubuntu-xxx` → `/home/ubuntu/xxx`）

## 修改的檔案

- `server/projects.js:267-277` - 新增 `readFirstLine()` helper
- `server/projects.js:279-350` - 重寫 `extractProjectDirectory()`

## 後續優化方向

目前最大瓶頸已轉移到 `getSessions()`（約 5-6 秒），可考慮：
1. 實作 session summary API，只讀取 session 的 metadata 而非完整內容
2. 增量載入：先顯示專案列表，session 列表背景載入
