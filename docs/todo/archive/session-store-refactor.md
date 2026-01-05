---
title: "Session 消息管理重構 - Zustand Store"
description: "將 Session 消息從組件 state 改為外部 Store，解決切換 Session 時消息丟失的問題"
created: "2025-12-29 01:17"
priority: medium
---

# Session 消息管理重構

## 目標

將 Session 相關的狀態從 React 組件內部的 `useState` 改為 Zustand Store，實現：
- 每個 Session 的消息獨立存儲
- 切換 Session 時消息不會丟失
- 移除 Session Protection 機制（不再需要）

## 現狀問題

目前 `sessionMessages` 存在 `ChatInterface.jsx` 內部：
```javascript
const [sessionMessages, setSessionMessages] = useState([]);
```

導致：
- 切換 Session → state 重置 → 消息丟失
- 需要 Session Protection 阻止 sidebar 更新
- 複雜的 `pendingSessionId` / `activeSessions` 機制

## 重構範圍（優先處理 Session ID 相關）

### Phase 1：建立 Session Store

新增 `src/stores/sessionStore.js`：

```javascript
import { create } from 'zustand';

export const useSessionStore = create((set, get) => ({
  // 每個 Session 的消息
  sessionMessages: {},
  // { 'session-abc': [...], 'session-xyz': [...] }

  // 當前查看的 Session ID
  viewingSessionId: null,

  // 添加消息
  addMessage: (sessionId, message) => set(state => ({
    sessionMessages: {
      ...state.sessionMessages,
      [sessionId]: [...(state.sessionMessages[sessionId] || []), message]
    }
  })),

  // 切換 Session
  switchSession: (sessionId) => set({ viewingSessionId: sessionId }),

  // 取得當前消息
  getCurrentMessages: () => {
    const { sessionMessages, viewingSessionId } = get();
    return sessionMessages[viewingSessionId] || [];
  }
}));
```

### Phase 2：移除 Session Protection 相關程式碼

**可移除的：**

| 項目 | 位置 | 說明 |
|------|------|------|
| `pendingSessionId` | `sessionStorage` | 不需要，消息直接存到對應 Session |
| `activeSessions` | `App.jsx` state | 不需要阻擋 sidebar 更新 |
| `onSessionActive` | `App.jsx` → `ChatInterface.jsx` | 不需要 |
| `onSessionInactive` | `App.jsx` → `ChatInterface.jsx` | 不需要 |
| `onReplaceTemporarySession` | `App.jsx` → `ChatInterface.jsx` | 不需要 |
| `new-session-{timestamp}` | `ChatInterface.jsx` | 不需要臨時 ID |
| 消息過濾邏輯 | `ChatInterface.jsx:3106-3124` | 不需要，每個 Session 獨立 |
| Session Protection 註解 | 多處 | 清理 |

### Phase 3：更新 WebSocket 消息處理

修改 `ChatInterface.jsx` 的 WebSocket 處理：
- `claude-response` → `store.addMessage(sessionId, data)`
- `session-created` → 簡化（只需記錄 ID）
- `claude-complete` → 簡化

### Phase 4：更新 Session 切換邏輯

修改 `Sidebar.jsx` / `App.jsx`：
- 點擊 Session → `store.switchSession(sessionId)`
- 如果消息未載入 → 從後端載入
- 已載入 → 瞬間切換（不需要 API 請求）

## 預期效果

**Before:**
```
Session A 進行中 → 點擊 Session B → 被阻止或消息丟失
```

**After:**
```
Session A 進行中 → 點擊 Session B → 瞬間切換
→ Session A 繼續在背景接收消息
→ 切回 Session A → 消息都在
```

## 依賴

需要安裝：
```bash
npm install zustand
```

## 注意事項

- 記憶體管理：可能需要限制快取的 Session 數量
- 現有 Context（Theme, Auth）保留，只處理 Session 相關
