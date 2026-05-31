---
title: "為 dev service 加上 systemd cgroup 資源限制"
description: "Gemini 自動迴圈曾把 CPU 飆到 60% 拖垮畫面，事後加上 OS 層硬限制作為系統性防線"
last_modified: "2026-05-31 16:25"
---

# 為 dev service 加上 systemd cgroup 資源限制

## 背景

`claude-code-ui-dev` (port 9001) 之前發生過 CPU 飆到 60%+ 導致使用者畫面當機的事件。

直接原因是 Gemini 自動分析的輪詢迴圈（已於 commit `d634304` 修掉，現在只在使用者主動觸發時跑）。但這暴露了一個更根本的問題：**這個服務跑在使用者的開發機上，跟所有其他工作（IDE、瀏覽器、終端機）共用 CPU 和記憶體，任何一次 busy-loop 都可能拖垮整台機器**。修一個 bug 不能保證下一個不會再發生。

## 為什麼程式碼層解不掉

最初的直覺是「在程式碼裡加 CPU 監控，超過就自殺」。但這條路走不通：

- 如果程式陷入 busy-loop（單一 thread 滿載），那段負責「監控並自殺」的程式碼**也跑不到**。
- Node.js 是 single-threaded 的，busy-loop 會卡住 event loop，連 `setInterval` 都不會被執行。
- 唯一可靠的監控是另一個 process，但這又把問題複雜化（要管 watchdog 自己的生命週期）。

結論：**程式不可能可靠地限制自己**，要靠**作業系統層級**的強制限制。

## 決策：用 systemd cgroup

dev service 已經用 systemd 在跑，systemd 內建透過 Linux cgroup 對它管的 service 做資源限制，kernel 強制執行，程式無法繞過。這正是要的「不管程式碼裡有什麼 bug，系統都不會壞」。

加進 `[Service]` 區塊的三行：

```ini
CPUQuota=400%
MemoryHigh=900M
MemoryMax=1G
```

## 數字怎麼定

本機 **16 核 CPU**。systemd `CPUQuota` 的算法是 **100% = 1 顆核心**，所以 `400%` = 4 核。

| 選項 | 取捨 |
|------|------|
| 100% (1 核) | 最嚴格，但合理的多執行緒操作（檔案掃描、編譯）可能變慢 |
| 200% (2 核) | 平衡，正常 web UI server 用不到 |
| **400% (4 核)** ✅ | 較寬鬆，容忍短時間較重的操作，仍留 12 核給系統。最終選擇 |

記憶體選 1GB：實測正常運作約 280-500MB，1GB 留充足餘裕；超過時 systemd 只 OOM kill 這個 service，`Restart=always` 自動重啟，不影響系統。

`MemoryHigh=900M` 是軟限制：超過時 kernel 先嘗試回收記憶體並節流 I/O，給程式機會自己降下來，比直接 OOM 平順。

## 套用範圍

**只套用 dev service (9001)**，stable (9002) 不動。

理由：dev 跑的是本地 repo 的最新 code，bug 風險最高；stable 是發行版 npm package，相對穩定，使用者主動選擇保留無限制以便回退。

## 套用結果

```bash
$ systemctl show claude-code-ui-dev -p CPUQuotaPerSecUSec -p MemoryHigh -p MemoryMax
CPUQuotaPerSecUSec=4s    # = 每秒 4 秒 CPU 時間 = 400% = 4 核
MemoryHigh=943718400     # 900MB
MemoryMax=1073741824     # 1GB
```

故障時行為：
- CPU busy-loop → 卡在 400%，其他 14 核不受影響，使用者畫面不會當
- 記憶體洩漏到 1GB → 只殺此 service 並自動重啟

## 順便處理的文檔矛盾

過程中發現 `.claude/CLAUDE.md` 的 systemd unit 範本寫的是 `server/index.js`，但實際 unit 檔執行的是 `dist-server/index.js`（TypeScript 編譯後產物）。已一併修正。

## 未處理但相關

Explore agent 順帶調查了程式碼還有哪些潛在 CPU 熱點。最值得改的是 chokidar 檔案監聽的 `pollInterval: 50ms`（每秒 20 次輪詢），建議調到 200ms。但有了 systemd 硬限制後這已不是急事，留待之後一併處理。

## 跨 session 提醒

systemd unit 檔位於 `/etc/systemd/system/`，**不在 git repo 內**。換機器或重灌時這個防線會消失，需要依 `.claude/CLAUDE.md` 的「資源限制」章節重新建立。
