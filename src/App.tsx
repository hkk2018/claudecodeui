/*
 * App.jsx - Main Application Component with Session Protection System
 * 
 * SESSION PROTECTION SYSTEM OVERVIEW:
 * ===================================
 * 
 * Problem: Automatic project updates from WebSocket would refresh the sidebar and clear chat messages
 * during active conversations, creating a poor user experience.
 * 
 * Solution: Track "active sessions" and pause project updates during conversations.
 * 
 * How it works:
 * 1. When user sends message → session marked as "active" 
 * 2. Project updates are skipped while session is active
 * 3. When conversation completes/aborts → session marked as "inactive"
 * 4. Project updates resume normally
 * 
 * Handles both existing sessions (with real IDs) and new sessions (with temporary IDs).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Settings as SettingsIcon, Sparkles, Bug } from 'lucide-react';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import IdeProjectBar from './components/IdeProjectBar';
import MobileNav from './components/MobileNav';
import Settings from './components/Settings';
import QuickSettingsPanel from './components/QuickSettingsPanel';
import DebugPanel from './components/DebugPanel';
import { clearSession, setSessionMessages } from './stores/sessionSignals';
import { uiSettings, updateUiSettings } from './stores/uiSettings';
import DesktopPanel from './components/DesktopPanel';

import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { TaskMasterProvider } from './contexts/TaskMasterContext';
import { TasksSettingsProvider } from './contexts/TasksSettingsContext';
import { WebSocketProvider, useWebSocketContext } from './contexts/WebSocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import { useVersionCheck } from './hooks/useVersionCheck';
import useLocalStorage from './hooks/useLocalStorage';
import { api, authenticatedFetch } from './utils/api';
import { playNotificationSound } from './utils/notificationSound';
import type { Project, Session, FileUpdate, GitHubNotification } from './types';

// Extend Navigator interface to include standalone property
declare global {
  interface Navigator {
    standalone?: boolean;
  }
}


// Main App component with routing
function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  
  const { updateAvailable, latestVersion, currentVersion, releaseInfo } = useVersionCheck('siteboon', 'claudecodeui');
  const [showVersionModal, setShowVersionModal] = useState(false);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'files'
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('tools');
  const [showQuickSettings, setShowQuickSettings] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [autoExpandTools, setAutoExpandTools] = useLocalStorage('autoExpandTools', false);
  const [showRawParameters, setShowRawParameters] = useLocalStorage('showRawParameters', false);
  const [showThinking, setShowThinking] = useLocalStorage('showThinking', true);
  const [autoScrollToBottom, setAutoScrollToBottom] = useLocalStorage('autoScrollToBottom', true);
  const [sendByCtrlEnter, setSendByCtrlEnter] = useLocalStorage('sendByCtrlEnter', false);
  const [sidebarVisible, setSidebarVisible] = useLocalStorage('sidebarVisible', true);
  const [showFloatingButton, setShowFloatingButton] = useLocalStorage('showFloatingButton', true);

  // External Message Update Trigger: Incremented when external CLI modifies current session's JSONL
  // Triggers ChatInterface to reload messages without switching sessions
  // Now includes sessionId to ensure only the affected session reloads
  const [externalMessageUpdate, setExternalMessageUpdate] = useState<{ sessionId: string | null; timestamp: number }>({
    sessionId: null,
    timestamp: 0
  });

  // Session Switching State: Track when user is switching sessions to show loading overlay
  const [isSwitchingSession, setIsSwitchingSession] = useState(false);

  const { ws, sendMessage, messages } = useWebSocketContext();
  
  // Detect if running as PWA
  const [isPWA, setIsPWA] = useState(false);
  
  useEffect(() => {
    // Check if running in standalone mode (PWA)
    const checkPWA = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                          window.navigator.standalone ||
                          document.referrer.includes('android-app://');
      setIsPWA(isStandalone);
        document.addEventListener('touchstart', () => {}, { passive: true });

      // Add class to html and body for CSS targeting
      if (isStandalone) {
        document.documentElement.classList.add('pwa-mode');
        document.body.classList.add('pwa-mode');
      } else {
        document.documentElement.classList.remove('pwa-mode');
        document.body.classList.remove('pwa-mode');
      }
    };
    
    checkPWA();
    
    // Listen for changes
    window.matchMedia('(display-mode: standalone)').addEventListener('change', checkPWA);
    
    return () => {
      window.matchMedia('(display-mode: standalone)').removeEventListener('change', checkPWA);
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    // Fetch projects on component mount
    console.log('[INIT] 🚀 App mounted, starting fetchProjects...');
    console.time('[INIT] fetchProjects total');
    fetchProjects();
  }, []);

  // Handle WebSocket messages for real-time project updates
  // Session Store now manages messages - no more Session Protection needed
  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];

      if (latestMessage.type === 'projects_updated') {
        // External Session Update Detection: Check if the changed file is the current session's JSONL
        // Background reload strategy: immediately reload changed session in background
        if (latestMessage.changedFile) {
          // Extract project name and session ID from changedFile (format: "project-name/session-id.jsonl")
          const changedFileParts = latestMessage.changedFile.split('/');
          if (changedFileParts.length >= 2) {
            const projectName = changedFileParts[0];
            const filename = changedFileParts[changedFileParts.length - 1];
            const changedSessionId = filename.replace('.jsonl', '');

            // Background reload: fetch latest messages and update cache immediately
            // This makes session switching instant - no loading spinner when user switches
            (async () => {
              try {
                const fetchLimit = uiSettings.value.desktopMode ? 2 : 20;
                const response = await api.sessionMessages(projectName, changedSessionId, fetchLimit, 0);
                if (response.ok) {
                  const data = await response.json();
                  const messages = data.messages || [];
                  const pagination = {
                    offset: messages.length,
                    hasMore: data.hasMore ?? false,
                    total: data.total ?? messages.length,
                  };
                  // Update Session Store cache with latest messages
                  setSessionMessages(changedSessionId, messages, pagination);
                  console.log(`[BACKGROUND] ✅ Reloaded session ${changedSessionId.slice(0, 8)} (${messages.length} messages)`);

                  // Desktop mode: play sound if last message is from assistant
                  if (uiSettings.value.desktopMode && messages.length > 0) {
                    const last = messages[messages.length - 1];
                    const role = last.message?.role || last.role;
                    if (role === 'assistant') {
                      playNotificationSound();
                    }
                  }
                }
              } catch (error) {
                console.error('[BACKGROUND] Failed to reload session:', error);
              }
            })();

            // If user is currently viewing this session, trigger UI reload immediately
            if (selectedSession && changedSessionId === selectedSession.id) {
              setExternalMessageUpdate({
                sessionId: changedSessionId,
                timestamp: Date.now()
              });
            }
          }
        }

        // Only update projects if the watcher sent a full projects payload
        // Lightweight notifications (file-change only) skip this to avoid overwriting
        if (latestMessage.projects) {
          setProjects(latestMessage.projects);
        }
      }
    }
  }, [messages, selectedProject, selectedSession]);

  const fetchProjects = async () => {
    const initStart = performance.now();
    try {
      setIsLoadingProjects(true);

      // Single-phase load: Get complete project data with sessions
      // This ensures data consistency and avoids showing empty projects
      console.log('[INIT] 📡 Fetching projects with sessions...');
      console.time('[INIT] api.projects()');
      const response = await api.projects();
      const projectsData = await response.json();
      console.timeEnd('[INIT] api.projects()');
      console.log(`[INIT] ✅ Got ${projectsData.length} projects with sessions`);

      setProjects(projectsData);
      setIsLoadingProjects(false);
      console.log(`[INIT] ✅ Projects loaded in ${(performance.now() - initStart).toFixed(0)}ms`);
      console.timeEnd('[INIT] fetchProjects total');
    } catch (error) {
      console.error('[INIT] ❌ Error fetching projects:', error);
      setIsLoadingProjects(false);
    }
  };

  // Expose fetchProjects globally for component access
  window.refreshProjects = fetchProjects;

  // Expose openSettings function globally for component access
  window.openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  // Handle URL-based session loading
  useEffect(() => {
    if (sessionId && projects.length > 0) {
      // Only switch tabs on initial load, not on every project update
      const shouldSwitchTab = !selectedSession || selectedSession.id !== sessionId;
      // Find the session across all projects
      for (const project of projects) {
        let session = project.sessions?.find(s => s.id === sessionId);
        if (session) {
          setSelectedProject(project);
          setSelectedSession({ ...session, __provider: 'claude' });
          // Only switch to chat tab if we're loading a different session
          if (shouldSwitchTab) {
            setActiveTab('chat');
          }
          return;
        }
        // Also check Cursor sessions
        const cSession = project.cursorSessions?.find(s => s.id === sessionId);
        if (cSession) {
          setSelectedProject(project);
          setSelectedSession({ ...cSession, __provider: 'cursor' });
          if (shouldSwitchTab) {
            setActiveTab('chat');
          }
          return;
        }
      }
      
      // If session not found, it might be a newly created session
      // Just navigate to it and it will be found when the sidebar refreshes
      // Don't redirect to home, let the session load naturally
    }
  }, [sessionId, projects, navigate]);

  const handleProjectSelect = (project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    navigate('/');
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleSessionSelect = (session) => {
    // Show loading overlay immediately when switching sessions
    setIsSwitchingSession(true);

    // Clear loading overlay after a short delay (will be cleared when ChatInterface loads)
    // This timeout is a safety net in case the component doesn't mount
    setTimeout(() => setIsSwitchingSession(false), 500);

    setSelectedSession(session);
    // Only switch to chat tab when user explicitly selects a session
    // This prevents tab switching during automatic updates
    if (activeTab !== 'git' && activeTab !== 'preview') {
      setActiveTab('chat');
    }

    // For Cursor sessions, we need to set the session ID differently
    // since they're persistent and not created by Claude
    const provider = localStorage.getItem('selected-provider') || 'claude';
    if (provider === 'cursor') {
      // Cursor sessions have persistent IDs
      sessionStorage.setItem('cursorSessionId', session.id);
    }

    // Only close sidebar on mobile if switching to a different project
    if (isMobile) {
      const sessionProjectName = session.__projectName;
      const currentProjectName = selectedProject?.name;

      // Close sidebar if clicking a session from a different project
      // Keep it open if clicking a session from the same project
      if (sessionProjectName !== currentProjectName) {
        setSidebarOpen(false);
      }
    }
    navigate(`/session/${session.id}`);
  };

  const handleNewSession = (project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    setActiveTab('chat');
    navigate('/');
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleSessionDelete = (sessionId) => {
    // If the deleted session was currently selected, clear it
    if (selectedSession?.id === sessionId) {
      setSelectedSession(null);
      navigate('/');
    }
    
    // Update projects state locally instead of full refresh
    setProjects(prevProjects => 
      prevProjects.map(project => ({
        ...project,
        sessions: project.sessions?.filter(session => session.id !== sessionId) || [],
        sessionMeta: {
          ...project.sessionMeta,
          total: Math.max(0, (project.sessionMeta?.total || 0) - 1)
        }
      }))
    );
  };



  const handleSidebarRefresh = async () => {
    // Refresh only the sessions for all projects, don't change selected state
    try {
      const response = await api.projects();
      const freshProjects = await response.json();

      // Direct update without comparison - refresh button should always update
      setProjects(freshProjects);

      // Sync selected project and session references
      if (selectedProject) {
        const refreshedProject = freshProjects.find(p => p.name === selectedProject.name);
        if (refreshedProject) {
          setSelectedProject(refreshedProject);

          // Sync selected session if exists
          if (selectedSession) {
            const refreshedSession = refreshedProject.sessions?.find(s => s.id === selectedSession.id);
            if (refreshedSession) {
              setSelectedSession(refreshedSession);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  };

  const handleProjectDelete = (projectName) => {
    // If the deleted project was currently selected, clear it
    if (selectedProject?.name === projectName) {
      setSelectedProject(null);
      setSelectedSession(null);
      navigate('/');
    }
    
    // Update projects state locally instead of full refresh
    setProjects(prevProjects => 
      prevProjects.filter(project => project.name !== projectName)
    );
  };

  // Version Upgrade Modal Component
  const VersionUpgradeModal = () => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateOutput, setUpdateOutput] = useState('');
    const [updateError, setUpdateError] = useState('');

    if (!showVersionModal) return null;

    // Clean up changelog by removing GitHub-specific metadata
    const cleanChangelog = (body) => {
      if (!body) return '';

      return body
        // Remove full commit hashes (40 character hex strings)
        .replace(/\b[0-9a-f]{40}\b/gi, '')
        // Remove short commit hashes (7-10 character hex strings at start of line or after dash/space)
        .replace(/(?:^|\s|-)([0-9a-f]{7,10})\b/gi, '')
        // Remove "Full Changelog" links
        .replace(/\*\*Full Changelog\*\*:.*$/gim, '')
        // Remove compare links (e.g., https://github.com/.../compare/v1.0.0...v1.0.1)
        .replace(/https?:\/\/github\.com\/[^\/]+\/[^\/]+\/compare\/[^\s)]+/gi, '')
        // Clean up multiple consecutive empty lines
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        // Trim whitespace
        .trim();
    };

    const handleUpdateNow = async () => {
      setIsUpdating(true);
      setUpdateOutput('Starting update...\n');
      setUpdateError('');

      try {
        // Call the backend API to run the update command
        const response = await authenticatedFetch('/api/system/update', {
          method: 'POST',
        });

        const data = await response.json();

        if (response.ok) {
          setUpdateOutput(prev => prev + data.output + '\n');
          setUpdateOutput(prev => prev + '\n✅ Update completed successfully!\n');
          setUpdateOutput(prev => prev + 'Please restart the server to apply changes.\n');
        } else {
          setUpdateError(data.error || 'Update failed');
          setUpdateOutput(prev => prev + '\n❌ Update failed: ' + (data.error || 'Unknown error') + '\n');
        }
      } catch (error) {
        setUpdateError(error.message);
        setUpdateOutput(prev => prev + '\n❌ Update failed: ' + error.message + '\n');
      } finally {
        setIsUpdating(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <button
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowVersionModal(false)}
          aria-label="Close version upgrade modal"
        />

        {/* Modal */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Update Available</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {releaseInfo?.title || 'A new version is ready'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowVersionModal(false)}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Version Info */}
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Version</span>
              <span className="text-sm text-gray-900 dark:text-white font-mono">{currentVersion}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Latest Version</span>
              <span className="text-sm text-blue-900 dark:text-blue-100 font-mono">{latestVersion}</span>
            </div>
          </div>

          {/* Changelog */}
          {releaseInfo?.body && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">What's New:</h3>
                {releaseInfo?.htmlUrl && (
                  <a
                    href={releaseInfo.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1"
                  >
                    View full release
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600 max-h-64 overflow-y-auto">
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none">
                  {cleanChangelog(releaseInfo.body)}
                </div>
              </div>
            </div>
          )}

          {/* Update Output */}
          {updateOutput && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Update Progress:</h3>
              <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 border border-gray-700 max-h-48 overflow-y-auto">
                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{updateOutput}</pre>
              </div>
            </div>
          )}

          {/* Upgrade Instructions */}
          {!isUpdating && !updateOutput && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Manual upgrade:</h3>
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 border">
                <code className="text-sm text-gray-800 dark:text-gray-200 font-mono">
                  git checkout main && git pull && npm install
                </code>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Or click "Update Now" to run the update automatically.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setShowVersionModal(false)}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              {updateOutput ? 'Close' : 'Later'}
            </button>
            {!updateOutput && (
              <>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText('git checkout main && git pull && npm install');
                  }}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                >
                  Copy Command
                </button>
                <button
                  onClick={handleUpdateNow}
                  disabled={isUpdating}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded-md transition-colors flex items-center justify-center gap-2"
                >
                  {isUpdating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Now'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Sidebar width for resizable splitter
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebarWidth');
      return saved ? parseInt(saved, 10) : 320;
    } catch { return 320; }
  });
  const [sidebarFullWidth, setSidebarFullWidth] = useState(false);
  // Direction tracks whether next click expands or collapses
  // 'expand': collapsed→normal→full, 'collapse': full→normal→collapsed
  const [sidebarDirection, setSidebarDirection] = useState('collapse'); // normal state defaults to collapse direction
  const isResizing = useRef(false);

  const handleSidebarCycle = () => {
    if (sidebarDirection === 'expand') {
      // expanding: normal → full
      if (!sidebarFullWidth) {
        setSidebarFullWidth(true);
        setSidebarDirection('collapse'); // at max, reverse
      }
    } else {
      // collapsing: full → normal, or normal → collapsed
      if (sidebarFullWidth) {
        setSidebarFullWidth(false);
        // stay collapse direction, next click will collapse
      } else {
        setSidebarVisible(false);
        setSidebarDirection('expand'); // at min, reverse
      }
    }
  };

  const handleResizeStart = (e) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    let lastWidth = sidebarWidth;

    const handleMouseMove = (e) => {
      if (!isResizing.current) return;
      lastWidth = Math.min(Math.max(e.clientX, 200), 600);
      setSidebarWidth(lastWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      try { localStorage.setItem('sidebarWidth', String(lastWidth)); } catch {}
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const isDesktopMode = uiSettings.value.desktopMode;

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Desktop Mode: show DesktopPanel instead of normal layout */}
      {isDesktopMode ? (
        <DesktopPanel
          projects={projects}
          onSessionSelect={(session, project) => {
            // Switch to normal mode and navigate to the session
            updateUiSettings({ desktopMode: false });
            handleProjectSelect(project);
            handleSessionSelect(session, project);
          }}
          onProjectSelect={handleProjectSelect}
        />
      ) : (
      <>
      {/* IDE Project Bar - only in normal mode */}
      <IdeProjectBar />
      {/* Main layout: sidebar + content */}
      <div className="flex-1 flex min-h-0">
      {/* Fixed Desktop Sidebar */}
      {!isMobile && (
        <div
          className={`h-full flex-shrink-0 border-r border-border bg-card transition-all duration-300 ${
            sidebarVisible ? (sidebarFullWidth ? 'flex-1' : '') : 'w-14'
          }`}
          style={sidebarVisible && !sidebarFullWidth ? { width: sidebarWidth } : undefined}
        >
          <div className="h-full overflow-hidden">
            {sidebarVisible ? (
              <Sidebar
                projects={projects}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                onProjectSelect={handleProjectSelect}
                onSessionSelect={handleSessionSelect}
                onNewSession={handleNewSession}
                onSessionDelete={handleSessionDelete}
                onProjectDelete={handleProjectDelete}
                isLoading={isLoadingProjects}
                onRefresh={handleSidebarRefresh}
                onShowSettings={() => setShowSettings(true)}
                onShowDebug={() => setShowDebugPanel(true)}
                updateAvailable={updateAvailable}
                latestVersion={latestVersion}
                currentVersion={currentVersion}
                releaseInfo={releaseInfo}
                onShowVersionModal={() => setShowVersionModal(true)}
                isPWA={isPWA}
                isMobile={isMobile}
                onToggleSidebar={() => setSidebarVisible(false)}
                sidebarFullWidth={sidebarFullWidth}
                onSidebarCycle={handleSidebarCycle}
                sidebarDirection={sidebarDirection}
              />
            ) : (
              /* Collapsed Sidebar */
              <div className="h-full flex flex-col items-center py-4 gap-4">
                {/* Expand Button */}
                <button
                  onClick={() => { setSidebarVisible(true); setSidebarDirection('expand'); }}
                  className="p-2 hover:bg-accent rounded-md transition-colors duration-200 group"
                  aria-label="Show sidebar"
                  title="Show sidebar"
                >
                  <svg
                    className="w-5 h-5 text-foreground group-hover:scale-110 transition-transform"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Debug Icon */}
                <button
                  onClick={() => setShowDebugPanel(true)}
                  className="p-2 hover:bg-accent rounded-md transition-colors duration-200"
                  aria-label="Debug Monitor"
                  title="Debug Monitor"
                >
                  <Bug className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
                </button>

                {/* Settings Icon */}
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-2 hover:bg-accent rounded-md transition-colors duration-200"
                  aria-label="Settings"
                  title="Settings"
                >
                  <SettingsIcon className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
                </button>

                {/* Update Indicator */}
                {updateAvailable && (
                  <button
                    onClick={() => setShowVersionModal(true)}
                    className="relative p-2 hover:bg-accent rounded-md transition-colors duration-200"
                    aria-label="Update available"
                    title="Update available"
                  >
                    <Sparkles className="w-5 h-5 text-blue-500" />
                    <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && (
        <div className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
          sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}>
          <button
            className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label="Close sidebar"
          />
          <div
            className={`relative w-[85vw] max-w-sm sm:w-80 h-full bg-card border-r border-border transform transition-transform duration-150 ease-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <Sidebar
              projects={projects}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              onProjectSelect={handleProjectSelect}
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
              onSessionDelete={handleSessionDelete}
              onProjectDelete={handleProjectDelete}
              isLoading={isLoadingProjects}
              onRefresh={handleSidebarRefresh}
              onShowSettings={() => setShowSettings(true)}
              onShowDebug={() => setShowDebugPanel(true)}
              updateAvailable={updateAvailable}
              latestVersion={latestVersion}
              currentVersion={currentVersion}
              releaseInfo={releaseInfo}
              onShowVersionModal={() => setShowVersionModal(true)}
              isPWA={isPWA}
              isMobile={isMobile}
              onToggleSidebar={() => setSidebarVisible(false)}
              sidebarFullWidth={sidebarFullWidth}
              onSidebarCycle={handleSidebarCycle}
              sidebarDirection={sidebarDirection}
            />
          </div>
        </div>
      )}

      {/* Resizable Splitter Handle */}
      {!isMobile && sidebarVisible && !sidebarFullWidth && (
        <div
          className="w-1 hover:w-1.5 bg-transparent hover:bg-primary/20 cursor-col-resize flex-shrink-0 transition-all"
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Main Content Area - Flexible (hidden when sidebar is full width) */}
      <div className={`flex-1 flex flex-col min-w-0 ${isMobile && !isInputFocused ? 'pb-mobile-nav' : ''} ${sidebarFullWidth && !isMobile ? 'hidden' : ''}`}>
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          messages={messages}
          isMobile={isMobile}
          isPWA={isPWA}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onNavigateToSession={(sessionId) => navigate(`/session/${sessionId}`)}
          onShowSettings={() => setShowSettings(true)}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          autoScrollToBottom={autoScrollToBottom}
          sendByCtrlEnter={sendByCtrlEnter}
          externalMessageUpdate={externalMessageUpdate}
          showFloatingButton={showFloatingButton}
          isSwitchingSession={isSwitchingSession}
          onSessionLoaded={() => setIsSwitchingSession(false)}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
        />
      )}
      {/* Quick Settings Panel - only on chat tab in normal mode */}
      {activeTab === 'chat' && (
        <QuickSettingsPanel
          isOpen={showQuickSettings}
          onToggle={setShowQuickSettings}
          autoExpandTools={autoExpandTools}
          onAutoExpandChange={setAutoExpandTools}
          showRawParameters={showRawParameters}
          onShowRawParametersChange={setShowRawParameters}
          showThinking={showThinking}
          onShowThinkingChange={setShowThinking}
          autoScrollToBottom={autoScrollToBottom}
          onAutoScrollChange={setAutoScrollToBottom}
          sendByCtrlEnter={sendByCtrlEnter}
          onSendByCtrlEnterChange={setSendByCtrlEnter}
          isMobile={isMobile}
        />
      )}

      </div>{/* End main layout flex row */}
      </>
      )}

      {/* Quick Settings Panel - available in desktop mode too */}
      {isDesktopMode && (
        <QuickSettingsPanel
          isOpen={showQuickSettings}
          onToggle={setShowQuickSettings}
          autoExpandTools={autoExpandTools}
          onAutoExpandChange={setAutoExpandTools}
          showRawParameters={showRawParameters}
          onShowRawParametersChange={setShowRawParameters}
          showThinking={showThinking}
          onShowThinkingChange={setShowThinking}
          autoScrollToBottom={autoScrollToBottom}
          onAutoScrollChange={setAutoScrollToBottom}
          sendByCtrlEnter={sendByCtrlEnter}
          onSendByCtrlEnterChange={setSendByCtrlEnter}
          isMobile={isMobile}
        />
      )}

      {/* Settings Modal */}
      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        projects={projects}
        initialTab={settingsInitialTab}
        showFloatingButton={showFloatingButton}
        setShowFloatingButton={setShowFloatingButton}
      />

      {/* Debug Panel */}
      <DebugPanel
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
      />

      {/* Version Upgrade Modal */}
      <VersionUpgradeModal />
    </div>
  );
}

// Root App component with router
function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WebSocketProvider>
          <TasksSettingsProvider>
            <TaskMasterProvider>
              <ProtectedRoute>
                <Router>
                  <Routes>
                    <Route path="/" element={<AppContent />} />
                    <Route path="/session/:sessionId" element={<AppContent />} />
                  </Routes>
                </Router>
              </ProtectedRoute>
            </TaskMasterProvider>
          </TasksSettingsProvider>
        </WebSocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
