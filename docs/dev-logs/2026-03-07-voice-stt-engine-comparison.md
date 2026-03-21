---
title: "Voice STT 引擎方案比較 - Decision Log"
description: "比較 Moonshine JS、Web Speech API、whisper.cpp server、雲端 STT API 四種方案的架構差異與適用性"
last_modified: "2026-03-07 19:42"
---

# Voice STT 引擎方案比較

## 背景

在 Claude Code UI 整合語音助理功能時，需要選擇 STT（語音轉文字）引擎。經過 Moonshine JS POC 測試後發現其不支援中文，因此進行多方案比較評估。

## 架構差異

### 方案 A：Moonshine JS（Browser-side WASM）

```
[瀏覽器麥克風] → [TEN-VAD (WASM)] → [Moonshine STT (WASM)] → 文字
                  ↑ 全部在瀏覽器內，VAD+STT 綁定不可拆 ↑
```

### 方案 B：Web Speech API（Chrome 內建）

```
[瀏覽器麥克風] → [Chrome 內建 VAD+STT] → (音訊送 Google 雲端) → 文字回傳
                  ↑ 瀏覽器 API，無法控制 audio pipeline ↑
```

### 方案 C：whisper.cpp Server-side（本機已有）

```
[瀏覽器麥克風] → [VAD (瀏覽器)] → [錄音 WAV] → [WebSocket/API 送 server]
                                                      ↓
                                          [server: whisper.cpp STT] → 文字回傳前端
```

### 方案 D：雲端 STT API（Deepgram / Google Cloud / Azure）

```
[瀏覽器麥克風] → [VAD (瀏覽器)] → [錄音] → [WebSocket/API 送 server]
                                                   ↓
                                       [server → 雲端 STT API] → 文字回傳前端
```

## 完整比較表

| 項目 | A: Moonshine JS | B: Web Speech API | C: whisper.cpp server | D: 雲端 STT API |
|------|-----------------|-------------------|----------------------|-----------------|
| **中文支援** | 不支援 | 好 | 很好（small 以上） | 很好 |
| **隱私** | 最強（不出瀏覽器） | 差（送 Google） | 好（自己 server） | 差（送第三方） |
| **跨瀏覽器** | HTTPS + WASM | 只有 Chrome/Edge | 任何瀏覽器 | 任何瀏覽器 |
| **Electron/PWA** | 可以 | 不穩定 | 可以 | 可以 |
| **Audio Pipeline 控制** | 不可拆（VAD+STT 綁定） | 完全不可控 | 完全可控 | 完全可控 |
| **VAD** | 內建（TEN-VAD） | 內建 | 需額外做 | 需額外做或服務內建 |
| **Streaming** | 有（partial updates） | 有限 | 需自己做 | 原生支援 |
| **穩定性/SLA** | 本地，穩定 | 無 SLA，會突斷 | 自己控制 | 有 SLA |
| **模型可調** | 不行 | 不行 | 可以（換模型大小） | 可以（API 參數） |
| **離線** | 可以 | 不行 | 看 server 位置 | 不行 |
| **成本** | 免費 | 免費（有隱藏限制） | 免費（自己跑） | 按分鐘計費 |
| **Server 改動** | 無 | 無 | 中等（加 API） | 中等（加 API） |
| **工程量** | 已完成 | 最小 | 中等 | 中等 |
| **Production 適用** | 英文場景可 | Demo/Prototype | 適合 | 最適合 |
| **模型大小** | ~60MB（瀏覽器下載） | 0（不用下載） | small ~466MB / medium ~1.5GB（已在 server） | 0（雲端） |
| **延遲** | 極低（本地推論） | 中等（網路來回） | CPU ~2-5s / GPU ~0.5-1s | 低（optimized） |

## Web Speech API 工程限制（不適合 Production）

1. **跨瀏覽器差** — 只有 Chrome/Edge，Safari/Firefox 不支援
2. **無法控制模型** — 沒有 custom vocabulary、domain tuning、diarization、timestamps
3. **無 SLA** — Google 沒有公開 SLA，會突然停止或 timeout
4. **無法控制 audio pipeline** — 拿不到完整 audio stream，不能自己做 VAD/noise filtering
5. **Streaming 有限** — AI 產品需要 audio → streaming STT → LLM → streaming response
6. **Electron/Desktop 不穩** — Notion/Slack/Discord 等 Electron app 有時直接壞掉

詳見 Obsidian 筆記：`Frontend/Web Speech API 工程限制分析.md`

## Moonshine JS 定位

- 賣點：完全離線、超低延遲、輕量（60MB）
- 致命弱點：**只支援英文**，VAD+STT 綁定不可拆
- 適合場景：英文環境、對隱私極度敏感、不想依賴雲端

## Decision

對 Claude Code UI 的場景（中文為主、自架 server、隱私重要），**方案 C（whisper.cpp server）最合適**：

- 本機已有編譯好的 whisper.cpp 和下載好的模型（`/home/ubuntu/Projects/ken/linux-dictation/`）
- 中文準確度好（small/medium 模型）
- 隱私有保障（音訊只在自己的 server）
- 不依賴第三方服務
- 跨瀏覽器沒問題

方案 B（Web Speech API）可作為 Debug Monitor 中的快速驗證工具，但不適合當正式方案。

## 相關資源

- Moonshine JS POC：`.claude/worktrees/voice-assistant-poc/`
- 現有 whisper.cpp 環境：`/home/ubuntu/Projects/ken/linux-dictation/`
- 語音框架研究：`docs/research/2026-02-28-voice-assistant-frameworks.md`
