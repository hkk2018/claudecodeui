---
title: "跨 Session UI 狀態問題分析"
description: "Permission UI 和 Cancel UI 沒有正確綁定 session，導致多 session 切換時狀態錯亂"
last_modified: "2026-03-01 17:23"
tags: ["bug", "session-management", "permission-ui", "cancel-ui", "state-management"]
---

# 跨 Session UI 狀態問題分析

## 問題發現

使用者反映兩個 UI 元件的狀態管理有問題：

1. **Permission Request UI**（權限請求對話框）
2. **Cancel/Stop UI**（取消訊息按鈕）

這兩個 UI 都**沒有跟 session 綁定**，它們的狀態是「全域共用」的，不會隨著 session 切換而正確切換。

**症狀**：
- 在 Session A 看到的 permission request，切到 Session B 後可能還在
- Session A 正在 processing（顯示 Stop 按鈕），切到 Session B 後按鈕狀態可能還是 loading
- 跨 session 操作時狀態錯亂，UI 與實際 session 狀態不符

---

## 根因分析

### 問題 1：Permission Request UI

#### 檔案位置
- **UI 渲染**：[src/components/ChatInterface.jsx:1464-1608](../src/components/ChatInterface.jsx#L1464-L1608)
- **後端追蹤**：[server/claude-sdk.js:25](../server/claude-sdk.js#L25) `pendingPermissionRequests` Map

#### 狀態管理方式

**前端**：
```javascript
// Permission request 存在 chatMessages useState 陣列中
setChatMessages(prev => [...prev, {
  type: 'assistant',
  isPermissionRequest: true,
  permissionResolved: false,
  permissionData: { requestId, toolName, toolInput, toolUseID, suggestions }
}]);
```

**後端**：
```javascript
// server/claude-sdk.js:25
const pendingPermissionRequests = new Map();  // 全域 Map，不分 session
```

#### 問題點

1. **後端的 `pendingPermissionRequests` 是全域 Map**
   - 所有 session 共用同一個 Map
   - 用 `requestId` 當 key，不是 `sessionId`
   - 理論上透過 `requestId` 可以區分不同 session 的 request，但沒有 session 層級的隔離

2. **Permission request 不持久化到 JSONL**
   - 只存在前端記憶體中的 `chatMessages`
   - 切換 session 時可能丟失

3. **前端有 workaround 但脆弱**
   - [ChatInterface.jsx:3195-3211](../src/components/ChatInterface.jsx#L3195-L3211) 有保留 pending permission 的邏輯
   - 但這只是修補，如果 `convertedMessages` 同步時沒有特別處理，pending permission 會被沖掉
   - 參考 [2025-12-20-permission-ui-fixes.md](implementation-reports/2025-12-20-permission-ui-fixes.md) 的修復記錄

#### 目前的 workaround

```javascript
// ChatInterface.jsx:3014-3036
useEffect(() => {
  if (sessionMessages.length > 0) {
    setChatMessages(prev => {
      // 只保留未解決的 permission requests
      const pendingPermissionRequests = prev.filter(
        m => m.isPermissionRequest && !m.permissionResolved
      );

      if (pendingPermissionRequests.length > 0) {
        console.log('📌 Preserving', pendingPermissionRequests.length,
                    'pending permission request(s)');
        return [...convertedMessages, ...pendingPermissionRequests];
      }
      return convertedMessages;
    });
  }
}, [convertedMessages, sessionMessages]);
```

**為什麼是 workaround？**
- 這只保留了「未解決」的 permission requests
- 沒有綁定到特定 session
- 切換到 Session B 時，Session A 的 pending permission 可能還會顯示

---

### 問題 2：Cancel/Stop UI

#### 檔案位置
- **UI 元件**：[src/components/ClaudeStatus.jsx:92-102](../src/components/ClaudeStatus.jsx#L92-L102)
- **狀態管理**：[src/components/ChatInterface.jsx:1832, 1871](../src/components/ChatInterface.jsx#L1832)

#### 狀態管理方式

```javascript
// ChatInterface.jsx
const isLoading = useSignal(false);           // Line 1832 - Signal
const [canAbortSession, setCanAbortSession] = useState(false);  // Line 1871 - useState
```

**UI 顯示邏輯**：
```jsx
// ClaudeStatus.jsx:92-102
{canInterrupt && onAbort && (
  <button onClick={onAbort} className="...">
    <svg>...</svg>
    <span>Stop</span>
  </button>
)}
```

#### 問題點

1. **`isLoading` 和 `canAbortSession` 都是 ChatInterface 元件內的狀態**
   - **只有一份**，所有 session 共用
   - 沒有 per-session 的狀態管理

2. **切換 session 時狀態不會更新**
   - Session A 正在 processing（`isLoading.value = true`）
   - 切換到 Session B（已經 idle）
   - `isLoading` 可能還是 `true`，顯示 Stop 按鈕
   - 但這時按 Stop 會發送 `currentSessionId`（Session B），而不是正在 processing 的 Session A

3. **Abort 動作本身有帶 sessionId，但前端狀態沒有分離**
   ```javascript
   // ChatInterface.jsx:4567-4575
   const handleAbortSession = () => {
     if (currentSessionId && canAbortSession) {
       sendMessage({
         type: 'abort-session',
         sessionId: currentSessionId,  // ← 用當前 session
         provider: provider
       });
     }
   };
   ```

4. **ESC 鍵提示但未實作**
   - UI 顯示 "esc to stop"（ClaudeStatus.jsx:85）
   - 但 ESC 鍵的 handler 實際上**沒有實作** abort 功能
   - 目前 ESC 只會關閉 dropdown（ChatInterface.jsx:4361, 4399）

---

## 影響範圍

### 使用者體驗問題

1. **Permission UI 跨 session 殘留**
   - Session A 有 pending permission
   - 切到 Session B，permission UI 可能還在
   - 使用者點 Allow/Deny，不知道會影響哪個 session

2. **Cancel UI 狀態錯誤**
   - Session A processing，切到 Session B（idle）
   - Session B 可能還顯示 Stop 按鈕（雖然它不應該在 processing）
   - 按 Stop 會 abort 錯誤的 session

3. **狀態不一致**
   - UI 顯示的狀態與實際 session 狀態不符
   - 多 session 環境下容易混淆

---

## 解決方向

### 核心原則

**所有 UI 狀態都應該 per-session 管理**，而不是全域共用。

### 方案 1：Per-Session State Map（推薦）

使用 Signal Map 管理每個 session 的狀態：

```javascript
// 改用 per-session 的 Signal Map
const sessionStates = signal({
  // sessionId -> { isLoading, canAbort, pendingPermissions }
});

// 讀取當前 session 的狀態
const currentState = computed(() =>
  sessionStates.value[currentSessionId] || {
    isLoading: false,
    canAbort: false,
    pendingPermissions: []
  }
);

// UI 讀取
<ClaudeStatus
  isLoading={currentState.value.isLoading}
  canInterrupt={currentState.value.canAbort}
  onAbort={handleAbortSession}
/>
```

**優點**：
- 清楚的 session 隔離
- 切換 session 時自動讀取對應狀態
- Signal 自動追蹤，不需要手動 setState

**需要修改的地方**：
1. 建立 `sessionStates` Signal Map
2. 所有設定 `isLoading` / `canAbortSession` 的地方改成更新對應 session 的狀態
3. UI 從 `currentState` 讀取而不是直接讀 `isLoading`

### 方案 2：Session Metadata 整合

把這些狀態整合到現有的 session metadata 中：

```javascript
// sessionMetadata 已經 per-session，可以加入這些 field
{
  sessionId: 'xxx',
  isProcessing: true,      // ← 新增
  canAbort: true,          // ← 新增
  pendingPermissions: [],  // ← 新增
  timestamp: '...',
  // ... 其他 metadata
}
```

**優點**：
- 復用現有的 session 管理機制
- 不需要額外的 state

**缺點**：
- sessionMetadata 可能已經很複雜
- 需要確保所有更新 metadata 的地方都正確處理這些新 field

---

## 實作計畫

### Phase 1：Permission UI 修復

1. **後端**：
   - 把 `pendingPermissionRequests` 改成 `Map<sessionId, Map<requestId, promise>>`
   - 或者在 permission request 物件中加入 `sessionId` field

2. **前端**：
   - 建立 per-session 的 `pendingPermissions` 狀態
   - 切換 session 時只顯示當前 session 的 pending permissions
   - 移除現有的 workaround

3. **測試**：
   - Session A 有 pending permission
   - 切到 Session B，不應該看到 Session A 的 permission
   - 切回 Session A，permission 應該還在

### Phase 2：Cancel UI 修復

1. **前端狀態**：
   - 把 `isLoading` / `canAbortSession` 改成 per-session Signal Map
   - 建立 `currentSessionState` computed signal

2. **UI 更新**：
   - ClaudeStatus 從 `currentSessionState` 讀取狀態
   - 所有設定 loading 狀態的地方改成更新對應 session

3. **ESC 鍵實作**：
   - 在 `handleKeyDown` 中加入 ESC 觸發 abort 的邏輯
   - 檢查 `isLoading` 和 `canAbortSession` 再執行

4. **測試**：
   - Session A processing，切到 Session B（idle）
   - Session B 不應該顯示 Stop 按鈕
   - 切回 Session A，應該顯示 Stop 按鈕
   - 按 ESC 應該 abort 當前 session

### Phase 3：持久化考量（Optional）

考慮是否要將這些狀態持久化：
- Permission requests 可能不需要持久化（已解決的就不重要了）
- Processing 狀態需要在頁面重載時恢復（從 backend session status 讀取）

---

## 相關檔案

| 檔案 | 行數 | 說明 |
|------|------|------|
| `src/components/ChatInterface.jsx` | 1832 | `isLoading` Signal 定義 |
| `src/components/ChatInterface.jsx` | 1871 | `canAbortSession` useState 定義 |
| `src/components/ChatInterface.jsx` | 4567-4575 | `handleAbortSession` 函數 |
| `src/components/ChatInterface.jsx` | 3014-3036 | Permission workaround useEffect |
| `src/components/ChatInterface.jsx` | 1464-1608 | Permission UI 渲染 |
| `src/components/ClaudeStatus.jsx` | 92-102 | Stop 按鈕 UI |
| `src/components/ClaudeStatus.jsx` | 85 | "esc to stop" 提示 |
| `server/claude-sdk.js` | 25 | `pendingPermissionRequests` Map |
| `server/claude-sdk.js` | 428-478 | `canUseTool` callback 處理 |
| `server/index.js` | 804-821 | `abort-session` WebSocket handler |

---

## 參考文檔

- [2025-12-20-permission-ui-fixes.md](implementation-reports/2025-12-20-permission-ui-fixes.md) - Permission UI 消失問題修復
- [2026-02-17-sdk-message-architecture-analysis.md](2026-02-17-sdk-message-architecture-analysis.md) - SDK 訊息架構分析

---

## 後續步驟

1. ✅ 撰寫 dev log 記錄問題
2. ⏳ 實作 Phase 1：Permission UI 修復
3. ⏳ 實作 Phase 2：Cancel UI 修復
4. ⏳ 實作 Phase 3：ESC 鍵支援
5. ⏳ 整合測試

---

## 設計決策記錄

### 為什麼用 Signal Map 而不是 useState？

**理由**：
1. Signal 自動追蹤依賴，不需要手動管理 dependency array
2. 避免 useEffect closure trap（參考 [2026-01-06-react-useeffect-closure-trap.md](2026-01-06-react-useeffect-closure-trap.md)）
3. 細粒度更新，不會觸發整個元件 re-render
4. 符合專案的 Signal 優先原則（參考 CLAUDE.md frontend 規範）

### 為什麼不把 Permission 持久化到 JSONL？

**理由**：
1. JSONL 是 Claude Code CLI 管理的，我們只能讀取
2. Permission request 是「互動過程」，不是「對話內容」
3. 已解決的 permission 不需要保留（除非要做 audit log）
4. 未解決的 permission 在 session 恢復時可以從 backend 重新請求

### 為什麼不用獨立的 UI 區塊顯示 Permission？

**理由**（參考 2025-12-20 dev log）：
1. 對話流程清晰：「Claude 想做什麼」→「我允許」→「Claude 執行」
2. 時間順序正確，使用者容易理解脈絡
3. 修復後穩定，不需要大幅重構
