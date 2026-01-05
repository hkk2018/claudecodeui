---
title: "React useEffect Closure 陷阱分析"
description: "分析 ChatInterface 組件中 useEffect closure 導致的無限循環問題"
last_modified: "2026-01-06 02:52"
---

# React useEffect Closure 陷阱分析

## 問題現象

切換 Session 時畫面瘋狂閃爍，console 顯示同一個 session 被重複載入數百次：

```
📦 Session 8479d2b7 loaded from cache (20 messages)
📦 Session 8479d2b7 loaded from cache (20 messages)
📦 Session 8479d2b7 loaded from cache (20 messages)
... (重複數百次)
```

## 問題根源

### Closure 捕獲舊值

```javascript
const [currentSessionId, setCurrentSessionId] = useState(null);

useEffect(() => {
  const loadMessages = async () => {
    // currentSessionId 是 closure 捕獲的值
    // 是「建立這個 effect 時」的值，不是「執行時」的最新值
    const sessionChanged = currentSessionId !== selectedSession.id;

    if (!sessionChanged) {
      // 因為 currentSessionId 是舊值，這個判斷可能錯誤
      setCurrentSessionId(selectedSession.id);
      setSessionMessages(cachedMessages);  // 觸發 re-render
    }
  };

  loadMessages();
}, [selectedSession, selectedProject]);  // currentSessionId 不在 dependency
```

### 時序分析

```
1. 初始狀態：currentSessionId = null
2. useEffect 建立，closure 捕獲 currentSessionId = null
3. 使用者點擊 Session A
4. selectedSession 變化 → effect 執行
5. effect 內 currentSessionId 是 null（closure 舊值）
6. setCurrentSessionId('session-a') → state 更新為 'session-a'
7. setSessionMessages(messages) → 觸發 re-render
8. re-render 時 currentSessionId = 'session-a'（最新值）
9. 但 effect 的 closure 還是舊的（因為 dependency 沒包含 currentSessionId）
10. 如果有其他原因觸發 effect 重新執行...
11. effect 內 currentSessionId 還是 null → 判斷錯誤 → 又載入 → 循環
```

## 兩難困境

### 選項 A：不放 dependency

```javascript
useEffect(() => {
  // currentSessionId 是舊值
  const sessionChanged = currentSessionId !== selectedSession.id;
}, [selectedSession]);  // currentSessionId 不在 dependency
```

**問題**：closure 捕獲舊值，判斷錯誤

### 選項 B：放進 dependency

```javascript
useEffect(() => {
  setCurrentSessionId(selectedSession.id);  // 更新 currentSessionId
}, [selectedSession, currentSessionId]);    // currentSessionId 在 dependency
```

**問題**：
1. effect 執行 → `setCurrentSessionId()`
2. `currentSessionId` 變了 → dependency 變化
3. effect 又執行 → 無限循環

## 解決方案

### 使用 Ref 追蹤

```javascript
const lastLoadedSessionRef = useRef(null);

useEffect(() => {
  const loadMessages = async () => {
    // 用 ref 檢查是否已載入，避免重複
    if (lastLoadedSessionRef.current === selectedSession.id) {
      return;  // 已載入過，跳過
    }
    lastLoadedSessionRef.current = selectedSession.id;

    // ... 載入邏輯
  };

  loadMessages();
}, [selectedSession, selectedProject]);
```

**為什麼 ref 可以解決**：
- `ref.current` 永遠是即時的最新值，不受 closure 影響
- 修改 `ref.current` 不會觸發 re-render
- 不需要放進 dependency array

## React Hooks 的心智負擔

這個問題暴露了 React Hooks 設計的幾個痛點：

| 問題 | 說明 |
|------|------|
| Closure 陷阱 | useEffect 內的值可能是舊的 |
| Dependency 管理 | 漏了會 bug，多了會無限循環 |
| Hooks 規則 | 不能在條件/迴圈裡呼叫 |
| Reference 不穩定 | 到處需要 useCallback/useMemo |
| 隱式錯誤 | 寫錯不會報錯，只會 runtime 出問題 |

## 對比 Vue

Vue 的響應式系統沒有這些問題：

```javascript
// Vue - 直接寫，不用想 closure、dependency
watch(selectedSession, (newSession) => {
  // newSession 永遠是最新值
  // 不需要 dependency array
  // 不需要 ref workaround
  loadMessages(newSession.id);
});
```

## 結論

React 的 function component + hooks 設計，把複雜度轉嫁給開發者。每個 useEffect 都是潛在的 closure 陷阱，需要非常小心地管理 dependency array。

**建議**：
1. 優先使用 ref 來追蹤「不需要觸發 re-render」的值
2. 考慮使用 Signals 來避免這類問題
3. 複雜的 state 邏輯考慮抽成 custom hook，集中管理
