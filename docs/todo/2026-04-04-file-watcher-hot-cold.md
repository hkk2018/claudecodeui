---
title: "File Watcher 冷熱機制重構"
description: "將 chokidar 全目錄監控改為 Hot/Cold session 分級監控"
last_modified: "2026-04-04 22:52"
---

# File Watcher 冷熱機制重構

## 背景

目前用 chokidar 監控整個 `~/.claude/projects/` 目錄（42+ 專案），每次任何 JSONL 寫入都觸發事件。隨專案增多效能會持續惡化。

## 目標架構

### 三層機制

| 層級 | 機制 | 負責 | 延遲 |
|------|------|------|------|
| 即時事件 | `~/.claude/settings.json` hooks（Stop、Notification 等） | 音效、通知、卡片狀態 | ~0ms |
| 即時串流 | `fs.watch` 個別 Hot session 的 JSONL | ChatInterface 即時更新 | ~10ms |
| 背景掃描 | 每分鐘掃一次 session metadata | 發現新 Hot session、Cold 降級 | ~60s |

### Hot/Cold 判定

- **Hot**：24 小時內有活動的 session → 個別 `fs.watch` 該 JSONL 檔案
- **Cold**：超過 24 小時沒活動 → 不監控，靠背景掃描或使用者打開時才載入

### 流程

```
每分鐘掃一次所有 session metadata
  → lastModified 在 24h 內 → 標記 Hot → fs.watch 個別 JSONL
  → 超過 24h → 標記 Cold → 停止 watch（如有）
```

## 預期效果

- 從監控幾百個檔案 → 只 watch 3-5 個 Hot session
- 移除 chokidar 依賴，改用原生 `fs.watch`
- 搭配 hooks 機制，離散事件不再依賴 file watcher

## 前置條件

- [x] 研究 hooks vs file watcher 差異
- [x] 確認 SDK hooks 是 per-query，settings.json hooks 是全域
- [ ] 實作 Stop hook 自動安裝（本次任務）
- [ ] 實作冷熱機制
- [ ] 移除 chokidar，改用 fs.watch
