---
title: "Permission UI 消失問題修復與 Always Allow 持久化"
description: "解決 permission request UI 立即消失的問題，並實現 Always Allow 按鈕的持久化"
date: "2025-12-20"
last_modified: "2025-12-20 13:27"
tags: ["permission-system", "react-state", "sdk", "bug-fix"]
---

# Permission UI 消失問題修復與 Always Allow 持久化

## 問題描述

實作 native permission system 後，遇到兩個關鍵問題：

1. **Permission UI 立即消失**：Permission request UI 會短暫出現（<1秒），然後立即消失
2. **Always Allow 無效**：點擊 "Always Allow" 按鈕後，下次執行相同操作仍然會詢問權限

## Root Cause Analysis

### 問題 1：Permission UI 消失

#### 觀察到的行為
透過 debug log 追蹤，發現以下序列：
```
🔐 Permission request received: perm_xxx
🔐 Adding permission request to messages, prev count: 18
🔐 New messages count: 19
🔒 chatMessages count: 19 permission: 1  ← Permission 成功加入
👁️ visibleMessages count: 17 permission: 0  ← 立即被覆蓋！
🔒 chatMessages count: 17 permission: 0
```

#### Root Cause
在 `ChatInterface.jsx` 中發現一個 `useEffect`（line 3014-3018）：

```javascript
useEffect(() => {
  if (sessionMessages.length > 0) {
    setChatMessages(convertedMessages);  // ← 直接覆蓋整個 state！
  }
}, [convertedMessages, sessionMessages]);
```

**問題分析：**
1. Permission request 透過 WebSocket 即時加入 `chatMessages`
2. 它**不在** `sessionMessages` 中（因為還沒寫入 JSONL）
3. 當 `convertedMessages` 更新時（例如 Claude 回應），這個 useEffect 觸發
4. `chatMessages` 被 `convertedMessages` 直接覆蓋
5. Permission request 消失

**為什麼 `chatMessages` 會被覆蓋？**
- `chatMessages` 有兩個來源：
  - `convertedMessages` - 從 `sessionMessages`（JSONL）轉換來的歷史訊息
  - WebSocket 即時訊息 - 包括 permission requests、streaming 等
- 這個 useEffect 設計用來同步 JSONL 的變更到 UI
- 但它沒考慮到「還沒持久化的即時訊息」

#### 解決方案

修改 useEffect，在同步前先過濾並保留 **pending（未解決）** 的 permission requests：

```javascript
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

**為什麼只保留「未解決」的？**
- 用戶點擊按鈕後，`permissionResolved: true` 被設定
- 已解決的 permission 不需要再顯示
- 這樣可以避免 permission UI 跑到對話的下面（順序問題）

### 問題 2：Always Allow 無效

#### SDK suggestions 機制調查

當 `canUseTool` callback 被呼叫時，SDK 會傳入 `suggestions` 參數：

```javascript
canUseTool(toolName, input, { signal, suggestions, toolUseID })
```

從 log 發現：
```json
{
  "type": "addRules",
  "rules": [{ "toolName": "Write", "ruleContent": "//path/**" }],
  "behavior": "allow",
  "destination": "session"  // ← 問題在這！
}
```

**`destination` 的四種選項：**
- `"session"` - 只對當前 session 有效（不持久化）
- `"localSettings"` - 寫入 `.claude/settings.local.json`
- `"projectSettings"` - 寫入 `.claude/settings.json`
- `"userSettings"` - 寫入 `~/.claude/settings.json`

#### SDK vs 我們的 updatedPermissions

**SDK 傳來的 suggestions：**
```javascript
suggestions: [
  {
    type: "addRules",
    destination: "session"  // SDK 建議的
  }
]
```

**我們回傳的 updatedPermissions：**
```javascript
{
  behavior: 'allow',
  updatedInput: input,
  updatedPermissions: suggestions  // ← 直接用 SDK 的建議
}
```

**問題：**
如果我們直接用 SDK 的 suggestions，destination 是 `"session"`，授權不會持久化到設定檔。

#### 解決方案

在 "Always Allow" 按鈕的 handler 中，強制修改 `destination`：

```javascript
// Force destination to localSettings
const persistedPermissions = message.permissionData.suggestions.map(s => ({
  ...s,
  destination: 'localSettings'  // 強制持久化
}));

sendMessage({
  type: 'permission-response',
  requestId: message.permissionData.requestId,
  behavior: 'allow',
  updatedPermissions: persistedPermissions
});
```

**為什麼可以這樣做？**
- `suggestions` 是 SDK 的「建議」，`updatedPermissions` 是我們「實際採用」的
- 我們可以：
  - 完全採用 SDK 的 suggestions
  - 修改後再傳（例如改 destination）
  - 忽略 suggestions，傳空陣列 `[]`
  - 自己建立 permission rules

## 技術調查發現

### Permission 處理順序

根據 [Claude Agent SDK 文件](https://platform.claude.com/docs/en/agent-sdk/permissions)：

```
PreToolUse Hook → Deny Rules → Allow Rules → Ask Rules
→ Permission Mode Check → canUseTool Callback → PostToolUse Hook
```

### PermissionRequest Hook（TypeScript only）

SDK 提供 `PermissionRequest` hook，可以攔截 permission request 並修改 suggestions。但這是 **TypeScript SDK 專屬功能**，我們的 backend 用 Node.js，無法使用。

### 為什麼不把授權紀錄寫入 JSONL？

JSONL 是 **Claude Code CLI 自己產生和管理的**，我們只能讀取，無法（也不應該）寫入。

- JSONL 會記錄 `tool_use` 和 `tool_result`
- 但「用戶授權」這個動作本身不會被 CLI 記錄
- 如果要記錄授權歷史，只能在我們自己的 UI 層或資料庫

## 架構設計 Trade-offs

### Permission Requests 混在 chatMessages 的問題

**目前設計：**
- Permission requests 加入 `chatMessages` 陣列
- 與正常對話訊息混在一起

**優點：**
- 實作簡單，複用現有的 message rendering 邏輯
- 順序正確（按時間順序出現在對話中）

**缺點：**
- 需要特殊處理 state 同步（如本次修復）
- Permission requests 不會持久化到 JSONL
- 位置可能會跑掉（resolved 後被移除）

**替代方案（未採用）：**
- 用獨立的 state 管理 permission requests
- 獨立的 UI 區塊（不混在對話中）

**為什麼維持現狀？**
- 對話流程清晰（用戶看到「Claude 想做什麼」→「我允許」→「Claude 執行」）
- 修復後穩定，不需要大幅重構

## 修改檔案

### `/src/components/ChatInterface.jsx`

1. **修改 line 3014-3036**：保留 pending permission requests
   ```javascript
   const pendingPermissionRequests = prev.filter(
     m => m.isPermissionRequest && !m.permissionResolved
   );
   ```

2. **修改 line 2992-2999**：External message reload 時也保留
   ```javascript
   setChatMessages(prev => {
     const pendingPermissionRequests = prev.filter(
       m => m.isPermissionRequest && !m.permissionResolved
     );
     // ...
   });
   ```

3. **修改 line 1516-1520**：Always Allow 強制 localSettings
   ```javascript
   const persistedPermissions = message.permissionData.suggestions.map(s => ({
     ...s,
     destination: 'localSettings'
   }));
   ```

### `/server/claude-sdk.js`

**修改 line 438-441**：增加 suggestions 詳細 log
```javascript
if (suggestions && suggestions.length > 0) {
  console.log(`   Suggestions detail:`, JSON.stringify(suggestions, null, 2));
}
```

## 測試結果

### 測試步驟
1. 觸發 Write 權限請求（建立新檔案）
2. 觀察 permission UI 是否保持顯示 ✅
3. 點擊 "Always Allow" 按鈕
4. 檢查 `.claude/settings.local.json` 是否產生 ✅
5. 再次執行相同操作，確認不再詢問 ✅

### 驗證 Log
```
📌 Preserving 1 pending permission request(s) during convertedMessages sync
✅ Permission request perm_xxx resolved: allow
```

## Lessons Learned

### 1. React State 同步的陷阱
- 多個來源更新同一個 state 時，要小心覆蓋問題
- `useEffect` 的依賴鏈可能造成意外的重新執行
- 使用 `prev =>` callback 可以避免 race condition

### 2. SDK 抽象層級的理解
- SDK 的「建議」不等於「結果」
- 我們有權利修改 SDK 的建議
- 要讀文件了解每個參數的真正作用

### 3. Debug 策略
- 加入 debug log 追蹤 state 變化（count、timestamp）
- 對比「預期」vs「實際」的執行順序
- 用 console.log 確認 useEffect 觸發時機

### 4. 文件調查的重要性
- 花時間查 SDK 文件和 TypeScript 定義
- 發現 PermissionRequest hook（雖然無法用）
- 理解 destination 的四種選項和用途

## 後續計畫

### 短期
- [x] Permission UI 顯示穩定
- [x] Always Allow 持久化
- [ ] Permission mode 切換功能

### 長期考慮
- 是否要實作獨立的 permission state 管理？
- 是否要在 UI 顯示授權歷史？
- 是否要支援更細緻的權限控制（例如按路徑、按指令）？

## 參考資料

- [Claude Agent SDK - Handling Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Claude Agent SDK - TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK - Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Claude Code Settings - Permission Rules](https://code.claude.com/docs/en/settings#permission-settings)
