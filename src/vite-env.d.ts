/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IS_PLATFORM?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_CONTEXT_WINDOW?: string;
  // Add other env variables here
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  const __BUILD_TIME__: string;

  interface Window {
    refreshProjects?: () => void;
    openSettings?: () => void;
  }
}

export {};
