---
title: "Claude Code UI 系統架構概覽"
description: "完整的系統架構文檔，包含初始化流程、對話切換機制、WebSocket 通訊等核心流程"
last_modified: "2025-12-20 16:36"
---

# Claude Code UI 系統架構概覽

本文檔說明 Claude Code UI 的核心架構、關鍵流程與組件交互關係。

---

# 專案結構

```
claudecodeui/
├── src/                          # 前端 React 應用
│   ├── main.jsx                  # 應用入口點
│   ├── App.jsx                   # 根組件，狀態管理中樞
│   ├── components/
│   │   ├── ChatInterface.jsx     # 核心聊天介面 (3850+ 行)
│   │   ├── Sidebar.jsx           # 側邊欄，專案/對話列表
│   │   ├── MainContent.jsx       # 主內容區域 wrapper
│   │   └── ...
│   ├── contexts/
│   │   └── WebSocketContext.jsx  # WebSocket 狀態管理
│   └── utils/
│       └── websocket.js          # WebSocket hook
│
├── server/                       # 後端 Node.js 服務
│   ├── index.js                  # 主服務入口 (950+ 行)
│   ├── claude-sdk.js             # Claude SDK 整合
│   ├── projects.js               # 專案管理 API
│   └── ...
│
└── dist/                         # 建置輸出
```

---

# 前端初始化流程

## 1. 應用啟動 (main.jsx)

```
瀏覽器載入 index.html
    ↓
main.jsx 執行
    ↓
清理舊版 Service Worker (防止快取問題)
    ↓
註冊新 Service Worker (Network-First 策略)
    ↓
掛載 React 應用到 DOM
```

## 2. Provider 層級結構 (App.jsx)

```jsx
<ThemeProvider>           // 深色/淺色模式
  <AuthProvider>          // 認證狀態
    <WebSocketProvider>   // WebSocket 連線
      <TasksSettingsProvider>
        <TaskMasterProvider>
          <ProtectedRoute>
            <Router>
              {/* 實際應用內容 */}
            </Router>
          </ProtectedRoute>
        </TaskMasterProvider>
      </TasksSettingsProvider>
    </WebSocketProvider>
  </AuthProvider>
</ThemeProvider>
```

## 3. App.jsx 核心狀態

| 狀態名稱 | 類型 | 用途 |
|---------|------|------|
| `selectedProject` | Object | 當前選中的專案 |
| `selectedSession` | Object | 當前選中的對話 |
| `projects` | Array | 所有專案列表 (含 sessions) |
| `activeSessions` | Set | **Session Protection** - 正在進行對話的 session ID |
| `processingSessions` | Set | 正在處理/思考中的 session ID |
| `isSwitchingSession` | Boolean | 切換對話時的 loading 狀態 |
| `externalMessageUpdate` | Object | 外部 CLI 更新觸發器 |

---

# 組件層級關係

```
App.jsx (根組件，狀態管理)
│
├── Sidebar.jsx (1440 行)
│   ├── 專案列表 (可展開/收合)
│   ├── 對話列表 (分頁載入)
│   ├── 搜尋/篩選
│   └── handleSessionClick() → 觸發對話切換
│
├── MainContent.jsx (708 行，傳遞層)
│   └── ChatInterface.jsx (3850+ 行，核心聊天邏輯)
│       ├── 訊息輸入框 (含自動完成)
│       ├── 訊息顯示區 (串流支援)
│       ├── 工具使用視覺化
│       ├── 權限請求處理
│       ├── @ 檔案選擇器
│       ├── / 斜線命令選單
│       └── WebSocket 訊息處理 (大型 switch)
│
├── FileTree.jsx
├── CodeEditor.jsx
├── GitPanel.jsx
├── StandaloneShell.jsx
└── TaskList.jsx
```

---

# 對話切換流程 (Session Switch)

這是最常出現問題的流程，完整步驟如下：

## 正常流程

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: 用戶點擊側邊欄的對話項目                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
    Sidebar.handleSessionClick(session, projectName)
                              ↓
    呼叫 onSessionSelect({ ...session, __projectName: projectName })
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: App.jsx handleSessionSelect() 處理                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
    setIsSwitchingSession(true)  ← 顯示 loading overlay
                              ↓
    setSelectedSession(session)
                              ↓
    navigate(`/session/${session.id}`)  ← URL 變更
                              ↓
    setActiveTab('chat')
                              ↓
    setTimeout(() => setIsSwitchingSession(false), 500)  ⚠️ 問題點
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: ChatInterface 偵測 selectedSession 變更                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
    useEffect 觸發，偵測到 selectedSession.id 變更
                              ↓
    呼叫 loadSessionMessages(projectName, sessionId)
                              ↓
    API: GET /api/projects/{name}/sessions/{id}/messages
                              ↓
    設定 chatMessages 狀態
                              ↓
    呼叫 onSessionLoaded() callback
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: UI 更新完成                                              │
└─────────────────────────────────────────────────────────────────┘
```

## 已知問題：切換沒反應

### 問題 1: 500ms 固定 Timeout

**位置**: App.jsx handleSessionSelect()

```javascript
// 問題程式碼
setIsSwitchingSession(true);
// ... 設定狀態
setTimeout(() => setIsSwitchingSession(false), 500);  // ⚠️ 固定時間
```

**問題**:
- 如果訊息載入超過 500ms，overlay 消失但訊息還在載入
- 如果載入很快 (<500ms)，用戶需要無謂等待

**應該的做法**: 使用 `onSessionLoaded()` callback 而非固定 timeout

### 問題 2: 快速連續點擊

如果用戶快速點擊兩個不同的對話：

```
點擊 Session A → 開始載入 A
點擊 Session B → 開始載入 B
A 載入完成 → 設定 chatMessages 為 A 的訊息
B 載入完成 → 設定 chatMessages 為 B 的訊息 (正確)
```

但如果 A 載入較慢：

```
點擊 Session A → 開始載入 A
點擊 Session B → 開始載入 B
B 載入完成 → 設定 chatMessages 為 B 的訊息
A 載入完成 → 設定 chatMessages 為 A 的訊息 (錯誤！)
```

**應該的做法**: 在 loadSessionMessages 中檢查 sessionId 是否仍為當前選中

### 問題 3: activeSessions 干擾

如果前一個對話仍在 `activeSessions` 中（例如回應還在串流），切換可能被 Session Protection 機制阻擋。

---

# WebSocket 通訊架構

## 連線建立

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (WebSocketContext.jsx)                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
    建立 WebSocket 連線: ws://localhost:9001/ws?token=xxx
                              ↓
    認證: token 在 query param 或 header
                              ↓
    連線成功後設定 isConnected = true
                              ↓
    斷線時自動重連 (3 秒延遲)
```

## 訊息類型

### 前端 → 後端

| 類型 | 用途 |
|------|------|
| `claude-request` | 發送用戶訊息給 Claude |
| `cursor-request` | 發送用戶訊息給 Cursor |
| `abort-request` | 中止當前對話 |
| `shell-input` | 終端機輸入 |

### 後端 → 前端

| 類型 | 用途 | 處理位置 |
|------|------|---------|
| `session-created` | 新對話 ID (取代臨時 ID) | ChatInterface |
| `claude-response` | Claude 回應 (串流/完整) | ChatInterface |
| `claude-output` | 串流文字輸出 | ChatInterface |
| `claude-complete` | 對話完成 | ChatInterface |
| `claude-error` | 錯誤訊息 | ChatInterface |
| `permission-request` | 權限請求 UI | ChatInterface |
| `projects_updated` | 專案/對話列表更新 | **App.jsx** |
| `cursor-*` | Cursor 相關訊息 | ChatInterface |

## ChatInterface 訊息過濾邏輯

**位置**: ChatInterface.jsx 第 3112-3124 行

```javascript
// 防止跨 session 訊息干擾
if (messageSessionId && messageSessionId !== currentSessionId) {
  // 訊息屬於其他 session，忽略
  return;
}

// 新對話 (currentSessionId=null) 拒絕任何有 sessionId 的訊息
if (!currentSessionId && messageSessionId) {
  return;
}
```

---

# Session Protection 機制

這是防止對話進行中被外部更新打斷的保護機制。

## 運作流程

```
┌─────────────────────────────────────────────────────────────────┐
│  1. 用戶發送訊息                                                  │
└─────────────────────────────────────────────────────────────────┘
    ChatInterface.handleSubmit()
        ↓
    onSessionActive(sessionId)  // 或 "new-session-<uuid>" (新對話)
        ↓
    App.jsx: activeSessions.add(sessionId)
        ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. 外部檔案變更觸發更新                                          │
└─────────────────────────────────────────────────────────────────┘
    chokidar 偵測到 ~/.claude/projects 變更
        ↓
    300ms debounce
        ↓
    WebSocket 廣播: projects_updated
        ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. App.jsx 過濾更新                                              │
└─────────────────────────────────────────────────────────────────┘
    if (activeSessions.has(selectedSession.id)) {
      // 對話進行中，檢查是否為純新增更新
      if (!isUpdateAdditive(oldProjects, newProjects)) {
        return;  // 跳過更新，保護當前對話
      }
    }
    // 只允許純新增更新 (新對話在側邊欄顯示)
    setProjects(newProjects);
        ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. 對話完成                                                      │
└─────────────────────────────────────────────────────────────────┘
    WebSocket: claude-complete
        ↓
    ChatInterface: onSessionInactive(sessionId)
        ↓
    App.jsx: activeSessions.delete(sessionId)
        ↓
    後續更新不再被阻擋
```

## 臨時 Session ID 處理

新對話在收到真正的 session ID 前，使用臨時 ID：

```
用戶發送訊息 (新對話)
    ↓
tempId = "new-session-<uuid>"
    ↓
onSessionActive(tempId)
    ↓
WebSocket 廣播 claude-request
    ↓
... Claude 處理中 ...
    ↓
WebSocket 收到: session-created { sessionId: "real-id-123" }
    ↓
onReplaceTemporarySession("real-id-123")
    ↓
App.jsx:
    activeSessions.delete("new-session-*")
    activeSessions.add("real-id-123")
```

---

# 訊息串流與緩衝

## 串流緩衝機制

**位置**: ChatInterface.jsx

```javascript
// 小訊息塊累積
streamBufferRef.current += decodedText;

// 100ms 批次更新 (防止過度渲染)
if (!streamTimerRef.current) {
  streamTimerRef.current = setTimeout(() => {
    const chunk = streamBufferRef.current;
    streamBufferRef.current = '';
    streamTimerRef.current = null;

    // 更新最後一條 assistant 訊息
    setChatMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.isStreaming) {
        last.content += chunk;
      } else {
        prev.push({
          type: 'assistant',
          content: chunk,
          isStreaming: true
        });
      }
      return [...prev];
    });
  }, 100);
}
```

---

# localStorage 持久化策略

## 使用的 Keys

| Key | 用途 | 限制 |
|-----|------|------|
| `chat_messages_<projectName>` | 對話訊息快取 | 最多 50 條 |
| `draft_input_<projectName>` | 未送出的草稿 | - |
| `permissionMode-<sessionId>` | 權限模式 | - |
| `starredProjects` | 星號專案 | - |
| `selected-provider` | claude/cursor | - |

## Quota 超出處理

```javascript
try {
  localStorage.setItem(key, value);
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    // 1. 清除舊對話 (保留最近 3 個)
    clearOldChatData();

    // 2. 如果還是失敗，清除草稿
    clearDraftInputs();

    // 3. 最後手段：只保存 10 條訊息
    saveReducedMessages();
  }
}
```

---

# 後端架構

## 服務入口 (server/index.js)

```
Express.js HTTP Server
    ├── 靜態檔案服務 (dist/)
    ├── API 路由
    │   ├── /api/projects/*     (projects.js)
    │   ├── /api/claude/*       (claude-sdk.js)
    │   ├── /api/cursor/*       (cursor-cli.js)
    │   ├── /api/git/*
    │   ├── /api/auth/*
    │   ├── /api/settings/*
    │   └── ...
    │
    └── WebSocket Server (/ws)
            ├── 認證處理
            ├── 訊息路由
            └── 廣播機制
```

## 檔案監控 (chokidar)

```javascript
chokidar.watch('~/.claude/projects', {
  ignored: ['node_modules', '.git', 'dist', 'build', ...],
  depth: 10,
  awaitWriteFinish: {
    stabilityThreshold: 100,  // 等待寫入穩定
    pollInterval: 50
  }
});

// 變更時廣播
watcher.on('all', debounce(() => {
  const projects = getProjects();
  broadcast({
    type: 'projects_updated',
    projects,
    timestamp: new Date().toISOString(),
    changeType: 'add|change|unlink',
    changedFile: 'relative/path'
  });
}, 300));
```

---

# 對話切換問題深入分析

這一節詳細分析「點擊對話沒反應」可能的原因。

## 時序圖：正常切換流程

```
Time →

User clicks session in Sidebar
    │
    ▼
Sidebar.handleSessionClick()
    │
    ▼
App.jsx handleSessionSelect()
    ├── setIsSwitchingSession(true)      ← 顯示 loading overlay
    ├── setSelectedSession(session)
    ├── navigate(`/session/${id}`)
    └── setTimeout(() => setIsSwitchingSession(false), 500)  ← 問題！
    │
    ▼
ChatInterface useEffect 觸發 (2878-2981 行)
    ├── 偵測 selectedSession 變更
    ├── 判斷 provider (claude/cursor)
    ├── 設定 currentSessionId
    └── loadSessionMessages() (async)
            │
            ├── API 請求中...
            │   (可能 > 500ms)
            │
            ▼
        finally 區塊
            └── onSessionLoaded()     ← 清除 overlay
```

## 問題 1: 500ms Timeout vs onSessionLoaded 競爭

**程式碼位置**: App.jsx:373 vs ChatInterface.jsx:2326

```javascript
// App.jsx - 固定 500ms timeout
setTimeout(() => setIsSwitchingSession(false), 500);

// ChatInterface.jsx - 實際載入完成
finally {
  if (onSessionLoaded) {
    onSessionLoaded();  // 也會 setIsSwitchingSession(false)
  }
}
```

**問題情境**:
- 如果 API 回應 < 500ms: overlay 正確消失
- 如果 API 回應 > 500ms: overlay 在 500ms 時消失，但訊息還在載入
- 兩者都會呼叫 `setIsSwitchingSession(false)`，造成重複呼叫

## 問題 2: isSystemSessionChange 狀態殘留

**程式碼位置**: ChatInterface.jsx:2933, 2947

```javascript
// 問題：如果 isSystemSessionChange 為 true，會跳過載入
if (!isSystemSessionChange) {
  const messages = await loadSessionMessages(...);
  ...
} else {
  setIsSystemSessionChange(false);  // 只是重設，沒有載入訊息
}
```

**問題情境**:
如果前一次是 system-initiated change 且沒有正確清除 flag，
下一次用戶點擊切換時會被跳過載入。

## 問題 3: currentSessionId 比較邏輯

**程式碼位置**: ChatInterface.jsx:2888

```javascript
const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;
```

**問題情境**:
- 如果 `currentSessionId === null`（初始狀態），`sessionChanged` 永遠是 false
- 這會導致跳過某些重設邏輯

## 問題 4: 快速連續點擊 (Race Condition)

**程式碼位置**: ChatInterface.jsx:2878-2981

```javascript
useEffect(() => {
  const loadMessages = async () => {
    // 沒有 cleanup 或 abort controller
    const messages = await loadSessionMessages(...);
    setSessionMessages(messages);  // 可能設定錯誤的 session 訊息
  };
  loadMessages();
}, [selectedSession, ...]);
```

**問題情境**:
```
T=0:   點擊 Session A → 開始載入 A
T=100: 點擊 Session B → 開始載入 B (A 仍在載入)
T=300: B 載入完成 → 設定訊息為 B ✓
T=500: A 載入完成 → 設定訊息為 A ✗ (覆蓋了 B)
```

**修復建議**: 加入 AbortController 或檢查 session ID

```javascript
useEffect(() => {
  let cancelled = false;
  const loadMessages = async () => {
    const messages = await loadSessionMessages(...);
    if (!cancelled && selectedSession.id === currentSessionId) {
      setSessionMessages(messages);
    }
  };
  loadMessages();
  return () => { cancelled = true; };
}, [selectedSession, ...]);
```

## 問題 5: activeSessions 阻擋更新

**程式碼位置**: App.jsx:174-250

如果前一個 session 還在 `activeSessions` 中（例如正在等待回應），
project updates 會被阻擋，包括新 session 的資訊。

**檢查方法**:
```javascript
console.log('activeSessions:', [...activeSessions]);
console.log('selectedSession.id:', selectedSession?.id);
console.log('is active:', activeSessions.has(selectedSession?.id));
```

## 問題 6: WebSocket 訊息過濾

**程式碼位置**: ChatInterface.jsx:3112-3124

```javascript
// 跨 session 訊息過濾
if (messageSessionId && messageSessionId !== currentSessionId) {
  return;  // 忽略其他 session 的訊息
}
```

**問題情境**:
如果 `currentSessionId` 更新延遲，新 session 的訊息可能被過濾掉。

---

# 調試建議

## 快速診斷：對話切換問題

在瀏覽器 Console 貼入以下程式碼，然後點擊切換對話：

```javascript
// 1. 監控 App.jsx 狀態變化
const originalSetState = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner.current;

// 2. 在 ChatInterface 加入 debug log
// 找到 ChatInterface.jsx:2878 的 useEffect，加入：
console.log('[Session Switch Debug]', {
  selectedSession: selectedSession?.id,
  currentSessionId,
  isSystemSessionChange,
  timestamp: new Date().toISOString()
});

// 3. 檢查 activeSessions (在 App.jsx 加入)
console.log('[Active Sessions]', [...activeSessions]);
```

## 對話切換問題

1. **檢查 Console**:
   - 搜尋 `handleSessionSelect` 或 `loadSessionMessages`
   - 確認 API 呼叫是否成功

2. **檢查 Network Tab**:
   - `/api/projects/*/sessions/*/messages` 請求
   - 確認回應時間

3. **檢查 activeSessions**:
   - 在 App.jsx 加入 `console.log('activeSessions:', activeSessions)`
   - 確認是否有殘留的 session ID

## WebSocket 問題

1. **檢查連線狀態**:
   - `isConnected` 狀態
   - 瀏覽器 DevTools → Network → WS

2. **訊息過濾**:
   - 在 ChatInterface 的 switch 語句加入 log
   - 確認訊息是否被過濾掉

---

# 效能優化

## 已實作

- **MessageComponent 記憶化**: 防止父層更新觸發子層重渲染
- **串流批次更新**: 100ms 間隔合併小訊息
- **分頁載入**: 側邊欄對話列表、訊息載入
- **虛擬化**: 超過 100 條訊息時啟用
- **工具結果摺疊**: Grep/Glob 結果預設最小化

## 建議改進

- 使用 `onSessionLoaded` callback 取代固定 500ms timeout
- 在 `loadSessionMessages` 中加入 race condition 保護
- 考慮使用 React Query 管理 API 快取
