import { useSignal, useSignalEffect } from '@preact/signals-react';
import { api } from '../utils/api';
import { uiSettings, updateUiSettings } from '../stores/uiSettings';

export default function IdeProjectBar({ desktopMode = false }: { desktopMode?: boolean } = {}) {
  const projects = useSignal([]);
  const loading = useSignal(false);
  const error = useSignal(null);
  const collapsed = useSignal(false);

  const fetchProjects = async () => {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.overlay.getIdeProjects();
      const data = await response.json();
      projects.value = data.projects || [];
    } catch (err) {
      error.value = err.message;
      console.error('Failed to fetch IDE projects:', err);
    } finally {
      loading.value = false;
    }
  };

  const handleFocus = async (windowId) => {
    try {
      const response = await api.overlay.focusIdeProject(windowId);
      const data = await response.json();
      if (!data.success) {
        console.error('Failed to focus window:', data.error);
      }
    } catch (err) {
      console.error('Failed to focus window:', err);
    }
  };

  const handleLaunchOverlay = async () => {
    try {
      const response = await api.overlay.launch();
      const data = await response.json();
      if (!data.success) {
        console.error('Failed to launch overlay:', data.error);
      }
    } catch (err) {
      console.error('Failed to launch overlay:', err);
    }
  };

  const handleHide = () => {
    updateUiSettings({ showIdeProjectBar: false });
  };

  useSignalEffect(() => {
    fetchProjects();
  });

  // Hidden via settings (only in normal mode)
  if (!desktopMode && !uiSettings.value.showIdeProjectBar) {
    return null;
  }

  // Desktop mode: simplified layout, no collapse/hide, bigger tags
  if (desktopMode) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        {/* Project buttons - bigger */}
        <div className="flex gap-2 flex-1 overflow-x-auto scrollbar-hide">
          {loading.value && projects.value.length === 0 ? (
            <span className="text-sm text-muted-foreground">Loading...</span>
          ) : error.value ? (
            <span className="text-sm text-destructive">Error loading IDE windows</span>
          ) : projects.value.length === 0 ? (
            <span className="text-sm text-muted-foreground">No IDE windows</span>
          ) : (
            projects.value.map((project) => (
              <button
                key={project.window_id}
                onClick={() => handleFocus(project.window_id)}
                className="px-3 py-1.5 text-sm bg-background hover:bg-primary/10 border border-border hover:border-primary rounded-md transition-colors flex-shrink-0"
                title={project.window_title}
              >
                {project.project_name}
              </button>
            ))
          )}
        </div>

        {/* Refresh only */}
        <button
          onClick={fetchProjects}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors flex-shrink-0"
          disabled={loading.value}
          title="Refresh IDE windows"
        >
          <svg className={`w-4 h-4 ${loading.value ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    );
  }

  // Normal mode: original layout with collapse/hide
  if (collapsed.value) {
    return (
      <div className="flex items-center justify-between px-2 py-0.5 bg-muted/50 border-b border-border">
        <button
          onClick={() => { collapsed.value = false; }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          title="Expand IDE project bar"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          IDE
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/50 border-b border-border">
      {/* Collapse button */}
      <button
        onClick={() => { collapsed.value = true; }}
        className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors flex-shrink-0"
        title="Collapse"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Project buttons */}
      <div className="flex gap-1.5 flex-1 overflow-x-auto scrollbar-hide">
        {loading.value && projects.value.length === 0 ? (
          <span className="text-xs text-muted-foreground">Loading...</span>
        ) : error.value ? (
          <span className="text-xs text-destructive">Error loading IDE windows</span>
        ) : projects.value.length === 0 ? (
          <span className="text-xs text-muted-foreground">No IDE windows</span>
        ) : (
          projects.value.map((project) => (
            <button
              key={project.window_id}
              onClick={() => handleFocus(project.window_id)}
              className="px-2 py-1 text-xs bg-background hover:bg-primary/10 border border-border hover:border-primary rounded transition-colors flex-shrink-0"
              title={project.window_title}
            >
              {project.project_name}
            </button>
          ))
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Refresh */}
        <button
          onClick={fetchProjects}
          className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          disabled={loading.value}
          title="Refresh IDE windows"
        >
          <svg className={`w-3.5 h-3.5 ${loading.value ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        {/* Launch overlay window */}
        <button
          onClick={handleLaunchOverlay}
          className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Launch overlay window (Chrome app mode + always-on-top)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>

        {/* Hide bar */}
        <button
          onClick={handleHide}
          className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Hide IDE project bar"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
