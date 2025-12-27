---
title: "修復 CPU 使用率過高問題"
description: "Chokidar 檔案監控導致的 CPU 持續 100%+ 問題"
last_modified: "2025-12-26 15:14"
---

# 修復 CPU 使用率過高問題

## 問題描述

Claude Code UI Server（port 9001 和 9002）在運行時 CPU 使用率持續在 100%~150%，即使沒有活躍的用戶連線。

## 根本原因

經調查發現是一個 **自我強化的循環**：

1. **Claude Code CLI 持續寫入 session JSONL 檔案**（用戶與 Claude 對話時）
2. **Chokidar 偵測到 `~/.claude/projects/` 目錄下的檔案變更**
3. **觸發 `debouncedUpdate()`**，呼叫 `getProjects()`
4. **`getProjects()` 解析所有 JSONL 檔案**（目前有 4,485 個檔案，66,624 行 JSON）
5. **大量 JSON.parse() 和字串處理消耗 CPU**
6. **同時 Claude CLI 繼續寫入**，觸發更多 chokidar 事件
7. **循環持續**

### Perf Profile 結果

| CPU % | 函數 |
|-------|------|
| 12.24% | `JsonParser::ScanJsonString` (JSON 解析) |
| 12.18% | `Utf8DecoderBase` (UTF-8 字串解碼) |
| 4.95% | `Utf8Decoder::Decode` |
| 4.86% | `JsonParser::MakeString` |
| ~4% | GC 相關 (Scavenge, Marking) |

## 相關程式碼位置

### 1. Chokidar Watcher 設定
- **檔案**: `server/index.js`
- **行數**: 103-121
- **問題**: 監控整個 `~/.claude/projects/` 目錄，包括活躍的 session 檔案

### 2. debouncedUpdate 函數
- **檔案**: `server/index.js`
- **行數**: 125-155
- **問題**: 每次檔案變更都會清除 cache 並呼叫 `getProjects()`

### 3. getProjects 函數
- **檔案**: `server/projects.js`
- **行數**: 374-521
- **問題**: 對每個專案執行多個耗時操作

### 4. extractProjectDirectory 函數
- **檔案**: `server/projects.js`
- **行數**: 264-371
- **問題**: 逐行解析所有 JSONL 檔案來找 cwd

### 5. parseJsonlSessions 函數
- **檔案**: `server/projects.js`
- **行數**: 652+
- **問題**: 逐行 JSON.parse() 所有 session 檔案

## 建議修復方案

### 方案 A：忽略 JSONL 檔案變更（最快）

在 chokidar 設定中忽略 `.jsonl` 檔案：

```javascript
// server/index.js line 104
ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.tmp',
    '**/*.swp',
    '**/.DS_Store',
    '**/*.jsonl'  // 新增：忽略 session 檔案
],
```

**優點**: 簡單快速
**缺點**: 新 session 建立時不會即時更新 UI

### 方案 B：只監控目錄結構變更

修改 chokidar 只監控目錄的新增/刪除，不監控檔案內容變更：

```javascript
projectsWatcher
    .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath))
    .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath))
    // 移除 'add', 'change', 'unlink' 事件
```

**優點**: 只在專案新增/刪除時觸發
**缺點**: session 列表不會即時更新

### 方案 C：優化 getProjects() 效能

1. **增量解析**：只解析檔案的最後 N 行來獲取 cwd
2. **更積極的快取**：不要每次都清除 `projectDirectoryCache`
3. **延遲載入**：session 列表改為 lazy load

```javascript
// extractProjectDirectory 優化示例
// 只讀取檔案最後 100 行，而非全部
const lastLines = await readLastNLines(jsonlFile, 100);
for (const line of lastLines) {
    const entry = JSON.parse(line);
    if (entry.cwd) {
        return entry.cwd;
    }
}
```

**優點**: 根本解決效能問題
**缺點**: 需要較多開發時間

### 方案 D：組合方案（推薦）

1. **短期**：實作方案 A，忽略 `.jsonl` 檔案
2. **中期**：實作方案 C 的增量解析
3. **長期**：考慮使用 SQLite 或其他資料庫來快取專案/session 資訊

## 測試方法

修復後，使用以下指令驗證：

```bash
# 重啟服務
sudo systemctl restart claude-code-ui-dev

# 監控 CPU 使用（應該在 1-5% 以下）
top -p $(pgrep -f "server/index.js.*9001")

# 或用 perf 確認沒有大量 JSON 解析
sudo timeout 5 perf record -p $(pgrep -f "server/index.js.*9001") -g
sudo perf report --stdio | head -50
```

## 環境資訊

- **專案數量**: 21 個
- **JSONL 檔案數量**: 4,485 個
- **總行數**: 66,624 行
- **目錄大小**: 253MB (`~/.claude/projects/`)

## 相關 Issue

無（內部發現）

## 優先級

**高** - 持續消耗 CPU 資源，影響系統效能
