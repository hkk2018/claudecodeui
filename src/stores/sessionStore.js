import { create } from 'zustand';

const MAX_CACHED_SESSIONS = 10;

/**
 * Session Store - 管理每個 Session 的原始消息（從 API/JSONL 載入）
 *
 * 設計說明：
 * - sessionData 存的是原始 JSONL 消息（sessionMessages）
 * - 這些消息會透過 convertSessionMessages() 轉換成顯示用的 chatMessages
 * - WebSocket 串流消息不存入 store，直接在 ChatInterface 中處理
 * - 採用 LRU 策略，最多快取 MAX_CACHED_SESSIONS 個 Session
 */
export const useSessionStore = create((set, get) => ({
  // 每個 Session 的原始消息：{ sessionId: { messages: [], lastAccess: timestamp, pagination: {...} } }
  sessionData: {},

  // 當前查看的 Session ID
  viewingSessionId: null,

  // LRU 順序追蹤（最近使用的在最後）
  accessOrder: [],

  // 設定完整消息列表（從 API 載入時）
  setSessionMessages: (sessionId, messages, pagination = {}) => {
    if (!sessionId) return;

    set((state) => ({
      sessionData: {
        ...state.sessionData,
        [sessionId]: {
          messages: messages || [],
          lastAccess: Date.now(),
          pagination: {
            offset: pagination.offset || 0,
            hasMore: pagination.hasMore || false,
            total: pagination.total || messages?.length || 0,
          },
        },
      },
    }));

    // 更新 LRU 順序並執行清理
    get()._updateAccessOrder(sessionId);
    get()._evictIfNeeded();
  },

  // 在消息列表前面插入更多消息（載入更舊的消息時）
  prependSessionMessages: (sessionId, messages, pagination = {}) => {
    if (!sessionId || !messages?.length) return;

    set((state) => {
      const existing = state.sessionData[sessionId] || {
        messages: [],
        lastAccess: Date.now(),
        pagination: { offset: 0, hasMore: false, total: 0 }
      };
      return {
        sessionData: {
          ...state.sessionData,
          [sessionId]: {
            messages: [...messages, ...existing.messages],
            lastAccess: Date.now(),
            pagination: {
              offset: pagination.offset ?? existing.pagination.offset,
              hasMore: pagination.hasMore ?? existing.pagination.hasMore,
              total: pagination.total ?? existing.pagination.total,
            },
          },
        },
      };
    });
  },

  // 切換 Session（只更新 viewingSessionId，不載入消息）
  switchSession: (sessionId) => {
    set({ viewingSessionId: sessionId });

    if (sessionId) {
      get()._updateAccessOrder(sessionId);
    }
  },

  // 取得當前 Session 的原始消息
  getCurrentSessionMessages: () => {
    const { sessionData, viewingSessionId } = get();
    return sessionData[viewingSessionId]?.messages || [];
  },

  // 取得當前 Session 的分頁資訊
  getCurrentPagination: () => {
    const { sessionData, viewingSessionId } = get();
    return sessionData[viewingSessionId]?.pagination || { offset: 0, hasMore: false, total: 0 };
  },

  // 取得指定 Session 的原始消息
  getSessionMessages: (sessionId) => {
    const { sessionData } = get();
    return sessionData[sessionId]?.messages || [];
  },

  // 取得指定 Session 的分頁資訊
  getPagination: (sessionId) => {
    const { sessionData } = get();
    return sessionData[sessionId]?.pagination || { offset: 0, hasMore: false, total: 0 };
  },

  // 檢查 Session 是否已快取
  isSessionCached: (sessionId) => {
    const { sessionData } = get();
    return sessionId in sessionData;
  },

  // 清除指定 Session
  clearSession: (sessionId) => {
    set((state) => {
      const newSessionData = { ...state.sessionData };
      delete newSessionData[sessionId];

      const newAccessOrder = state.accessOrder.filter((id) => id !== sessionId);

      return {
        sessionData: newSessionData,
        accessOrder: newAccessOrder,
      };
    });
  },

  // 清除所有 Session（例如登出時）
  clearAllSessions: () => {
    set({
      sessionData: {},
      viewingSessionId: null,
      accessOrder: [],
    });
  },

  // 更新分頁資訊
  updatePagination: (sessionId, pagination) => {
    if (!sessionId) return;

    set((state) => {
      const existing = state.sessionData[sessionId];
      if (!existing) return state;

      return {
        sessionData: {
          ...state.sessionData,
          [sessionId]: {
            ...existing,
            pagination: {
              ...existing.pagination,
              ...pagination,
            },
          },
        },
      };
    });
  },

  // 更新 LRU 存取順序（內部方法）
  _updateAccessOrder: (sessionId) => {
    set((state) => {
      const newOrder = state.accessOrder.filter((id) => id !== sessionId);
      newOrder.push(sessionId); // 最近使用的放最後
      return { accessOrder: newOrder };
    });
  },

  // LRU 清理（內部方法）
  _evictIfNeeded: () => {
    const { sessionData, accessOrder, viewingSessionId } = get();
    const cachedCount = Object.keys(sessionData).length;

    if (cachedCount <= MAX_CACHED_SESSIONS) return;

    // 找到要移除的 Session（最久未存取的，但不能是當前查看的）
    const toEvict = [];
    for (const sessionId of accessOrder) {
      if (sessionId !== viewingSessionId) {
        toEvict.push(sessionId);
        if (cachedCount - toEvict.length <= MAX_CACHED_SESSIONS) break;
      }
    }

    if (toEvict.length === 0) return;

    set((state) => {
      const newSessionData = { ...state.sessionData };
      const newAccessOrder = [...state.accessOrder];

      for (const sessionId of toEvict) {
        delete newSessionData[sessionId];
        const idx = newAccessOrder.indexOf(sessionId);
        if (idx !== -1) newAccessOrder.splice(idx, 1);
      }

      return {
        sessionData: newSessionData,
        accessOrder: newAccessOrder,
      };
    });

    console.log(`🗑️ Session LRU eviction: removed ${toEvict.length} session(s)`);
  },
}));
