import { signal, computed } from '@preact/signals-react';

/**
 * Session Signals - 用 Preact Signals 管理 session state
 *
 * 優點：
 * - 沒有 closure 陷阱：.value 永遠是最新值
 * - 不需要 dependency array：自動追蹤依賴
 * - 細粒度更新：只有用到的組件才 re-render
 * - 沒有 selector 問題：不會因為 reference 變化觸發重渲染
 */

// === State ===

/**
 * 當前正在查看的 session ID
 */
export const currentSessionId = signal(null);

/**
 * Session 快取
 * 結構：{ sessionId: { messages: [], pagination: { offset, hasMore, total } } }
 */
export const sessionCache = signal({});

/**
 * LRU 存取順序（最近使用的在最後）
 */
export const accessOrder = signal([]);

/**
 * 最大快取 session 數量
 */
const MAX_CACHED_SESSIONS = 10;

// === Computed Values ===

/**
 * 當前 session 的消息
 */
export const currentMessages = computed(() => {
  const id = currentSessionId.value;
  if (!id) return [];
  return sessionCache.value[id]?.messages || [];
});

/**
 * 當前 session 的 pagination
 */
export const currentPagination = computed(() => {
  const id = currentSessionId.value;
  if (!id) return { offset: 0, hasMore: false, total: 0 };
  return sessionCache.value[id]?.pagination || { offset: 0, hasMore: false, total: 0 };
});

/**
 * 檢查 session 是否已快取
 */
export function isSessionCached(sessionId) {
  return sessionId in sessionCache.value;
}

// === Actions ===

/**
 * 切換到指定 session
 */
export function switchToSession(sessionId) {
  currentSessionId.value = sessionId;
  updateAccessOrder(sessionId);
}

/**
 * 設定 session 的消息（覆蓋）
 */
export function setSessionMessages(sessionId, messages, pagination = {}) {
  sessionCache.value = {
    ...sessionCache.value,
    [sessionId]: {
      messages,
      pagination: {
        offset: pagination.offset || 0,
        hasMore: pagination.hasMore || false,
        total: pagination.total || messages.length,
      },
    },
  };

  updateAccessOrder(sessionId);
  evictIfNeeded();
}

/**
 * 前置舊消息（載入更多）
 */
export function prependSessionMessages(sessionId, messages, pagination = {}) {
  const existing = sessionCache.value[sessionId];
  if (!existing) {
    // 如果不存在，就直接設定
    setSessionMessages(sessionId, messages, pagination);
    return;
  }

  sessionCache.value = {
    ...sessionCache.value,
    [sessionId]: {
      messages: [...messages, ...existing.messages],
      pagination: {
        offset: pagination.offset || 0,
        hasMore: pagination.hasMore || false,
        total: pagination.total || existing.messages.length,
      },
    },
  };

  updateAccessOrder(sessionId);
}

/**
 * 更新 pagination
 */
export function updatePagination(sessionId, pagination) {
  const existing = sessionCache.value[sessionId];
  if (!existing) return;

  sessionCache.value = {
    ...sessionCache.value,
    [sessionId]: {
      ...existing,
      pagination,
    },
  };
}

/**
 * 清除指定 session
 */
export function clearSession(sessionId) {
  const newCache = { ...sessionCache.value };
  delete newCache[sessionId];
  sessionCache.value = newCache;

  accessOrder.value = accessOrder.value.filter(id => id !== sessionId);
}

/**
 * 清除所有 session
 */
export function clearAllSessions() {
  sessionCache.value = {};
  accessOrder.value = [];
  currentSessionId.value = null;
}

// === Internal Functions ===

/**
 * 更新存取順序（LRU）
 */
function updateAccessOrder(sessionId) {
  if (!sessionId) return;

  const order = accessOrder.value.filter(id => id !== sessionId);
  order.push(sessionId); // 最近使用的放最後
  accessOrder.value = order;
}

/**
 * LRU 清理：超過上限時移除最久未使用的
 */
function evictIfNeeded() {
  const order = accessOrder.value;
  if (order.length <= MAX_CACHED_SESSIONS) return;

  // 移除最久未使用的（第一個）
  const toEvict = order[0];
  console.log(`🗑️ LRU evicting session: ${toEvict?.slice(0, 8)}`);

  clearSession(toEvict);
}
