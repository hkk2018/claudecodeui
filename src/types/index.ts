// Common types for the application

export interface Project {
  name: string;
  id?: string;
  sessions?: Session[];
  cursorSessions?: Session[];
  sessionMeta?: Record<string, any>;
}

export interface Session {
  id: string;
  name?: string;
  sessionMeta?: {
    title?: string;
    lastModified?: string;
  };
  __provider?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  images?: string[];
  files?: FileAttachment[];
  tool_calls?: ToolCall[];
  thinking?: string;
}

export interface FileAttachment {
  name: string;
  path: string;
  type?: string;
  size?: number;
}

export interface ToolCall {
  id: string;
  type: string;
  function?: {
    name: string;
    arguments: string;
  };
}

export interface ApiKey {
  id: number;
  apiKey: string;
  key_name: string;
  api_key: string;
  created_at: string;
  last_used?: string;
  is_active: boolean;
}

export interface Credential {
  id: number;
  credential_name: string;
  created_at: string;
  is_active: boolean;
}

export interface GitHubNotification {
  id: string;
  title: string;
  body?: string;
  htmlUrl: string;
}

export interface FileUpdate {
  type: 'file-update';
  changedFile: string;
  id: string;
}

export interface WebSocketMessage {
  type: string;
  changedFile?: string;
  id?: string;
  projects?: Project[];
  [key: string]: any;
}
