---
title: "Claude Agent SDK 訊息架構分析"
description: "分析 SDK 原生資料結構 vs Server/Frontend 各層加工，為後續 Debug Monitor 開發建立基礎"
last_modified: "2026-02-17 20:59"
---

# Claude Agent SDK 訊息架構分析

## 背景

為了更熟悉整個系統的資料流向，分析 Claude Agent SDK 原生提供的資料結構，以及 Server 層和 Frontend 層各自加工了什麼。後續計畫在 Debug Monitor 中以視覺化方式呈現這些資訊。

## SDK 套件資訊

- **Package**: `@anthropic-ai/claude-agent-sdk` v^0.1.29
- **Import**: `import { query } from '@anthropic-ai/claude-agent-sdk'`
- **呼叫方式**: async generator（`for await (const message of queryInstance)`）

---

# 三層資料流架構

```
Claude Agent SDK (原生 SDKMessage)
    ↓  async generator yield
Server 層 (server/claude-sdk.js)
    ↓  WebSocket JSON 訊息
Frontend 層 (src/components/ChatInterface.jsx)
    ↓  轉換成 UI 狀態物件
React 渲染
```

---

# 第一層：SDK 原生

## SDK 訊息類型

| SDK type | 說明 | 原生欄位 |
|----------|------|---------|
| `assistant` | Claude 回覆 | `message`（含 `content[]`）, `uuid`, `session_id`, `parent_tool_use_id` |
| `user` | 使用者訊息 | `message`, `session_id` |
| `result` | 完成結果 | `subtype`, `duration_ms`, `usage`, `modelUsage`, `permission_denials` |
| `system` | 系統初始化 | `subtype:'init'`, `session_id`, `tools`, `mcp_servers`, `model` |
| `stream_event` | 串流事件 | `event` (RawMessageStreamEvent), `uuid`, `session_id` |

## SDK content 部件（assistant message 的 content[]）

| part.type | 原生欄位 | 說明 |
|-----------|---------|------|
| `text` | `text` | 文字內容 |
| `tool_use` | `name`, `id`, `input` | 工具呼叫（name=工具名稱, id=唯一ID, input=參數物件）|
| `tool_result` | `tool_use_id`, `content`, `is_error` | 工具執行結果 |

## SDK 權限回呼（canUseTool）

```javascript
// SDK 提供的 callback 簽名
canUseTool(toolName, input, options)

// options 包含：
{
  signal: AbortSignal,
  suggestions: PermissionUpdate[],  // 建議的永久權限設定
  toolUseID: string,                // 必要 - 工具呼叫的唯一 ID
  blockedPath?: string,
  decisionReason?: string,
  agentID?: string
}

// 回傳值
Promise<PermissionResult>  // { behavior: 'allow'|'deny', updatedPermissions? }
```

---

# 第二層：Server 層加工

## 關鍵事實：transformMessage 是 identity function

```javascript
// server/claude-sdk.js:229-234
function transformMessage(sdkMessage) {
  return sdkMessage;  // 原封不動
}
```

## Server 加了什麼

### WebSocket 訊息 wrapper types

| Server 自製 type | 來源 | 說明 |
|------------------|------|------|
| `claude-response` | SDK 所有訊息 | 包裝 `{ type, data: sdkMessage }` |
| `permission-request` | SDK canUseTool callback | 轉成 WebSocket 訊息格式 |
| `token-budget` | SDK result 訊息 | **計算**出 token 用量 |
| `claude-complete` | SDK generator 結束 | generator loop 結束後發送 |
| `session-created` | SDK 第一個訊息的 session_id | 通知前端新 session |
| `claude-error` | SDK exception | 錯誤包裝 |

### Server 自己生成的欄位

| 欄位 | 出現在 | 說明 |
|------|--------|------|
| `requestId` | permission-request | `perm_${timestamp}_${randomId}` |
| `timestamp` | permission-request | `Date.now()` |
| `exitCode` | claude-complete | 通常為 0 |
| `isNewSession` | claude-complete | 邏輯判斷 `!sessionId && !!command` |
| `data.used` / `data.total` | token-budget | 從 SDK modelUsage 計算 |

### Permission Request 的 Server 包裝

```javascript
// SDK callback 收到 → Server 轉成：
{
  type: 'permission-request',       // ← Server 加的 wrapper
  requestId: 'perm_xxx_yyy',       // ← Server 生成
  toolName,                         // ← SDK 透傳
  toolInput: input,                 // ← SDK 透傳（改名 input → toolInput）
  toolUseID,                        // ← SDK 透傳
  suggestions: suggestions || [],   // ← SDK 透傳
  timestamp: Date.now()             // ← Server 加的
}
```

---

# 第三層：Frontend 層加工

## Frontend 自己加的 boolean flags

這些 flag 決定了 UI 渲染什麼元件：

| Flag | 觸發的 UI | 說明 |
|------|----------|------|
| `isToolUse: true` | 工具執行摘要（可展開） | 從 SDK `content[].type === 'tool_use'` 判斷 |
| `isPermissionRequest: true` | 權限對話框（三個按鈕） | 從 Server `type === 'permission-request'` 判斷 |
| `isInteractivePrompt: true` | 編號選項按鈕 | 從 Server `type === 'claude-interactive-prompt'` 判斷 |
| `isStreaming: true` | 串流動畫指示器 | 正在接收中 |

## Frontend 自己加的狀態欄位

| 欄位 | 用途 |
|------|------|
| `permissionData: { requestId, toolName, toolInput, toolUseID, suggestions }` | 打包權限資訊 |
| `permissionResolved: boolean` | 使用者是否已回應 → 控制按鈕顯示/隱藏 |
| `permissionChoice: 'allowed' \| 'denied' \| 'always-allowed'` | 使用者的選擇結果 |
| `toolResult: null \| { content, isError, timestamp }` | 預留給工具結果 |
| `timestamp: new Date()` | 前端自己的時間戳 |
| `content: ''` | 非文字訊息的 placeholder |

---

# 完整資料流範例

## 範例 1：Permission Request

```
SDK canUseTool('Bash', {command: 'npm test'}, {toolUseID: 'tu_123', suggestions: [...]})
  ↓
Server 包裝：
  { type: 'permission-request', requestId: 'perm_xxx', toolName: 'Bash',
    toolInput: {command: 'npm test'}, toolUseID: 'tu_123', suggestions: [...] }
  ↓
Frontend 轉成 UI 狀態：
  { type: 'assistant', isPermissionRequest: true, permissionResolved: false,
    permissionData: { requestId, toolName, toolInput, toolUseID, suggestions } }
  ↓
使用者點 "Allow Once"
  ↓
Frontend → Server：
  { type: 'permission-response', requestId: 'perm_xxx', behavior: 'allow' }
  ↓
Server resolve pending promise → SDK 繼續執行
```

## 範例 2：Tool Use

```
SDK yield { type: 'assistant', message: { content: [
  { type: 'tool_use', name: 'Read', id: 'tu_456', input: { file_path: '/foo/bar.js' } }
]}}
  ↓
Server 包裝：
  { type: 'claude-response', data: <原封不動的 SDK 訊息> }
  ↓
Frontend 解析 content[]，轉成 UI 狀態：
  { type: 'assistant', isToolUse: true,
    toolName: 'Read', toolId: 'tu_456',
    toolInput: '{"file_path":"/foo/bar.js"}', toolResult: null }
  ↓
後續 SDK yield tool_result → 填入 toolResult
```

---

# 關鍵檔案位置

| 檔案 | 關鍵行數 | 職責 |
|------|---------|------|
| `server/claude-sdk.js` | 428-478 | canUseTool → permission-request 轉換 |
| `server/claude-sdk.js` | 514-591 | SDK message streaming loop |
| `server/claude-sdk.js` | 229-234 | transformMessage（identity） |
| `server/claude-sdk.js` | 241-274 | extractTokenBudget 計算 |
| `server/index.js` | 850-869 | permission-response 處理 |
| `src/components/ChatInterface.jsx` | 3318-3840 | 訊息路由 switch |
| `src/components/ChatInterface.jsx` | 3442-3469 | tool_use 解析 |
| `src/components/ChatInterface.jsx` | 3550-3573 | permission-request 轉 UI 狀態 |
| `src/components/ChatInterface.jsx` | 1464-1608 | permission UI 渲染 |

---

# 後續計畫

## Debug Monitor 增強

目標：在現有 Debug Monitor 面板中增加訊息追蹤功能

### 需求
- 視覺化顯示 SDK 原生訊息 vs Server/Frontend 加工
- 用顏色或標籤區分三層來源
- 記憶體內保存最近 ~200-300 筆訊息
- 可查看原始 JSON 結構
- 可追蹤使用者與系統的互動（如權限授予流程）

### 可能的實作方式
- 在 Server 層攔截 SDK 訊息，同時發送一份到 debug channel
- 前端用獨立的 signal/store 存放 debug 訊息
- Debug Monitor 新增 tab 或 section 顯示訊息流
