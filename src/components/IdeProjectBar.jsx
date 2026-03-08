import { useSignal, useSignalEffect } from '@preact/signals-react';
import { api } from '../utils/api';

export default function IdeProjectBar() {
  const projects = useSignal([]);
  const loading = useSignal(false);
  const error = useSignal(null);

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

  const handleFocus = async (windowId, projectName) => {
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

  // Fetch on mount
  useSignalEffect(() => {
    fetchProjects();
  });

  if (loading.value && projects.value.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-light border-b border-border text-sm text-foreground/60">
        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span>Loading IDE projects...</span>
      </div>
    );
  }

  if (error.value) {
    return (
      <div className="flex items-center justify-between px-3 py-2 bg-surface-light border-b border-border text-sm">
        <span className="text-destructive">Failed to load IDE projects</span>
        <button
          onClick={fetchProjects}
          className="px-2 py-1 text-xs bg-surface hover:bg-surface-hover rounded transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (projects.value.length === 0) {
    return (
      <div className="flex items-center justify-between px-3 py-2 bg-surface-light border-b border-border text-sm text-foreground/60">
        <span>No IDE windows found</span>
        <button
          onClick={fetchProjects}
          className="px-2 py-1 text-xs bg-surface hover:bg-surface-hover rounded transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-light border-b border-border overflow-x-auto">
      <span className="text-xs text-foreground/60 flex-shrink-0">IDE Projects:</span>
      <div className="flex gap-2 flex-1">
        {projects.value.map((project) => (
          <button
            key={project.window_id}
            onClick={() => handleFocus(project.window_id, project.project_name)}
            className="px-3 py-1.5 text-sm bg-surface hover:bg-primary/10 border border-border hover:border-primary rounded transition-colors flex-shrink-0 flex items-center gap-2"
            title={project.window_title}
          >
            <span className="font-medium">{project.project_name}</span>
            <span className="text-xs text-foreground/50">
              {project.editor_type === 'cursor' ? '⚡' : '📝'}
            </span>
          </button>
        ))}
      </div>
      <button
        onClick={fetchProjects}
        className="px-2 py-1 text-xs bg-surface hover:bg-surface-hover rounded transition-colors flex-shrink-0"
        disabled={loading.value}
      >
        {loading.value ? '...' : '🔄'}
      </button>
    </div>
  );
}
