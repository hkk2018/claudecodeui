export interface Project {
  name: string;
  fullPath: string;
  sessions?: Session[];
  sessionMeta?: any;
  cursorSessions?: any[];
  sessionsLoaded?: boolean;
}

export interface Session {
  id: string;
  projectName: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  __provider?: string;
}

export interface FileUpdate {
  path: string;
  content?: string;
  action?: string;
}

export interface GitHubNotification {
  id: string;
  type: string;
  title: string;
  url: string;
  unread: boolean;
}

export interface WebSocketMessage {
  type: string;
  data?: any;
  [key: string]: any;
}
