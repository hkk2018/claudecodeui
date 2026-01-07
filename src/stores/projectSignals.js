import { signal, computed } from '@preact/signals-react';

/**
 * Project Signals - 用 Preact Signals 管理 projects state
 *
 * 設計目標：
 * - 快速首次顯示：先載入 basic info，sessions 漸進載入
 * - 避免 UI 跳動：Signal 細粒度更新，不會整體 re-render
 * - 最近修改優先：依 lastModified 排序，近期專案先顯示 sessions
 */

// === State ===

/**
 * 專案列表（基本資訊）
 * 結構：[{ name, displayName, fullPath, lastModified, ... }]
 */
export const projects = signal([]);

/**
 * 各專案的 sessions 載入狀態
 * 結構：{ projectName: { sessions: [], cursorSessions: [], loaded: boolean, loading: boolean } }
 */
export const projectSessions = signal({});

/**
 * 當前選中的專案
 */
export const selectedProject = signal(null);

/**
 * 當前選中的 session
 */
export const selectedSession = signal(null);

/**
 * 整體載入狀態
 */
export const isLoadingProjects = signal(true);

// === Computed Values ===

/**
 * 合併後的完整專案列表（含 sessions）
 * 這個 computed 會在 projects 或 projectSessions 變化時自動更新
 */
export const projectsWithSessions = computed(() => {
  return projects.value.map(p => {
    const sessionData = projectSessions.value[p.name];
    return {
      ...p,
      sessions: sessionData?.sessions || [],
      cursorSessions: sessionData?.cursorSessions || [],
      sessionsLoaded: sessionData?.loaded || false,
      sessionsLoading: sessionData?.loading || false,
      sessionMeta: sessionData?.meta || { hasMore: false, total: 0 }
    };
  });
});

/**
 * 當前選中的專案（含完整 sessions）
 */
export const selectedProjectWithSessions = computed(() => {
  if (!selectedProject.value) return null;
  const projectName = selectedProject.value.name;
  return projectsWithSessions.value.find(p => p.name === projectName) || null;
});

// === Actions ===

/**
 * 設定專案列表（基本資訊）
 */
export function setProjects(list) {
  projects.value = list;
}

/**
 * 設定專案的 sessions（載入完成）
 */
export function setProjectSessions(projectName, data) {
  projectSessions.value = {
    ...projectSessions.value,
    [projectName]: {
      sessions: data.sessions || [],
      cursorSessions: data.cursorSessions || [],
      meta: data.meta || { hasMore: false, total: 0 },
      loaded: true,
      loading: false
    }
  };
}

/**
 * 標記專案 sessions 正在載入
 */
export function setProjectSessionsLoading(projectName) {
  projectSessions.value = {
    ...projectSessions.value,
    [projectName]: {
      ...projectSessions.value[projectName],
      sessions: projectSessions.value[projectName]?.sessions || [],
      cursorSessions: projectSessions.value[projectName]?.cursorSessions || [],
      loaded: false,
      loading: true
    }
  };
}

/**
 * 選擇專案
 */
export function selectProject(project) {
  selectedProject.value = project;
}

/**
 * 選擇 session
 */
export function selectSession(session) {
  selectedSession.value = session;
}

/**
 * 設定載入狀態
 */
export function setLoadingProjects(loading) {
  isLoadingProjects.value = loading;
}

/**
 * 更新單一專案的資料（用於 WebSocket 更新）
 */
export function updateProject(projectName, updates) {
  projects.value = projects.value.map(p =>
    p.name === projectName ? { ...p, ...updates } : p
  );
}

/**
 * 重設所有 state（登出或清除時用）
 */
export function resetProjectState() {
  projects.value = [];
  projectSessions.value = {};
  selectedProject.value = null;
  selectedSession.value = null;
  isLoadingProjects.value = true;
}
