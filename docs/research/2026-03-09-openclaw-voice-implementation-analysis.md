---
title: "OpenClaw Voice 實作架構分析"
description: "深入分析 openclaw-voice 的語音溝通功能實作，作為 Claude Code UI 語音功能的參考"
last_modified: "2026-03-09 00:42"
---

# OpenClaw Voice 實作架構分析

## 研究背景

**Date:** 2026-03-09
**Objective:** 分析 [openclaw-voice](https://github.com/Purple-Horizons/openclaw-voice) 的語音溝通功能實作細節，作為 Claude Code UI 整合類似功能的參考。

**相關研究：** [Voice Assistant Frameworks Research](./2026-02-28-voice-assistant-frameworks.md) — 完整的框架比較

---

# OpenClaw 平台概覽

[OpenClaw](https://github.com/openclaw/openclaw) 是開源個人 AI 助手平台，本地運行，作為 LLM（Claude、GPT 等）與日常溝通管道（WhatsApp、Telegram、Slack 等）之間的通用閘道。MIT 授權，local-first 設計。

**語音相關元件：**

| Repo | 說明 |
|------|------|
| `openclaw/openclaw` | 主平台，內建 Voice Wake + Talk Mode |
| `Purple-Horizons/openclaw-voice` | 獨立的瀏覽器語音介面，可搭配任何 AI 後端 |
| `yuga-hashimoto/openclaw-assistant` | Android 語音助手 App |

本文聚焦在 **openclaw-voice**，因為它的架構最適合我們的 Web 場景。

---

# 整體架構

```
Browser (mic input)
    │  PCM Float32 16kHz → base64 → JSON
    ↓  WebSocket
┌──────────────────────────────────────────┐
│  Voice Server (Python / FastAPI)          │
│                                          │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Silero   │  │ Whisper  │  │ AI      │ │
│  │ VAD      │  │ STT      │  │ Backend │ │
│  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │              │              │      │
│       │              │         ┌────┴────┐ │
│       │              │         │ TTS     │ │
│       │              │         │ Engine  │ │
│       │              │         └────┬────┘ │
└───────┴──────────────┴──────────────┴──────┘
                                      │
    PCM 24kHz → base64 → JSON         │
    ↓  WebSocket                       │
Browser (audio playback via AudioContext)
```

---

# WebSocket 訊息協議

## Client → Server

| type | payload | 說明 |
|------|---------|------|
| `start_listening` | — | 開始錄音 session |
| `audio` | `{ data: base64 }` | 串流音訊 chunk (PCM Float32, 16kHz) |
| `stop_listening` | — | 停止錄音，觸發 STT → LLM → TTS pipeline |
| `ping` | — | 心跳保持連線 |

## Server → Client

| type | payload | 說明 |
|------|---------|------|
| `listening_started` | — | 確認開始監聽 |
| `listening_stopped` | — | 確認停止監聽 |
| `vad_status` | `{ speech_detected: bool }` | 即時語音活動偵測 |
| `transcript` | `{ text, final: true }` | STT 轉錄結果 |
| `response_chunk` | `{ text }` | AI 回應的 token 串流（用於文字顯示） |
| `audio_chunk` | `{ data: base64, sample_rate: 24000 }` | TTS 音訊串流（逐句） |
| `response_complete` | `{ text }` | 完整回應結束 |

---

# 低延遲關鍵設計：逐句 TTS

這是 openclaw-voice 最核心的設計，能將使用者感知延遲降低約 50%。

## 傳統做法（高延遲）

```
用戶說話 → STT → 等待完整 LLM 回應 → 整段 TTS → 播放
                                        ^^^^^^^^^^^
                            這裡要等所有 token 生成完才開始合成
```

## openclaw-voice 做法（串流逐句）

```
用戶說話 → STT → LLM token 串流 → 偵測句子邊界 → 立即合成該句 → 串流播放
                                                ↑
                              第一句完成就開始 TTS，不等後面的句子
```

### 實作方式

```python
# main.py — 核心邏輯
sentence_buffer = ""

async for chunk in backend.chat_stream(transcript):
    full_response += chunk
    sentence_buffer += chunk

    # 送出 token 給前端顯示
    await websocket.send_json({"type": "response_chunk", "text": chunk})

    # 偵測句子邊界（句號、驚嘆號、問號 + 空格或換行）
    while any(sep in sentence_buffer for sep in ['. ', '! ', '? ', '.\n', '!\n', '?\n']):
        # 找到最早的句子邊界
        earliest_idx = len(sentence_buffer)
        for sep in ['. ', '! ', '? ', '.\n', '!\n', '?\n']:
            idx = sentence_buffer.find(sep)
            if idx != -1 and idx < earliest_idx:
                earliest_idx = idx + len(sep)

        sentence = sentence_buffer[:earliest_idx].strip()
        sentence_buffer = sentence_buffer[earliest_idx:]

        if sentence:
            speech_text = clean_for_speech(sentence)  # 清除 markdown 等
            if speech_text:
                # 立即合成並串流送出
                async for audio_chunk in tts.synthesize_stream(speech_text):
                    audio_b64 = base64.b64encode(audio_chunk).decode()
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "data": audio_b64,
                        "sample_rate": 24000,
                    })

# 處理最後殘留文字
if sentence_buffer.strip():
    # ... 同樣合成並送出
```

**重點：**
- 句子邊界用 `. ` / `! ` / `? ` 偵測（含後方空格，避免數字小數點誤判）
- `clean_for_speech()` 清除 markdown 格式，讓 TTS 只唸純文字
- 每句完成就立即開始 TTS，不等後面的內容

---

# 各模組實作細節

## STT 模組 (`stt.py`)

**優先順序：**
1. **faster-whisper**（優先）— 本地推論，支援 GPU/CPU
2. **openai-whisper**（備選）— OpenAI 官方實作
3. **Mock mode**（無可用引擎時）

**關鍵設計：**
- 用 `asyncio.run_in_executor()` 把同步的 Whisper 推論放到 thread pool，不阻塞事件循環
- faster-whisper 使用 `vad_filter=True`，內建 Silero VAD 過濾無聲段落
- 自動偵測硬體：CUDA → MPS → CPU，對應使用 float16 / int8 精度

```python
# 裝置自動偵測
if torch.cuda.is_available():
    device, compute_type = "cuda", "float16"
elif torch.backends.mps.is_available():
    device, compute_type = "cpu", "int8"  # MPS fallback to CPU
else:
    device, compute_type = "cpu", "int8"
```

**可選模型：** tiny / base / small / medium / large-v3-turbo

---

## TTS 模組 (`tts.py`)

**優先順序：**
1. **ElevenLabs**（雲端，最高品質）— `eleven_turbo_v2_5` 模型，~500ms 延遲
2. **Chatterbox**（自架）— 支援語音克隆
3. **XTTS-v2 (Coqui)**（自架）— 多語言
4. **Mock mode**（靜音）

**串流 TTS 設計（ElevenLabs）：**

```python
async def synthesize_stream(self, text: str) -> AsyncGenerator[bytes, None]:
    if self._backend == "elevenlabs":
        audio_generator = self._elevenlabs_client.text_to_speech.convert(
            voice_id=self.voice_id,
            text=text,
            model_id="eleven_turbo_v2_5",   # 最快模型
            output_format="pcm_24000",       # 24kHz PCM
        )
        for chunk in audio_generator:
            yield chunk  # 邊合成邊回傳
    else:
        audio = await self.synthesize(text)  # 非串流 fallback
        yield audio.tobytes()
```

**音訊格式：**
- ElevenLabs 輸出：PCM 24kHz, 16-bit
- 內部處理轉為 Float32 [-1, 1]

---

## AI Backend 模組 (`backend.py`)

**支援的後端：**
- **OpenAI-compatible API**（包括 Claude via proxy、Ollama 等）
- **OpenClaw Gateway**（自動偵測 `OPENCLAW_GATEWAY_URL` + `OPENCLAW_GATEWAY_TOKEN`）

**關鍵設計：**
- 使用 `AsyncOpenAI` 做非同步串流
- 保留最近 10 輪對話歷史（`conversation_history[-10:]`）
- System prompt 針對語音場景優化：簡短對話式回應，不要 markdown/code blocks

```python
system_prompt = (
    "This conversation is happening via real-time voice chat. "
    "Keep responses concise and conversational — a few sentences "
    "at most unless the topic genuinely needs depth. "
    "No markdown, bullet points, code blocks, or special formatting."
)
```

**串流回應：**

```python
async def chat_stream(self, user_message: str) -> AsyncGenerator[str, None]:
    stream = await self._client.chat.completions.create(
        model=self.model,
        messages=messages,
        max_tokens=500,
        temperature=0.7,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

---

## 前端 React Widget (`packages/react/`)

提供可嵌入的 `<VoiceWidget>` React 元件。

### 音訊擷取

```typescript
// 使用 ScriptProcessorNode 擷取 mic 音訊
const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1 }
});
const processor = audioContext.createScriptProcessor(4096, 1, 1);

processor.onaudioprocess = (e) => {
    const audioData = e.inputBuffer.getChannelData(0);  // Float32Array
    const base64 = btoa(String.fromCharCode(...new Uint8Array(audioData.buffer)));
    ws.send(JSON.stringify({ type: 'audio', data: base64 }));
};
```

### 音訊播放

```typescript
const playAudio = (base64Data: string, sampleRate: number) => {
    const audioCtx = new AudioContext({ sampleRate });
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const audioData = new Float32Array(bytes.buffer);

    const buffer = audioCtx.createBuffer(1, audioData.length, sampleRate);
    buffer.getChannelData(0).set(audioData);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
};
```

### 互動模式

| 模式 | 操作方式 |
|------|---------|
| **Push-to-talk**（預設） | 按住按鈕說話，放開觸發 STT |
| **Continuous mode** | 點擊切換，AI 回應結束後自動重新監聽 |

---

# Tech Stack 摘要

| 層級 | 技術 | 說明 |
|------|------|------|
| **Server** | Python + FastAPI + Uvicorn | 非同步 WebSocket 服務 |
| **STT** | faster-whisper / openai-whisper | 本地推論，支援 GPU |
| **TTS** | ElevenLabs / Chatterbox / XTTS | 雲端或本地 |
| **AI** | OpenAI-compatible API (AsyncOpenAI) | 串流回應 |
| **VAD** | Silero VAD | 語音活動偵測 |
| **Frontend** | React + TypeScript | 可嵌入 widget |
| **通訊** | WebSocket (JSON + base64 audio) | 雙向串流 |
| **音訊格式** | Input: PCM Float32 16kHz / Output: PCM 24kHz | — |
| **容器化** | Docker + docker-compose | 可選 |
| **Auth** | API Key (optional) + rate limiting | 多 tier 定價 |

---

# 與 Claude Code UI 整合的參考價值

## 可直接借鏡的設計

1. **逐句 TTS 串流** — 句子邊界偵測 + 即時合成，體驗差異巨大
2. **WebSocket 訊息協議** — JSON + base64 audio，簡潔明確
3. **VAD 即時回饋** — 讓使用者知道系統有偵測到聲音
4. **對話式 system prompt** — 語音場景需要不同的 LLM 指令

## 需要調整的部分

| openclaw-voice 做法 | Claude Code UI 考量 |
|---------------------|---------------------|
| Python FastAPI 獨立服務 | 我們是 Node.js server，需整合到現有 Express/WS |
| ScriptProcessorNode（已棄用） | 應改用 AudioWorklet（現代 API） |
| base64 JSON 傳輸音訊 | 大量音訊資料可考慮 binary WebSocket frame |
| 單一 WebSocket 連線 | 可復用現有 session WebSocket |
| ElevenLabs 作為主要 TTS | 需評估成本，可考慮 Cartesia 或瀏覽器端 TTS |

## 建議整合方案

### 方案 A：最小化 — 瀏覽器端 STT + 現有架構

```
Browser
├── Web Speech API 或 Moonshine.js (STT)
├── 文字經現有 WebSocket 送出
├── Claude API 回應串流回來
└── Web Speech API (TTS) 或 ElevenLabs
```

- 優點：不需要改 server，利用瀏覽器原生能力
- 缺點：Web Speech API 品質不穩定，跨瀏覽器差異大

### 方案 B：仿照 openclaw-voice — 在 Node.js server 加語音端點

```
Browser (mic) → WebSocket /voice/ws → Node.js server
                                       ├── 呼叫 Whisper API (STT)
                                       ├── 呼叫 Claude API (LLM streaming)
                                       └── 呼叫 ElevenLabs API (TTS streaming)
                                       → WebSocket audio chunks → Browser
```

- 優點：品質穩定，server 端控制整個 pipeline
- 缺點：增加 server 負擔，需要額外 API 費用

### 方案 C：混合 — 瀏覽器 STT + Server TTS

```
Browser
├── Moonshine.js 或 Whisper WASM (本地 STT)
├── 文字經 WebSocket 送到 server
├── Server 呼叫 Claude API → 串流回應
├── Server 逐句呼叫 TTS API → 串流音訊回 browser
└── Browser AudioContext 播放
```

- 優點：STT 零延遲（本地），TTS 品質好（雲端）
- 缺點：需要整合兩端

---

# 參考連結

- [openclaw-voice GitHub](https://github.com/Purple-Horizons/openclaw-voice)
- [openclaw 主平台](https://github.com/openclaw/openclaw)
- [openclaw-voice 官網](https://openclawvoice.com/)
- [openclaw-assistant (Android)](https://github.com/yuga-hashimoto/openclaw-assistant)
- [OpenClaw 語音方向討論 #1655](https://github.com/openclaw/openclaw/discussions/1655) — 提議轉向 Realtime Speech API（Gemini Live, OpenAI Realtime）
