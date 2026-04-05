import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { updateUiSettings } from '../stores/uiSettings';
import { initNotificationSound } from '../utils/notificationSound';
import { Monitor, RefreshCw, MessageSquare, Clock, ChevronRight, Square, ExternalLink, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import IdeProjectBar from './IdeProjectBar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SessionCard {
  projectName: string;
  projectDisplayName: string;
  sessionId: string;
  summary: string;
  lastActivity: string;
  lastAssistantMessage: string;
  isActive: boolean;
  messageCount: number;
  pendingPermission: boolean;
}

// Extract text content from a message's content field
function extractTextFromContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || '')
      .join(' ');
  }
  return '';
}

// Clean markdown for preview display
function cleanMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`[^`]+`/g, '[code]')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .trim();
}

// Show first N lines + ... + last N lines (like GTK version)
function truncateLines(text: string, headLines = 5, tailLines = 5): string {
  const cleaned = cleanMarkdown(text);
  const lines = cleaned.split('\n').filter(l => l.trim());
  if (lines.length <= headLines + tailLines) {
    return lines.join('\n');
  }
  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');
  return `${head}\n... (${lines.length - headLines - tailLines} lines omitted) ...\n${tail}`;
}

// Format time as HH:MM
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Get time-based color class (like GTK version)
function getTimeColor(dateString: string): string {
  const diffMins = Math.floor((Date.now() - new Date(dateString).getTime()) / 60000);
  if (diffMins < 5) return 'text-green-500';
  if (diffMins < 10) return 'text-yellow-500';
  if (diffMins < 20) return 'text-orange-400';
  return 'text-muted-foreground';
}

const remarkGfmPlugins = [remarkGfm];

export default function DesktopPanel({
  projects,
  onSessionSelect,
  onProjectSelect,
}: {
  projects: any[];
  onSessionSelect?: (session: any, project: any) => void;
  onProjectSelect?: (project: any) => void;
}) {
  const [cards, setCards] = useState<SessionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusingProject, setFocusingProject] = useState<string | null>(null);
  const [focusResult, setFocusResult] = useState<Record<string, 'success' | 'error'>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessionCards = useCallback(async () => {
    if (!projects || projects.length === 0) {
      // Don't clear loading - projects may still be loading upstream
      return;
    }

    try {
      const cardPromises = projects.map(async (project) => {
        try {
          const sessionsRes = await api.sessions(project.name, 1, 0);
          const sessionsData = await sessionsRes.json();
          const sessions = sessionsData.sessions || [];

          if (sessions.length === 0) return null;

          const latestSession = sessions[0];

          let lastAssistantMessage = '';
          try {
            const messagesRes = await api.sessionMessages(
              project.name,
              latestSession.id,
              30, // Need enough to find last assistant text (many could be tool_use)
              0
            );
            const messagesData = await messagesRes.json();
            const messages = messagesData.messages || [];

            // JSONL entries: role at entry.message.role, content at entry.message.content
            // content is an array of blocks; only 'text' type blocks are actual responses
            // (skip tool_use, tool_result which are not human-readable)
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              const role = msg.message?.role || msg.role;
              const content = msg.message?.content || msg.content;
              if (role === 'assistant' && content) {
                const text = extractTextFromContent(content);
                if (text) {
                  lastAssistantMessage = text;
                  break;
                }
              }
            }
          } catch {
            // Card will show "No message"
          }

          const sessionDate = new Date(latestSession.lastActivity);
          const diffInMinutes = Math.floor((Date.now() - sessionDate.getTime()) / 60000);

          return {
            projectName: project.name,
            projectDisplayName: project.displayName || project.name,
            sessionId: latestSession.id,
            summary: latestSession.summary || 'New Session',
            lastActivity: latestSession.lastActivity,
            lastAssistantMessage,
            isActive: diffInMinutes < 10,
            messageCount: latestSession.messageCount || 0,
            pendingPermission: false,
          } as SessionCard;
        } catch {
          return null;
        }
      });

      const results = await Promise.all(cardPromises);
      const validCards = results.filter(Boolean) as SessionCard[];

      validCards.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      });

      setCards(validCards);
    } catch (err) {
      console.error('Failed to fetch desktop panel data:', err);
    } finally {
      setLoading(false);
    }
  }, [projects]);

  useEffect(() => {
    // Unlock audio on first click (browser autoplay policy)
    const unlock = () => { initNotificationSound(); document.removeEventListener('click', unlock); };
    document.addEventListener('click', unlock);

    // Listen for hook-triggered refresh (instant, from Stop hook)
    const handleRefresh = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectName && (detail?.message || detail?.event === 'PermissionRequest')) {
        // Update card directly with the message from hook — no fetch needed
        setCards(prev => {
          const idx = prev.findIndex(c => c.projectName === detail.projectName);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              lastAssistantMessage: detail.message || updated[idx].lastAssistantMessage,
              lastActivity: new Date().toISOString(),
              isActive: detail.event === 'Stop' ? false : updated[idx].isActive,
              pendingPermission: detail.event === 'PermissionRequest',
            };
            return updated;
          }
          // Project not in cards yet — full refresh
          fetchSessionCards();
          return prev;
        });
      } else {
        // No message in event — fallback to full refresh
        fetchSessionCards();
      }
    };
    window.addEventListener('desktop-panel-refresh', handleRefresh);

    fetchSessionCards();
    intervalRef.current = setInterval(fetchSessionCards, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('click', unlock);
      window.removeEventListener('desktop-panel-refresh', handleRefresh);
    };
  }, [fetchSessionCards]);

  // Focus the IDE window for a project
  const handleFocus = async (card: SessionCard, e: React.MouseEvent) => {
    e.stopPropagation();
    setFocusingProject(card.projectName);
    try {
      const res = await api.overlay.focusIdeByName(card.projectName);
      const data = await res.json();
      setFocusResult(prev => ({ ...prev, [card.projectName]: data.success ? 'success' : 'error' }));
    } catch {
      setFocusResult(prev => ({ ...prev, [card.projectName]: 'error' }));
    } finally {
      setFocusingProject(null);
      // Clear result after 3 seconds
      setTimeout(() => {
        setFocusResult(prev => {
          const next = { ...prev };
          delete next[card.projectName];
          return next;
        });
      }, 3000);
    }
  };

  // Navigate to session detail (switch to message mode)
  const handleDetail = (card: SessionCard, e: React.MouseEvent) => {
    e.stopPropagation();
    const project = projects.find(p => p.name === card.projectName);
    if (!project) return;

    const allSessions = [...(project.sessions || []), ...(project.cursorSessions || [])];
    const session = allSessions.find(s => s.id === card.sessionId);

    if (session && onSessionSelect && onProjectSelect) {
      updateUiSettings({ desktopMode: false });
      onProjectSelect(project);
      onSessionSelect(session, project);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Claude Code Notifications</h2>
          <span className="text-xs text-muted-foreground">
            {cards.filter(c => c.isActive).length} active
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => updateUiSettings({ desktopMode: false })}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
            title="Back to message mode"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setLoading(true); fetchSessionCards(); }}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* IDE Project Bar - simplified for desktop mode */}
      <IdeProjectBar desktopMode />

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-3">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading sessions...</span>
          </div>
        ) : cards.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No active sessions
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map((card) => (
              <div
                key={`${card.projectName}-${card.sessionId}`}
                className={cn(
                  "flex rounded-lg border bg-card overflow-hidden transition-all duration-150",
                  card.pendingPermission
                    ? "border-red-500/50 bg-red-50/5 dark:bg-red-900/10 border-2"
                    : card.isActive
                    ? "border-green-500/30 bg-green-50/5 dark:bg-green-900/5"
                    : "border-border"
                )}
              >
                {/* Left: Content area */}
                <div className="flex-1 min-w-0 p-4">
                  {/* Header: icon + project name + menu */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {card.isActive ? (
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
                      ) : (
                        <Square className="w-3 h-3 text-orange-400 fill-orange-400 flex-shrink-0" />
                      )}
                      <span className="font-medium text-sm text-foreground truncate">
                        {card.projectDisplayName}
                      </span>
                      {/* Detail button */}
                      <button
                        onClick={(e) => handleDetail(card, e)}
                        className="p-1 text-muted-foreground/50 hover:text-primary hover:bg-primary/10 rounded transition-colors flex-shrink-0"
                        title="View full conversation"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {card.isActive ? (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          Active
                        </span>
                      ) : (
                        <span className={cn("text-xs", getTimeColor(card.lastActivity))}>
                          Stop at {formatTime(card.lastActivity)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Message body */}
                  <div className="text-sm text-muted-foreground leading-relaxed mb-2 select-text prose prose-sm dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1 max-w-none">
                    {card.lastAssistantMessage ? (
                      <ReactMarkdown remarkPlugins={remarkGfmPlugins}>
                        {truncateLines(card.lastAssistantMessage, 5, 5)}
                      </ReactMarkdown>
                    ) : (
                      <span className="italic text-muted-foreground/60">No message</span>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-end text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      {formatTime(card.lastActivity)}
                    </span>
                  </div>
                </div>

                {/* Right: Focus button (like GTK version) */}
                <button
                  onClick={(e) => handleFocus(card, e)}
                  className={cn(
                    "w-10 flex-shrink-0 flex items-center justify-center border-l transition-colors",
                    focusResult[card.projectName] === 'success'
                      ? "bg-green-500/15 border-green-500/30 text-green-500"
                      : focusResult[card.projectName] === 'error'
                      ? "bg-red-500/15 border-red-500/30 text-red-500"
                      : "bg-primary/5 border-primary/20 text-muted-foreground hover:bg-primary/15 hover:text-primary"
                  )}
                  title="Focus IDE window"
                  disabled={focusingProject === card.projectName}
                >
                  {focusingProject === card.projectName ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : focusResult[card.projectName] === 'success' ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : focusResult[card.projectName] === 'error' ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
