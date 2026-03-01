---
title: "Open-Source Voice Assistant Frameworks Research"
description: "Comprehensive comparison of voice assistant frameworks supporting wake word detection, STT, LLM integration, and TTS"
last_modified: "2026-03-01 14:47"
---

# Open-Source Voice Assistant Frameworks -- Comprehensive Research

## Research Context

**Date:** 2026-02-28
**Objective:** Find open-source frameworks that provide a complete voice assistant pipeline (wake word → STT → LLM → TTS) with the ability to plug in custom LLM models, suitable for mobile/web integration.

**Key Requirements:**
1. Wake word detection
2. Speech-to-text (STT)
3. Custom LLM backend support (Claude, GPT, local models)
4. Text-to-speech (TTS)
5. Mobile (iOS/Android) or Web support
6. Active maintenance (2025-2026)

---

## Executive Summary

The frameworks fall into three categories:

1. **Full-Pipeline Voice Agent Frameworks** (STT + LLM + TTS, designed for real-time conversation)
2. **Traditional Voice Assistant Platforms** (wake word + STT + intent/LLM + TTS, designed for always-on assistants)
3. **Specialized Components** (wake word only, STT only, etc.)

**Top Recommendations:**
- **For mobile/web apps with custom LLM:** Pipecat + client-side wake word (Porcupine/openWakeWord)
- **For production WebRTC infrastructure:** LiveKit Agents + client-side wake word
- **For always-on assistant (like Alexa):** OVOS (Open Voice OS)
- **For fully on-device:** Picovoice (commercial) or DIY (openWakeWord + whisper.cpp + Ollama + Piper)

---

## Category 1: Full-Pipeline Voice Agent Frameworks

### 1. Pipecat (by Daily.co)

| Attribute | Detail |
|---|---|
| **GitHub** | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) |
| **Stars** | ~10,474 |
| **Language** | Python |
| **Last Update** | 2026-02-27 (very active) |
| **License** | BSD-2-Clause |

**Key Features:**
- Pipeline-based architecture: data flows as "frames" (audio, text, images) through a chain of processors
- Widest ecosystem of AI service integrations among all frameworks
- **STT:** Deepgram, Azure, AWS, AssemblyAI, Whisper, Cartesia, etc.
- **LLM:** Anthropic (Claude), OpenAI, Azure OpenAI, Groq, Mistral, Google Gemini, AWS Bedrock, and any OpenAI-compatible endpoint (e.g., Ollama, local models)
- **TTS:** ElevenLabs, Cartesia, Azure, AWS Polly, PlayHT, LMNT, Piper, etc.
- Smart turn detection to reduce interruptions
- Tool/function calling support
- RAG (knowledge base) support

**Wake Word:** Has a `WakeCheckFilter` that detects wake phrases from transcription text. No native audio-level wake word engine (Porcupine integration is requested but not yet built). The wake check works by monitoring STT transcription output for trigger phrases.

**Mobile/Web Support:** Official client SDKs for **JavaScript, React, React Native (mobile), Swift (iOS), Kotlin (Android), C++, ESP32**. Excellent cross-platform coverage.

**Custom LLM:** ✅ YES -- first-class support. Any OpenAI-compatible API works, plus native plugins for Claude, Gemini, Mistral, Groq, etc.

**Verdict:** Best choice for developers who want the widest provider ecosystem, Python-first development, and the fastest path to production with a custom LLM. The richest plugin/integration ecosystem.

---

### 2. LiveKit Agents

| Attribute | Detail |
|---|---|
| **GitHub** | [livekit/agents](https://github.com/livekit/agents) |
| **Stars** | ~9,456 |
| **Language** | Python (also [agents-js](https://github.com/livekit/agents-js) for Node.js) |
| **Last Update** | 2026-02-27 (very active) |
| **License** | Apache-2.0 |

**Key Features:**
- Session-based architecture: an AI agent joins a WebRTC room as a participant
- Built on LiveKit's WebRTC infrastructure (open-source server)
- **STT:** Deepgram, Azure, Google, AssemblyAI, Fal, local Whisper
- **LLM:** OpenAI, Anthropic, Google, Cerebras, Groq, Ollama, any OpenAI-compatible endpoint
- **TTS:** ElevenLabs, Cartesia, Azure, Google, PlayHT
- Semantic turn detection using a transformer model (superior interruption handling)
- Native MCP (Model Context Protocol) support for tool integration
- Built-in test framework with agent judges
- Telephony integration (SIP)

**Wake Word:** No built-in wake word detection. Designed for session-based interactions where the user explicitly initiates a conversation.

**Mobile/Web Support:** Comprehensive SDK ecosystem: **Browser, iOS/macOS/visionOS, Android, Flutter, React Native, Rust, Node.js, Python, Unity**. The broadest client SDK coverage of any framework.

**Custom LLM:** ✅ YES -- excellent support. Plugin architecture supports any LLM. Ollama for local models, plus all major cloud providers.

**Verdict:** Best choice if you need production-grade WebRTC infrastructure, the cleanest developer API, telephony integration, and the broadest client SDK support. Slightly steeper learning curve than Pipecat but more robust for production.

---

### 3. TEN Framework (by Agora)

| Attribute | Detail |
|---|---|
| **GitHub** | [TEN-framework/ten-framework](https://github.com/TEN-framework/ten-framework) |
| **Stars** | ~10,083 |
| **Language** | Python, C++, Go, Java |
| **Last Update** | 2026-02-27 (very active) |
| **License** | Apache-2.0 with LLVM exception |

**Key Features:**
- Graph-based architecture: extensions are nodes connected via typed messages in JSON
- Extensions can be written in **C++, Go, Python, or Java** and run in the same process
- Visual agent builder (TMAN Designer) for non-developers
- Full-duplex dialogue with turn detection
- Built-in Voice Activity Detection (VAD) with open-sourced ONNX model
- Avatar/lip-sync integrations (Trulience, HeyGen, Tavus) for visual AI characters
- Multi-platform: Linux, macOS, Windows, Android

**Wake Word:** Has built-in VAD. Wake word detection would need to be implemented as a custom extension.

**Mobile/Web Support:** Android native support. Web support via Agora SDK. No official iOS SDK listed, though the Agora ecosystem supports iOS.

**Custom LLM:** ✅ YES -- extension-based architecture allows plugging in any LLM.

**Verdict:** Most flexible and ambitious framework. Best choice if you need multi-language extensions (C++/Go/Python/Java), visual agent building, or avatar experiences. Closely tied to the Agora ecosystem.

---

### 4. Bolna

| Attribute | Detail |
|---|---|
| **GitHub** | [bolna-ai/bolna](https://github.com/bolna-ai/bolna) |
| **Stars** | ~587 |
| **Language** | Python |
| **Last Update** | 2026-02-27 (active) |
| **License** | MIT |

**Key Features:**
- End-to-end orchestration for voice conversations over WebSockets
- **STT:** Deepgram, Azure
- **LLM:** OpenAI, DeepSeek, Llama, Cohere, Mistral
- **TTS:** Multiple providers
- Telephony: Twilio, Plivo, Exotel, Vonage
- Focused on phone call agents and turn-based voice conversations

**Wake Word:** No built-in wake word detection. Designed for telephony/call-based interactions.

**Mobile/Web Support:** Primarily server-side; connects via WebSockets or telephony.

**Custom LLM:** ✅ YES -- supports OpenAI, DeepSeek, Llama, Cohere, Mistral.

**Verdict:** Good for telephony-focused voice agents. Smaller community but actively maintained. Looking for additional maintainers.

---

### 5. Vocode

| Attribute | Detail |
|---|---|
| **GitHub** | [vocodedev/vocode-core](https://github.com/vocodedev/vocode-core) |
| **Stars** | ~3,700 |
| **Language** | Python |
| **Last Update** | 2024-11-15 (⚠️ STALE -- no activity for 15+ months) |
| **License** | MIT |

**Key Features:**
- Modular architecture with Transcribers, Agents, and Synthesizers
- Deploy to phone calls, Zoom meetings, and more
- **STT:** Deepgram, AssemblyAI, Google, Azure, Whisper
- **LLM:** OpenAI, Anthropic, custom
- **TTS:** ElevenLabs, Azure, Google, Rime, PlayHT

**Wake Word:** No built-in wake word detection.

**Mobile/Web Support:** Primarily server-side with WebSocket connections.

**Custom LLM:** ✅ YES -- modular agent architecture supports custom LLM backends.

**Verdict:** ⚠️ WARNING -- appears effectively unmaintained since November 2024. Was a pioneer in the space but has been surpassed by Pipecat and LiveKit. Not recommended for new projects.

---

## Category 2: Traditional Voice Assistant Platforms

### 6. OVOS (Open Voice OS) -- Mycroft successor

| Attribute | Detail |
|---|---|
| **GitHub** | [OpenVoiceOS/ovos-core](https://github.com/OpenVoiceOS/ovos-core) |
| **Stars** | ~267 (spread across many repos in the org) |
| **Language** | Python |
| **Last Update** | 2026-01-19 (active) |
| **License** | Apache-2.0 |

**Key Features:**
- Spiritual successor to Mycroft AI (which shut down)
- Complete voice assistant OS: wake word, STT, intent parsing, skill system, TTS
- Fully modular plugin architecture (LEGO-block style)
- **Wake Word:** openWakeWord, Porcupine, Precise-lite, and others via plugins
- **STT:** Whisper, faster-whisper, Vosk, Google, Azure, ONNX-powered offline models
- **TTS:** Piper, Mimic, Google, Azure, custom ONNX models
- **LLM:** Persona system -- connects any LLM (OpenAI, Ollama, local models) as a fallback when skills can't handle input
- HiveMind satellite architecture for distributed deployment
- Offline-capable with ONNX-powered STT models (new in 2026)
- Multi-language support (including minority languages)

**Wake Word:** ✅ YES -- first-class. Multiple engine choices via plugin system.

**Mobile/Web Support:** Primarily Linux-based (Raspberry Pi, desktop). No native mobile app, but HiveMind allows remote satellite connections.

**Custom LLM:** ✅ YES -- via the Persona system. Can use OpenAI, Ollama, or any solver plugin.

**Verdict:** Best choice if you want a complete, always-on voice assistant (like Alexa/Google Home) that you fully control. Strong for home automation (integrates with Home Assistant). Not designed for mobile apps or real-time voice agents.

---

### 7. Home Assistant Voice (Assist Pipeline)

| Attribute | Detail |
|---|---|
| **GitHub** | [home-assistant/core](https://github.com/home-assistant/core) (part of HA) |
| **Stars** | ~78,000+ (entire HA project) |
| **Language** | Python |
| **Last Update** | Continuously active |
| **License** | Apache-2.0 |

**Key Features:**
- Voice pipeline integrated into Home Assistant smart home platform
- **Wake Word:** openWakeWord, microWakeWord (custom trained)
- **STT:** faster-whisper (local), Whisper, cloud options
- **TTS:** Piper (local), cloud options
- **Intent:** Home Assistant conversation agent
- Wyoming Protocol for external service communication
- Fully local pipeline possible (wake word + STT + intent + TTS all offline)

**Wake Word:** ✅ YES -- openWakeWord and microWakeWord with community-trained models.

**Mobile/Web Support:** Home Assistant mobile apps (iOS/Android) + web interface. Voice PE hardware device.

**Custom LLM:** ⚠️ Limited -- primarily designed for intent-based home automation, not open-ended LLM conversations. Can use OpenAI/Custom conversation agents but that's not the primary use case.

**Verdict:** Best choice if your primary use case is smart home control. The voice pipeline is purpose-built for home automation commands, not general AI conversation.

---

### 8. Rhasspy3

| Attribute | Detail |
|---|---|
| **GitHub** | [rhasspy/rhasspy3](https://github.com/rhasspy/rhasspy3) |
| **Stars** | ~380 |
| **Language** | Python |
| **Last Update** | 2023-12-26 (⚠️ STALE -- no activity for 2+ years) |
| **License** | MIT |

**Key Features:**
- Offline voice assistant toolkit using Wyoming protocol
- Excellent for slot/intent systems for predictable phrases
- Satellite microphones via MQTT
- Tight Home Assistant integration

**Wake Word:** ✅ YES -- via openWakeWord or Porcupine plugins.

**Custom LLM:** ❌ Not designed for LLM integration. Intent/slot-based system.

**Verdict:** ⚠️ Effectively succeeded by OVOS and Home Assistant Voice. The author (synesthesiam) now works on Home Assistant voice. Not recommended for new projects.

---

## Category 3: Specialized Components

### 9. openWakeWord

| Attribute | Detail |
|---|---|
| **GitHub** | [dscripka/openWakeWord](https://github.com/dscripka/openWakeWord) |
| **Stars** | ~1,909 |
| **Language** | Python (Jupyter Notebook) |
| **Last Update** | 2025-12-30 |
| **License** | Apache-2.0 |

**Key Features:**
- Dedicated wake word/phrase detection framework
- Processes 80ms audio frames, returns 0-1 confidence score
- Models trained with 100% synthetic speech (TTS-generated)
- Can run 15-20 models simultaneously on a single Raspberry Pi 3 core
- Custom "verifier" models for speaker adaptation
- False-accept rate < 0.5/hour, false-reject rate < 5%
- Web browser support via ONNX Runtime Web/WASM
- Integrates with OVOS, Home Assistant, Rhasspy

**Browser/Mobile:** Can run in browser via ONNX Runtime WebAssembly. Not a standalone mobile library but the ONNX models are portable.

**Verdict:** Excellent open-source wake word component. Can be integrated into any pipeline. Browser support via WASM is unique.

---

### 10. Porcupine (Picovoice)

| Attribute | Detail |
|---|---|
| **GitHub** | [Picovoice/porcupine](https://github.com/Picovoice/porcupine) |
| **Stars** | ~4,705 |
| **Language** | Python, C, Java, Swift, Kotlin, JS, etc. |
| **Last Update** | 2026-02-13 |
| **License** | Apache-2.0 (code); proprietary models (free tier available) |

**Key Features:**
- On-device wake word detection, 97%+ accuracy
- Cross-platform: Linux, macOS, Windows, iOS, Android, Web (WASM), Raspberry Pi
- Custom wake words trainable in seconds via Picovoice Console
- Free tier available (requires AccessKey)
- Part of the broader Picovoice platform (Leopard STT, Cheetah streaming STT, Rhino intent, Orca TTS, picoLLM)

**Full Picovoice Pipeline:** Picovoice offers a complete on-device pipeline: Porcupine (wake word) → Cheetah/Leopard (STT) → picoLLM (on-device LLM) → Orca (TTS). All run locally. However, picoLLM uses its own quantized models, not arbitrary cloud LLMs.

**Custom LLM:** ⚠️ picoLLM supports quantized open models (Llama, Phi, Gemma, Mistral) running on-device. Does NOT support cloud API LLMs like Claude or GPT-4.

**Verdict:** Best wake word component for cross-platform deployment. Commercial product with free tier. If you need the full Picovoice pipeline, it's all on-device, but you can't use cloud LLMs.

---

### 11. whisper.cpp

| Attribute | Detail |
|---|---|
| **GitHub** | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| **Stars** | ~47,076 |
| **Language** | C++ |
| **Last Update** | 2026-02-27 (very active) |
| **License** | MIT |

**Key Features:**
- C/C++ port of OpenAI Whisper
- Extremely fast inference, runs on CPU (no GPU required)
- Raspberry Pi capable
- Multiple language support
- Can be integrated into any pipeline as the STT component

**Not a framework:** whisper.cpp is a component (STT engine), not a voice assistant framework. It's commonly used as the STT backend within other frameworks.

**Verdict:** Best open-source STT engine for local/on-device deployment. Building block for custom pipelines.

---

### 12. Moonshine Voice (by Moonshine AI / Useful Sensors)

| Attribute | Detail |
|---|---|
| **GitHub** | [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) |
| **Stars** | ~6,328 |
| **Language** | C (core), Python/Swift/Java/JS bindings |
| **Last Update** | 2026-03-01 (very active) |
| **License** | MIT (code + English models); Community License for non-English models (free for <$1M annual revenue) |
| **Founded by** | Pete Warden & Manjunath (TensorFlow 創始成員) |

**What It Does -- 不只是 STT，而是完整的語音工具包：**
- **Microphone Capture** -- 內建音訊輸入處理
- **Voice Activity Detection (VAD)** -- 自動偵測語音開始/結束
- **Speech-to-Text (STT)** -- 核心 ASR 引擎，支援串流
- **Speaker Identification / Diarization** -- 辨識不同說話者
- **Intent Recognition** -- 使用 Gemma-300M sentence-embedding 做語意指令匹配

所有功能都在**裝置端運行**，不需要雲端 API，不需要帳號或 API Key。

**Architecture:**
- **不使用 Mel Spectrogram**：直接處理原始音訊，透過 3 層卷積壓縮 384 倍（Whisper 需要先轉 Mel）
- **RoPE (Rotary Position Embedding)**：支援可變長度輸入
- **無填充訓練**：計算量與音訊長度成正比（Whisper 固定 30 秒窗口）
- **串流 (v2)**：滑動窗口注意力 + encoder caching，後續呼叫只處理新音訊
- **C++ 核心**：使用 OnnxRuntime，跨平台推論

**Model Sizes & Performance:**

| Model | Parameters | WER (OpenASR) | MacBook Pro | Raspberry Pi 5 |
|---|---|---|---|---|
| **Medium Streaming** | 245M | **6.65%** | 107ms | 802ms |
| **Small Streaming** | 123M | 7.84% | 73ms | 527ms |
| **Tiny Streaming** | 34M | 12.00% | 34ms | 237ms |
| **Tiny** | 27M (~26MB) | -- | -- | -- |
| Whisper Large v3 (對比) | 1,550M | 7.44% | 11,286ms | ❌ 無法運行 |

**關鍵數據：Moonshine Medium (245M) 比 Whisper Large v3 (1.5B) 更準確（6.65% vs 7.44% WER），速度快 ~100 倍。**

**Non-English Models:**
- 支援：Arabic, Japanese, Korean, Spanish, Ukrainian, Vietnamese, Chinese (Mandarin)
- Tiny 模型錯誤率比同大小 Whisper Tiny 低 **48%**，多數語言可匹敵 Whisper Medium（28 倍大）

**Platform Support (CPU-only, 不需 GPU):**

| Platform | 安裝方式 |
|---|---|
| Python | `pip install moonshine-voice` |
| iOS | Swift Package Manager |
| Android | Maven |
| macOS/Windows/Linux | pip / native |
| Raspberry Pi | pip (tested on Pi 5) |
| Web | [moonshine-js](https://github.com/moonshine-ai/moonshine-js) |
| IoT / Wearables | C++ core |

**LLM Integration:**
- 不直接整合 LLM，但設計為 LLM 語音代理的**前端元件**
- IntentRecognizer 使用 Gemma-300M 做語意匹配，不需要 LLM 也能做指令辨識
- 串流輸出（`LineTextChanged`, `LineCompleted` 事件）適合直接 pipe 到 LLM
- 低延遲（34-107ms）讓語音代理管道幾乎無感延遲

**Moonshine vs Whisper/whisper.cpp:**

| Feature | Moonshine | Whisper / whisper.cpp |
|---|---|---|
| 輸入處理 | 原始音訊，可變長度 | 固定 30 秒 Mel spectrogram |
| 計算量 | 與音訊長度成正比 | 每 30 秒固定成本 |
| 串流 | 原生支援，encoder caching | 非原生（需 hack） |
| 速度 (10s audio) | 5-15x 快 | 基準 |
| 內建 VAD | ✅ Yes | ❌ No（需外部 Silero VAD） |
| Speaker ID | ✅ Yes | ❌ No |
| Intent Recognition | ✅ Yes (Gemma-300M) | ❌ No |
| 多語言 | 8 語言（個別模型） | 99 語言（單一模型） |
| GPU 需求 | ❌ 不需要 (CPU-only) | 大模型建議使用 |

**Unique Selling Points:**
1. 100x faster than Whisper Large v3 on MacBook，且更準確
2. 在 Raspberry Pi 5 上即時運行（Tiny 237ms）
3. 一個 library 包含完整 pipeline（VAD + STT + Speaker ID + Intent）
4. CPU-only，無 GPU 依賴
5. 真正的串流：說話時就開始處理，有 partial text updates
6. 隱私優先：所有處理在裝置端，無雲端

**Research Papers:**
1. [Moonshine: Speech Recognition for Live Transcription and Voice Commands](https://arxiv.org/abs/2410.15608) (Oct 2024)
2. [Flavors of Moonshine: Tiny Specialized ASR Models for Edge Devices](https://arxiv.org/html/2509.02523v1) (Sep 2025)
3. [Moonshine v2: Ergodic Streaming Encoder ASR](https://arxiv.org/abs/2602.12241) (Feb 2026)

**Verdict:** 目前最強的邊緣裝置 STT 方案。比 whisper.cpp 更完整（內建 VAD + Speaker ID + Intent），比 Whisper 更快更準（在更小的模型下）。弱點是語言數量（8 vs 99）。適合作為語音代理管道中的 STT + VAD 元件，搭配 Pipecat 或 LiveKit 使用。

---

## Summary Comparison Table

| Framework | Stars | Wake Word | Custom LLM | Full Pipeline | Mobile/Web SDKs | Active (2026) | Best For |
|---|---|---|---|---|---|---|---|
| **Pipecat** | 10.5k | Partial (text-based filter) | ✅ YES (any) | STT+LLM+TTS | JS, React, RN, Swift, Kotlin | ✅ YES | Voice agents, widest integrations |
| **LiveKit Agents** | 9.5k | ❌ No | ✅ YES (any) | STT+LLM+TTS | Browser, iOS, Android, Flutter, RN, Unity | ✅ YES | Production WebRTC voice agents |
| **TEN Framework** | 10.1k | VAD only | ✅ YES (via extensions) | STT+LLM+TTS | Android, Web (Agora) | ✅ YES | Multi-language, visual builder, avatars |
| **Bolna** | 587 | ❌ No | ✅ YES | STT+LLM+TTS | Server-side (WebSocket/telephony) | ✅ YES | Telephony voice agents |
| **Vocode** | 3.7k | ❌ No | ✅ YES | STT+LLM+TTS | Server-side | ⚠️ NO (stale) | Not recommended |
| **OVOS** | 267+ | ✅ YES (native) | ✅ YES (Persona) | Wake+STT+LLM+TTS | Linux only | ✅ YES | Always-on assistant, home automation |
| **Home Assistant Voice** | 78k+ | ✅ YES (native) | ⚠️ Limited | Wake+STT+Intent+TTS | iOS, Android, Web | ✅ YES | Smart home control |
| **Rhasspy3** | 380 | ✅ YES | ❌ No | Wake+STT+Intent+TTS | Web UI | ⚠️ NO (stale) | Not recommended |
| **openWakeWord** | 1.9k | ✅ YES (dedicated) | N/A (component) | Wake only | Browser (WASM) | ⚠️ Moderate | Wake word component |
| **Porcupine** | 4.7k | ✅ YES (dedicated) | N/A (component) | Wake only | All platforms | ✅ YES | Wake word component, cross-platform |
| **Picovoice (full)** | 685 | ✅ YES | On-device only | Full on-device | All platforms | ✅ YES | Fully on-device pipeline |
| **whisper.cpp** | 47k | N/A (STT only) | N/A (component) | STT only | Via bindings | ✅ YES | STT component |
| **Moonshine Voice** | 6.3k | ✅ YES (VAD) | N/A (component) | VAD+STT+Intent | Python, iOS, Android, Web | ✅ YES | Edge STT, fastest ASR |

---

## Recommendations by Use Case

### Use Case 1: Full pipeline (wake word → STT → LLM → TTS) with custom LLM, running as mobile/web app

**Best choice: Pipecat + openWakeWord/Porcupine on the client side**

Pipecat has the widest LLM integration (Claude, GPT, Ollama, etc.), official mobile SDKs (React Native, Swift, Kotlin), and an active community. For wake word, add openWakeWord (WASM in browser) or Porcupine (native SDKs for all platforms) on the client side, then hand off to Pipecat for the conversation pipeline.

**Runner-up: LiveKit Agents + client-side wake word**

LiveKit has even broader client SDKs (Flutter, Unity included) and superior production infrastructure, but requires running a LiveKit server.

---

### Use Case 2: Always-on voice assistant like Alexa, fully open source

**Best choice: OVOS (Open Voice OS)**

OVOS is the only framework that provides the complete always-on assistant experience: wake word detection, STT, intent/skill system, LLM fallback via Persona, and TTS -- all configurable and privacy-respecting. Pair it with Home Assistant for smart home control.

---

### Use Case 3: Everything running on-device with no cloud

**Best choice: Picovoice (commercial) or DIY with openWakeWord + whisper.cpp + Ollama + Piper**

Picovoice offers the smoothest on-device experience but limits you to their supported models. The DIY approach gives full control but requires more integration work. A 12GB GPU can run Whisper turbo INT8 + 8B LLM + Piper TTS with ~1 second latency.

---

### Use Case 4: Voice AI phone agent

**Best choice: LiveKit Agents or Bolna**

Both have native telephony/SIP integration. LiveKit is more mature; Bolna is simpler but smaller community.

---

## Integration Architecture for Claude Code UI

Given that Claude Code UI is a web application, the most feasible architecture is:

```
Mobile/Desktop Browser
  ├── openWakeWord (WASM) or Porcupine (JS SDK) — Local wake word detection
  ├── Upon wake word detection, initiate WebSocket/WebRTC connection
  └── Connect to Pipecat or LiveKit backend
        ├── STT (Deepgram / Whisper)
        ├── LLM (Claude API)
        └── TTS (ElevenLabs / Cartesia)
```

**Recommended Stack:**
- **Client:** openWakeWord (WASM) 或 **Moonshine Voice (JS/WASM)** for wake word detection + STT in browser
- **Backend:** Pipecat with Claude API integration
- **Communication:** WebSocket or WebRTC (via Daily.co for Pipecat)
- **STT:** Deepgram (best latency) or **Moonshine Voice** (open source, on-device, 比 Whisper 快 100x) or Whisper (open source)
- **TTS:** Cartesia or ElevenLabs (best quality)

**Alternative Stack (Moonshine-centric, 最大隱私):**
- **Client:** Moonshine Voice JS (VAD + STT 全在瀏覽器端) → 只傳文字到後端
- **Backend:** 直接呼叫 Claude API（不需要 Pipecat，因為 STT 已在客戶端完成）
- **TTS:** 瀏覽器端 Web Speech API 或 Piper WASM
- **優點:** STT 不經過雲端，延遲更低，隱私更好
- **缺點:** 客戶端計算負擔較重，手機電池消耗較多

---

## Technical Considerations

### Latency Budget

For a smooth voice conversation experience:
- Wake word detection: < 100ms
- STT: 100-300ms (streaming)
- LLM: 500-2000ms (depends on model)
- TTS: 200-500ms (streaming)
- Network latency: 50-200ms

**Total round-trip:** 1-3 seconds is acceptable; < 1 second is excellent.

### Browser Compatibility

- **openWakeWord (WASM):** Requires Web Audio API and ONNX Runtime Web. Works in modern Chrome, Firefox, Safari.
- **Porcupine (JS SDK):** Requires WebAssembly. Works in all modern browsers.
- **WebRTC:** Universally supported in modern browsers.

### Privacy Considerations

- **Wake word detection:** Can run 100% client-side (openWakeWord WASM / Porcupine)
- **STT/LLM/TTS:** Requires cloud services unless using local models (whisper.cpp + Ollama + Piper)
- **Hybrid approach:** Wake word + VAD on client, send only speech segments to cloud

---

## Cost Analysis (Approximate)

### Cloud-based Pipeline (Pipecat + Cloud Services)

Per 1000 voice interactions (avg 30 seconds each):
- STT (Deepgram): $0.0043/min × 500 min = **$2.15**
- LLM (Claude Sonnet): ~500 tokens in/out × 1000 = **$7.50**
- TTS (Cartesia): $0.025/1000 chars × 50k chars = **$1.25**
- **Total:** ~$11/1000 interactions

### On-device Pipeline (whisper.cpp + Ollama + Piper)

- Hardware: One-time GPU cost (~$500 for RTX 4060)
- Running cost: Electricity only (~$0.10/hour)
- **Total:** Essentially free after hardware investment

---

## Next Steps for Integration

1. **Proof of Concept:**
   - Set up openWakeWord WASM demo in browser
   - Test Pipecat with Claude API in Python backend
   - Connect browser to Pipecat via WebSocket/Daily.co

2. **Production Considerations:**
   - Implement proper error handling and reconnection logic
   - Add visual feedback for wake word detection, listening state
   - Optimize audio pipeline for mobile browsers (iOS Safari quirks)
   - Add push-to-talk as fallback if wake word fails

3. **Security:**
   - Implement authentication for Pipecat backend
   - Rate limiting to prevent abuse
   - Audio data encryption in transit

---

## References

- [Pipecat GitHub](https://github.com/pipecat-ai/pipecat)
- [Pipecat WakeCheckFilter Documentation](https://docs.pipecat.ai/server/utilities/filters/wake-check-filter)
- [LiveKit Agents GitHub](https://github.com/livekit/agents)
- [LiveKit Agents Documentation](https://docs.livekit.io/agents/)
- [TEN Framework GitHub](https://github.com/TEN-framework/ten-framework)
- [Bolna GitHub](https://github.com/bolna-ai/bolna)
- [Vocode Core GitHub](https://github.com/vocodedev/vocode-core)
- [OVOS Core GitHub](https://github.com/OpenVoiceOS/ovos-core)
- [OVOS Blog - Speechday 2026](https://blog.openvoiceos.org/posts/2026-02-05-OpenVoiceOS-Speechday-2026)
- [OVOS + Home Assistant Dream Team](https://blog.openvoiceos.org/posts/2025-09-17-ovos_ha_dream_team)
- [openWakeWord GitHub](https://github.com/dscripka/openWakeWord)
- [Open Wake Word on the Web - Deep Core Labs](https://deepcorelabs.com/open-wake-word-on-the-web/)
- [Porcupine GitHub](https://github.com/Picovoice/porcupine)
- [Picovoice GitHub](https://github.com/Picovoice/picovoice)
- [Picovoice 2025 Year in Review](https://picovoice.ai/blog/year-in-review/)
- [whisper.cpp GitHub](https://github.com/ggml-org/whisper.cpp)
- [Rhasspy3 GitHub](https://github.com/rhasspy/rhasspy3)
- [Home Assistant Voice Control](https://www.home-assistant.io/voice_control/about_wake_word/)
- [RealTime AI Agents frameworks comparison - Medium](https://medium.com/@ggarciabernardo/realtime-ai-agents-frameworks-bb466ccb2a09)
- [RoomKit, Pipecat, TEN Framework, LiveKit Agents comparison](https://dev.to/quintana/roomkit-pipecat-ten-framework-livekit-agents-choosing-the-right-conversational-ai-framework-2h80)
- [Top Voice AI Agent Frameworks in 2026 - Medium](https://medium.com/@mahadise0011/top-voice-ai-agent-frameworks-in-2026-a-complete-guide-for-developers-4349d49dbd2b)
- [6 best orchestration tools to build AI voice agents in 2026 - AssemblyAI](https://www.assemblyai.com/blog/orchestration-tools-ai-voice-agents)
- [Building a Fully Local LLM Voice Assistant - Towards AI](https://pub.towardsai.net/building-a-fully-local-llm-voice-assistant-a-practical-architecture-guide-6a506aee6020)
- [Best open source STT model 2026 benchmarks - Northflank](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [Nimble Pipecat - GitHub](https://github.com/daily-co/nimble-pipecat)
- [Ask HN: Current best local speech-to-speech setup](https://news.ycombinator.com/item?id=46731068)
- [Moonshine Voice GitHub](https://github.com/moonshine-ai/moonshine)
- [Moonshine JS GitHub](https://github.com/moonshine-ai/moonshine-js)
- [Pete Warden: Announcing Moonshine Voice](https://petewarden.com/2026/02/13/announcing-moonshine-voice/)
- [HuggingFace Blog: Announcing Moonshine Voice](https://huggingface.co/blog/UsefulSensors/announcing-moonshine-voice)
- [arXiv: Moonshine v1 Paper](https://arxiv.org/abs/2410.15608)
- [arXiv: Moonshine v2 Paper](https://arxiv.org/abs/2602.12241)
- [arXiv: Flavors of Moonshine (Non-English)](https://arxiv.org/html/2509.02523v1)
- [EE Times: Pete Warden on Speech-to-Intent](https://www.eetimes.com/pete-warden-speech-to-intent-is-the-missing-piece-for-ai-agents/)

---

## Conclusion

For integrating voice assistant capabilities into Claude Code UI, **Pipecat** emerges as the most practical choice due to its:
- Native Claude API support
- Comprehensive JavaScript/React SDKs
- Active development and community
- Widest provider ecosystem

Combined with **openWakeWord (WASM)** for browser-based wake word detection, this stack provides a complete, production-ready voice assistant pipeline that can be integrated into the existing web application with minimal infrastructure overhead.

The main trade-off is that audio-level wake word detection requires client-side integration, but this is actually beneficial for privacy and reduces server load.

**2026-03-01 更新：** **Moonshine Voice** 提供了另一個極具競爭力的選項。它在瀏覽器端即可完成 VAD + STT（透過 moonshine-js），比 Whisper 快 100 倍且更準確，完全不需要雲端 STT 服務。如果追求最大隱私和最低延遲，可以考慮 Moonshine-centric 架構：客戶端完成所有語音處理，只將文字傳送到 Claude API。
