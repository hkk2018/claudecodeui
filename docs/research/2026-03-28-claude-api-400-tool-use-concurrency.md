---
title: "Claude API 400 Error - Tool Use Concurrency Issues 調查"
description: "跨介面共用 session 時觸發 tool_use/tool_result 結構損壞導致 API 400 錯誤的成因與對策"
last_modified: "2026-03-28 19:49"
---

# 問題描述

在 Claude Code UI（Web）聊天後，切回 Claude Code for VSCode 繼續同一個 session，會出現：

```
API Error: 400 due to tool use concurrency issues
```

這是 Claude Code 長期已知的 bug，GitHub meta-issue [#6836](https://github.com/anthropics/claude-code/issues/6836) 累積 150+ 回報，截至 2026 年 3 月尚未根本修復。

# 錯誤本質

名稱雖含「concurrency」，但實際上不是並發問題，而是 **conversation history 結構違規**。Anthropic Messages API 嚴格要求：

- 每個 `tool_use` block 必須在緊接的 user message 中有對應的 `tool_result`
- 訊息角色必須嚴格 user / assistant 交替，不允許連續同角色
- 每個 `tool_use` ID 在對話中必須唯一

當送往 API 的對話歷史違反上述任一規則，API 回傳 400 並標記為「tool use concurrency issues」。

# 觸發場景分析

## 場景 1：中斷的 Tool 執行

UI session 正在執行 tool call 時使用者切走，JSONL 對話檔留下沒有 `tool_result` 的孤立 `tool_use`。VSCode resume 該 session 時，從損壞的 JSONL 重建對話，首個訊息即觸發 400。

## 場景 2：Context Compaction 損壞

Compaction 過程中如果對話已有不規則結構（string vs array content 格式混用、metadata 插在同角色訊息之間），壓縮後可能產生連續同角色訊息或孤立 tool_use block。

## 場景 3：Resume 重建失敗

`/resume` 從 JSONL 檔重建 API 對話。如果檔案結構已損壞，重建出的對話本身就是 invalid request。且恢復機制（`/rewind`、`/compact`）也從同一份損壞的 JSONL 重建，因此恢復本身也會失敗。

# 相關 GitHub Issues

| Issue | 說明 | 狀態 |
|-------|------|------|
| [#6836](https://github.com/anthropics/claude-code/issues/6836) | Meta-issue：tool_use/tool_result mismatch，150+ 回報 | Open |
| [#21321](https://github.com/anthropics/claude-code/issues/21321) | 2026-01 大規模 regression，全平台受影響 | Open |
| [#37452](https://github.com/anthropics/claude-code/issues/37452) | Compaction 後對話永久損壞，string vs array content 格式分析 | Open |
| [#39316](https://github.com/anthropics/claude-code/issues/39316) | 丟失 tool_result 後 session 不可恢復，rewind/restore/summarize 全失敗 | Open |
| [#40026](https://github.com/anthropics/claude-code/issues/40026) | 2026-03-27 最新回報，rewind 失敗 | Open |
| [#31328](https://github.com/anthropics/claude-code/issues/31328) | 並行 tool call 時 JSONL writer 丟失 assistant entry 導致 session 無法 resume | Open |

# 根本原因

Claude Code 的對話序列化（JSONL）與重建邏輯**缺乏結構驗證**。寫入 JSONL 時不保證 tool_use/tool_result 配對完整，重建時也不驗證結構正確性就直接送 API。恢復機制從同一份損壞資料重建，形成無法自癒的循環。

# 現有 Workaround

## 預防性措施

| 措施 | 說明 |
|------|------|
| 等 tool 完成再切換 | 確保所有 tool call 完整執行完畢後才切換介面 |
| 不同介面用不同 session | 避免 UI 和 VSCode 共用同一個 session |

## 事後修復

### 方案 A：開新 session（最簡單）

放棄損壞的 session，開新的。如需上下文，手動複製關鍵資訊。

### 方案 B：第三方工具修復 JSONL

```bash
# contextspectre - 自動注入缺失的 tool_result
brew install ppiankov/tap/contextspectre
contextspectre rewire <session-id>          # dry run
contextspectre rewire <session-id> --apply  # 修復

# cozempic - 另一個修復工具
# https://github.com/Ruya-AI/cozempic
cozempic doctor --fix
```

### 方案 C：手動修復 JSONL

Session 檔案位於 `~/.claude/projects/*/conversations/*.jsonl`，找到孤立的 `tool_use` block，手動注入對應的 `tool_result` entry。

# 對本專案的影響評估

Claude Code UI 作為 Web 介面，與 VSCode 共用同一套 session JSONL 檔案。使用者在兩個介面間切換是常見操作，因此這個 bug 的觸發機率相對較高。

**可能的改善方向**（待評估）：

1. **UI 層面**：在切換/離開時，如果有正在執行的 tool call，顯示警告提示使用者等待完成
2. **Session 層面**：resume session 前先驗證 JSONL 結構，自動修復孤立的 tool_use block
3. **文件提示**：在 UI 中加入說明，建議使用者避免跨介面共用 session

以上方向需要進一步評估可行性與實作成本。

# 實測紀錄

## 2026-03-28：跨介面 Resume 行為差異

### 測試背景

在另一個專案（diadosis-docs）中，使用 Claude Code UI 進行開發操作（建立檔案、git commit 等 tool call），之後切換到 Claude Code for VSCode resume 同一個 session。

### 觸發過程

1. Claude Code UI 中完成了一系列操作（Write tool 失敗兩次後改用 Bash 完成、git commit 等）
2. 切換到 **Claude Code for VSCode** resume 該 session
3. 發送 `hi` → 回傳 `API Error: 400 due to tool use concurrency issues`
4. **VSCode 端無法繼續使用該 session**

### 關鍵發現：CLI 可以恢復

5. 改用 **Claude Code CLI**（終端機）resume 同一個 session
6. JSONL 中的錯誤訊息也被 resume 進來（可見到之前的 400 error）
7. 發送 `hi` → **正常回應**，session 恢復可用

### 結論

- **VSCode extension 與 CLI 對 JSONL 的重建邏輯不同**，導致同一份 JSONL 在 VSCode 觸發 400 但 CLI 可以正常恢復
- 這表示問題可能不完全在 JSONL 結構損壞，而是 **VSCode extension 的對話重建較嚴格或有 bug**
- CLI 可能有額外的容錯機制（如自動補齊缺失的 `tool_result`），而 VSCode extension 沒有

### 實用 Workaround

當 VSCode 出現此錯誤時，可以嘗試：
1. 開 terminal 用 `claude --resume` 進入 CLI resume 該 session
2. 在 CLI 中成功發送一則訊息（讓 JSONL 回到合法狀態）
3. 回到 VSCode 再次 resume，可能就能正常使用
