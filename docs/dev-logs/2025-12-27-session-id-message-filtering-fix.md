---
title: "Session ID 消息過濾機制修復"
description: "修復新 Claude 會話無法接收消息的問題，並詳細記錄 Session ID 管理機制"
last_modified: "2025-12-27 14:17"
---

# Session ID 消息過濾機制修復

## 問題描述

**現象：** 新開啟的 Claude 會話無法接收任何消息，內容不會顯示在當前視窗中。

**根本原因：** `ChatInterface.jsx` 的消息過濾邏輯錯誤拒絕了所有新會話的消息。

## 原始錯誤邏輯

### 位置
`src/components/ChatInterface.jsx:3110-3119`

### 錯誤代碼
```javascript
if (!isGlobalMessage && messageSessionId) {
  if (currentSessionId && messageSessionId !== currentSessionId) {
    // 正確：拒絕其他會話的消息
    return;
  }
  if (!currentSessionId) {
    // ❌ 錯誤：拒絕所有帶 sessionId 的消息
    return;
  }
}
```

### 問題分析

**錯誤假設：** 「新會話不應該收到帶 sessionId 的消息」

**實際情況：**
- 新會話的消息**也會帶有 sessionId**（從 Claude SDK 獲得的真實 Session ID）
- `currentSessionId` 在會話完成前一直是 `null`
- 這段邏輯會拒絕**所有**來自新會話的消息

**結果：** 新會話啟動後，所有 `claude-response` 消息都被過濾掉，用戶看不到任何內容。

## 修復方案

### 新邏輯
```javascript
if (!isGlobalMessage && messageSessionId) {
  if (currentSessionId && messageSessionId !== currentSessionId) {
    // 已有會話：拒絕其他會話的消息
    return;
  }
  if (!currentSessionId) {
    // 新會話：檢查是否匹配 pendingSessionId
    const pendingSessionId = sessionStorage.getItem('pendingSessionId');
    if (pendingSessionId && messageSessionId !== pendingSessionId) {
      // 有 pendingSessionId 且不匹配：拒絕其他會話的消息
      return;
    }
    // pendingSessionId 匹配或尚未設定：接受消息
  }
}
```

### 邏輯說明

1. **已有會話（`currentSessionId` 存在）：**
   - 只接受 `messageSessionId === currentSessionId` 的消息
   - 拒絕其他會話的消息

2. **新會話（`currentSessionId` 為 `null`）：**
   - 如果 `pendingSessionId` 存在，檢查是否匹配
   - 如果 `pendingSessionId` 尚未設定，接受消息（這是第一個消息）
   - 這樣可以正確接收新會話的消息，同時過濾其他並行會話

## Session ID 管理機制詳解

### 三種 Session ID

| ID 類型 | 儲存位置 | 生命週期 | 用途 |
|---------|---------|---------|------|
| **Temporary ID** | `activeSessions` Set | 創建到 `session-created` | 防止 sidebar 更新（保護期） |
| **pendingSessionId** | `sessionStorage` | `session-created` 到 `claude-complete` | 消息過濾、Session 保護 |
| **currentSessionId** | React State | `claude-complete` 後永久 | 正式 Session ID，觸發 sidebar 刷新 |

### 臨時 Session ID 的創建

#### 誰創建的？
**前端 `ChatInterface.jsx` 在用戶發送消息時創建**

#### 創建位置
- **檔案：** `src/components/ChatInterface.jsx`
- **函數：** `handleSubmit()` (用戶點擊「發送」按鈕時觸發)
- **行數：** 4068

#### 創建邏輯

```javascript
// ChatInterface.jsx:4063-4071
// Determine effective session id for replies to avoid race on state updates
const effectiveSessionId = currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');

// Session Protection: Mark session as active to prevent automatic project updates during conversation
// Use existing session if available; otherwise a temporary placeholder until backend provides real ID
const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
if (onSessionActive) {
  onSessionActive(sessionToActivate);
}
```

#### 決策流程

```
sessionToActivate =
  currentSessionId                    // 優先：當前會話 ID（resume 時存在）
  || selectedSession?.id              // 次要：從 sidebar 選擇的會話
  || sessionStorage.cursorSessionId   // 備用：Cursor 會話 ID
  || `new-session-${Date.now()}`      // 最後：創建臨時 ID（新會話）
```

**只有在以下所有條件都不滿足時才創建臨時 ID：**
1. `currentSessionId` 是 `null`（沒有當前會話）
2. `selectedSession?.id` 不存在（sidebar 沒有選擇會話）
3. `sessionStorage.cursorSessionId` 不存在（沒有 Cursor 會話）

**換句話說：當這是一個全新的會話時。**

#### 為什麼用 `Date.now()`？

```javascript
`new-session-${Date.now()}`
// 生成範例：'new-session-1735280000000'
```

**設計考量：**
1. **唯一性**：每次創建的臨時 ID 都不同（毫秒級時間戳）
2. **可識別**：以 `new-session-` 開頭，方便後續識別和替換
3. **簡單**：不需要額外的 UUID 生成器或複雜邏輯
4. **可讀性**：從 ID 中可以看出大約的創建時間

### 完整生命週期

```
用戶發送第一個訊息
    ↓
【步驟 1】創建臨時 ID（前端：ChatInterface.jsx:4068）
    - handleSubmit() 被觸發
    - effectiveSessionId = null（新會話）
    - tempId = `new-session-${Date.now()}`
    - onSessionActive(tempId)
        ↓ 呼叫 App.jsx
    - activeSessions.add(tempId)
    - 目的：防止 sidebar 刷新干擾
    ↓
【步驟 2】發送到後端
    - WebSocket: { type: 'claude-command', options: { sessionId: null } }
    - 後端收到，啟動 Claude SDK
    ↓
【步驟 3】Claude SDK 創建會話
    - SDK 內部生成真實 session_id
    - 第一個消息包含 session_id
    ↓
【步驟 4】後端捕獲並廣播
    - 捕獲 session_id（例如："abc123"）
    - 發送：{ type: 'session-created', sessionId: 'abc123' }
    ↓
【步驟 5】前端收到 session-created
    ┌─────────────────────────────────────────────────────┐
    │ ChatInterface.jsx (case 'session-created')          │
    │                                                     │
    │ 1. sessionStorage.setItem('pendingSessionId', 'abc123') │
    │                                                     │
    │ 2. if (onReplaceTemporarySession) {                │
    │      onReplaceTemporarySession('abc123')           │
    │    }                                                │
    └─────────────────────────────────────────────────────┘
                          ↓
    ┌─────────────────────────────────────────────────────┐
    │ App.jsx (replaceTemporarySession)                   │
    │                                                     │
    │ 執行時機：收到真實 Session ID 時                       │
    │ 目的：維持 Session 保護的連續性                        │
    │                                                     │
    │ const replaceTemporarySession = (realSessionId) => {│
    │   setActiveSessions(prev => {                      │
    │     const newSet = new Set(prev);                  │
    │                                                     │
    │     // 1. 找出並刪除臨時 ID                           │
    │     for (const sid of newSet) {                    │
    │       if (sid.startsWith('new-session-')) {        │
    │         newSet.delete(sid);  // 刪除 "new-session-1735..." │
    │         break;                                      │
    │       }                                             │
    │     }                                               │
    │                                                     │
    │     // 2. 加入真實 Session ID                        │
    │     newSet.add(realSessionId);  // 加入 "abc123"    │
    │                                                     │
    │     return newSet;                                 │
    │   });                                               │
    │                                                     │
    │   // 結果：activeSessions = ["abc123"]              │
    │   // Session 保護持續，sidebar 仍被阻擋更新             │
    │ };                                                  │
    └─────────────────────────────────────────────────────┘
                          ↓
    - currentSessionId 保持 null（重要！）
    - activeSessions 從 ["new-session-1735..."] 變成 ["abc123"]
    - Session 保護持續生效（無縫切換）
    ↓
【步驟 6】消息傳輸階段
    - 後端持續發送：{ type: 'claude-response', sessionId: 'abc123', ... }
    - 消息過濾邏輯：
        → currentSessionId 是 null
        → pendingSessionId 是 'abc123'
        → messageSessionId 是 'abc123'
        → ✅ 匹配，接受消息
    ↓
【步驟 7】會話完成
    - 後端發送：{ type: 'claude-complete', sessionId: 'abc123', exitCode: 0 }
    - 前端處理：
        → setCurrentSessionId('abc123')
        → sessionStorage.removeItem('pendingSessionId')
        → onSessionInactive('abc123')
            → activeSessions.delete('abc123')
    - 觸發 sidebar 刷新（顯示新會話）
```

### `onReplaceTemporarySession` 執行時機與目的

#### 何時執行？
**精確時機：** 收到 `session-created` WebSocket 消息時（步驟 5）

```javascript
// ChatInterface.jsx:3127-3135
case 'session-created':
  if (latestMessage.sessionId && !currentSessionId) {
    // 1. 暫存真實 Session ID
    sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);

    // 2. 立即替換 activeSessions 中的臨時 ID
    if (onReplaceTemporarySession) {
      onReplaceTemporarySession(latestMessage.sessionId);
    }
  }
  break;
```

#### 為什麼需要？

**問題：Session 保護的斷層問題**

如果不替換，會發生什麼？

```
時間點 A：用戶發送消息
  → activeSessions.add('new-session-1735280000000')
  → sidebar 被阻擋更新 ✅

時間點 B：收到 session-created (realSessionId: "abc123")
  → 如果不執行 onReplaceTemporarySession：
  → activeSessions 仍是 ['new-session-1735280000000']
  → 但真實 Session ID 是 "abc123"

時間點 C：會話完成
  → onSessionInactive("abc123") 被呼叫
  → activeSessions.delete("abc123") ← 找不到！
  → 結果：'new-session-1735280000000' 永遠留在 activeSessions
  → sidebar 被永久阻擋 ❌
```

**解決方案：無縫替換**

```
時間點 A：用戶發送消息
  → activeSessions = ['new-session-1735280000000']

時間點 B：收到 session-created (realSessionId: "abc123")
  → onReplaceTemporarySession("abc123")
  → activeSessions.delete('new-session-1735280000000')
  → activeSessions.add('abc123')
  → 結果：activeSessions = ['abc123']
  → Session 保護持續 ✅

時間點 C：會話完成
  → onSessionInactive("abc123")
  → activeSessions.delete("abc123")
  → 結果：activeSessions = []
  → sidebar 恢復更新 ✅
```

#### App.jsx 實作細節

```javascript
// App.jsx:542-556
const replaceTemporarySession = useCallback((realSessionId) => {
  setActiveSessions(prev => {
    const newSet = new Set(prev);

    // 找出並刪除所有臨時 ID（以 'new-session-' 開頭）
    for (const sid of newSet) {
      if (sid.startsWith('new-session-')) {
        newSet.delete(sid);
        console.log(`🔄 Replaced temp session ${sid} with ${realSessionId}`);
        break; // 正常情況只有一個臨時 ID
      }
    }

    // 加入真實 Session ID
    newSet.add(realSessionId);
    return newSet;
  });
}, []);
```

#### 關鍵特性

1. **無縫切換**：Session 保護沒有中斷，sidebar 持續被阻擋
2. **ID 同步**：確保 `activeSessions` 中的 ID 與後端一致
3. **清理舊 ID**：防止臨時 ID 累積導致永久阻擋
4. **支援並行**：多個視窗各自替換自己的臨時 ID

### 為什麼需要 `pendingSessionId`？

#### 問題：兩個互相衝突的需求

**需求 A：防止 Sidebar 更新干擾**
- 會話進行中，sidebar 不能刷新（會導致 UI 跳動）
- 使用 `activeSessions` Set 來追蹤「正在進行的會話」
- **只有在會話完成時**才能移除保護，觸發 sidebar 刷新

**需求 B：需要立即知道真實 Session ID**
- 後端消息都帶有真實的 `session_id`
- 需要用它來**過濾消息**（區分不同會話）
- 特別是當有多個並行會話時

#### 解決方案：三階段 Session ID

1. **臨時 ID 階段**（`new-session-{timestamp}`）
   - 用途：啟動 Session 保護
   - 持續時間：發送消息 → 收到 `session-created`

2. **Pending ID 階段**（真實 Session ID，暫存）
   - 用途：消息過濾 + 維持 Session 保護
   - 持續時間：收到 `session-created` → 收到 `claude-complete`
   - **關鍵：** 不設定 `currentSessionId`，避免觸發 sidebar 刷新

3. **Current ID 階段**（真實 Session ID，正式）
   - 用途：永久 Session 標識
   - 持續時間：收到 `claude-complete` → 永久
   - **觸發：** sidebar 刷新，顯示新會話

### 並行會話情境

假設用戶**同時開啟兩個新會話**：

```
時間線：
T0: 用戶在視窗 A 發送消息
    - tempId = "new-session-1735280000000"
    - activeSessions = ["new-session-1735280000000"]

T1: 用戶在視窗 B 發送消息
    - tempId = "new-session-1735280001000"
    - activeSessions = ["new-session-1735280000000", "new-session-1735280001000"]

T2: 視窗 A 收到 session-created (sessionId: "abc123")
    ┌────────────────────────────────────────────┐
    │ 視窗 A：ChatInterface.jsx                  │
    │                                            │
    │ 1. sessionStorage.setItem('pendingSessionId', 'abc123') │
    │ 2. onReplaceTemporarySession('abc123')     │
    │    ↓                                       │
    │    App.jsx:                                │
    │    - activeSessions.delete('new-session-1735280000000') │
    │    - activeSessions.add('abc123')          │
    └────────────────────────────────────────────┘
    結果：
    - activeSessions = ["abc123", "new-session-1735280001000"]
    - sessionStorage.pendingSessionId = "abc123"（僅視窗 A）

T3: 視窗 B 收到 session-created (sessionId: "xyz789")
    ┌────────────────────────────────────────────┐
    │ 視窗 B：ChatInterface.jsx                  │
    │                                            │
    │ 1. sessionStorage.setItem('pendingSessionId', 'xyz789') │
    │ 2. onReplaceTemporarySession('xyz789')     │
    │    ↓                                       │
    │    App.jsx:                                │
    │    - activeSessions.delete('new-session-1735280001000') │
    │    - activeSessions.add('xyz789')          │
    └────────────────────────────────────────────┘
    結果：
    - activeSessions = ["abc123", "xyz789"]
    - sessionStorage.pendingSessionId = "xyz789"（僅視窗 B）

T4: 後端發送視窗 A 的消息 (sessionId: "abc123")
    - 視窗 A：
        → currentSessionId = null
        → pendingSessionId = "abc123"
        → messageSessionId = "abc123"
        → ✅ 接受
    - 視窗 B：
        → currentSessionId = null
        → pendingSessionId = "xyz789"
        → messageSessionId = "abc123"
        → ❌ 拒絕（不匹配）

T5: 視窗 A 完成 (claude-complete, sessionId: "abc123")
    - setCurrentSessionId("abc123")
    - activeSessions = ["xyz789"]
    - sidebar 刷新（顯示會話 abc123）
```

## 程式碼位置參考

### 前端（ChatInterface.jsx）

| 行數 | 功能 | 說明 |
|------|------|------|
| 3100-3124 | 消息過濾邏輯 | **本次修復位置** |
| 3127-3135 | session-created 處理 | 設定 `pendingSessionId` |
| 3553-3606 | claude-complete 處理 | 正式設定 `currentSessionId` |
| 4058-4066 | 創建臨時 Session ID | 發送消息時 |

### 後端（server/claude-sdk.js）

| 行數 | 功能 | 說明 |
|------|------|------|
| 487-521 | `queryClaudeSDK()` | 啟動 Claude SDK |
| 531-550 | 捕獲 Session ID | 從 SDK 消息中提取 |
| 542-547 | 發送 session-created | 廣播真實 Session ID |

### 前端（App.jsx）

| 行數 | 功能 | 說明 |
|------|------|------|
| 498-523 | `handleSessionActive()` | 管理 `activeSessions` |
| 542-556 | `replaceTemporarySession()` | 替換臨時 ID 為真實 ID |

## 測試驗證

### 測試案例 1：單一新會話
1. 用戶發送第一個訊息
2. 觀察：消息正常顯示（不再被過濾）
3. 會話完成後，sidebar 正確顯示新會話

### 測試案例 2：並行新會話
1. 在視窗 A 發送訊息（新會話 A）
2. 在視窗 B 發送訊息（新會話 B）
3. 觀察：兩個視窗各自顯示正確內容，不會混淆

### 測試案例 3：Resume 現有會話
1. 選擇現有會話
2. 發送新訊息
3. 觀察：消息正常顯示（`currentSessionId` 存在，走不同分支）

## 相關議題

- **Session 保護機制：** 防止 sidebar 在會話進行中刷新
- **消息路由：** WebSocket 消息如何分發到正確的前端視窗
- **Session 持久化：** 會話完成後如何儲存到 sidebar

## 部署資訊

- **修復時間：** 2025-12-27 13:06
- **影響檔案：** `src/components/ChatInterface.jsx`
- **測試環境：** Port 9001 (開發版)
- **部署指令：** `npm run build && cp public/sw.js dist/sw.js && sudo systemctl restart claude-code-ui-dev`
