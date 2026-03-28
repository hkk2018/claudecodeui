import React, { useState, useMemo } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import { MessageSquare, Clock, Search, X, Folder, User, Bot, Star } from 'lucide-react';
import { api } from '../utils/api';
import { useFavorites, makeKey, toggleFavorite } from '../stores/favoritesStore';

// Format time ago helper
const formatTimeAgo = (dateString: any, currentTime: any) => {
  const date = new Date(dateString);
  const now = currentTime;

  if (isNaN(date.getTime())) {
    return 'Unknown';
  }

  const diffInMs = now.getTime ? now.getTime() - date.getTime() : now - date.getTime();
  const diffInSeconds = Math.floor(diffInMs / 1000);
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInSeconds < 60) return 'Just now';
  if (diffInMinutes === 1) return '1 min ago';
  if (diffInMinutes < 60) return `${diffInMinutes} mins ago`;
  if (diffInHours === 1) return '1 hour ago';
  if (diffInHours < 24) return `${diffInHours} hours ago`;
  if (diffInDays === 1) return '1 day ago';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  return date.toLocaleDateString();
};

// Truncate text helper
const truncateText = (text, maxLength = 80) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

// Group sessions by time period
const groupByTimePeriod = (sessions, currentTime) => {
  const now = currentTime;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);

  const groups = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: []
  };

  sessions.forEach(session => {
    const sessionDate = new Date(session.lastActivity);
    if (sessionDate >= today) {
      groups.today.push(session);
    } else if (sessionDate >= yesterday) {
      groups.yesterday.push(session);
    } else if (sessionDate >= thisWeek) {
      groups.thisWeek.push(session);
    } else {
      groups.earlier.push(session);
    }
  });

  return groups;
};

function MessagesView({
  projects,
  selectedSession,
  onSessionSelect,
  onProjectSelect,
  currentTime,
  isMobile,
  isPWA
}) {
  const [searchFilter, setSearchFilter] = useState('');
  const [previewSession, setPreviewSession] = useState(null);
  const favorites = useFavorites();

  // Flatten all sessions from all projects with project info attached
  const allSessions = useMemo(() => {
    const sessions = [];

    projects.forEach(project => {
      // Add Claude sessions
      (project.sessions || []).forEach(session => {
        sessions.push({
          ...session,
          __provider: 'claude',
          __projectName: project.name,
          __projectDisplayName: project.displayName || project.name,
          __projectPath: project.fullPath || project.path
        });
      });

      // Add Cursor sessions
      (project.cursorSessions || []).forEach(session => {
        sessions.push({
          ...session,
          __provider: 'cursor',
          __projectName: project.name,
          __projectDisplayName: project.displayName || project.name,
          __projectPath: project.fullPath || project.path,
          lastActivity: session.createdAt // Normalize for sorting
        });
      });
    });

    // Sort by most recent activity
    return sessions.sort((a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }, [projects]);

  // Filter sessions based on search
  const filteredSessions = useMemo(() => {
    if (!searchFilter.trim()) return allSessions;

    const searchLower = searchFilter.toLowerCase();
    return allSessions.filter(session => {
      const summary = (session.summary || session.name || '').toLowerCase();
      const projectName = (session.__projectDisplayName || '').toLowerCase();
      const lastUser = (session.lastUserMessage || '').toLowerCase();
      const lastAssistant = (session.lastAssistantMessage || '').toLowerCase();

      return summary.includes(searchLower) ||
             projectName.includes(searchLower) ||
             lastUser.includes(searchLower) ||
             lastAssistant.includes(searchLower);
    });
  }, [allSessions, searchFilter]);

  // Separate favorites from the rest
  const favoriteSessions = useMemo(() =>
    filteredSessions.filter(s => favorites.has(makeKey(s.__projectName, s.id))),
    [filteredSessions, favorites]
  );

  const nonFavoriteSessions = useMemo(() =>
    filteredSessions.filter(s => !favorites.has(makeKey(s.__projectName, s.id))),
    [filteredSessions, favorites]
  );

  // Group non-favorite sessions by time period
  const groupedSessions = useMemo(() =>
    groupByTimePeriod(nonFavoriteSessions, currentTime),
    [nonFavoriteSessions, currentTime]
  );

  const handleSessionClick = (session) => {
    // Find the project for this session
    const project = projects.find(p => p.name === session.__projectName);
    if (project) {
      onProjectSelect(project);
    }
    onSessionSelect(session);
  };

  const renderSessionItem = (session: any) => {
    const isCursorSession = session.__provider === 'cursor';
    const sessionDate = new Date(session.lastActivity);
    const diffInMinutes = Math.floor((currentTime.getTime() - sessionDate.getTime()) / (1000 * 60));
    const isActive = diffInMinutes < 10;
    const sessionName = isCursorSession
      ? (session.name || 'Untitled Session')
      : (session.summary || 'New Session');

    return (
      <div
        key={`${session.__projectName}-${session.id}`}
        className={cn(
          "group relative p-3 mx-2 my-1.5 rounded-lg border cursor-pointer transition-all duration-200",
          "hover:bg-accent/50 hover:border-accent",
          selectedSession?.id === session.id
            ? "bg-primary/5 border-primary/30 shadow-sm"
            : "bg-card border-border/50",
          isActive && "border-l-2 border-l-green-500"
        )}
        onClick={() => handleSessionClick(session)}
      >
        {/* Active indicator */}
        {isActive && (
          <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          </div>
        )}

        {/* Header: Provider icon + Session name + Time */}
        <div className="flex items-start gap-2 mb-2">
          <div className={cn(
            "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5",
            selectedSession?.id === session.id ? "bg-primary/10" : "bg-muted/50"
          )}>
            {isCursorSession ? (
              <CursorLogo className="w-3.5 h-3.5" />
            ) : (
              <ClaudeLogo className="w-3.5 h-3.5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-foreground truncate">
                {sessionName}
              </h4>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(session.__projectName, session.id);
                  }}
                  className="p-0.5 rounded hover:bg-accent transition-colors"
                  title={favorites.has(makeKey(session.__projectName, session.id)) ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star className={`w-3 h-3 ${favorites.has(makeKey(session.__projectName, session.id)) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40 hover:text-yellow-400'} transition-colors`} />
                </button>
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(session.lastActivity, currentTime)}
                </span>
              </div>
            </div>

            {/* Project name - clickable to focus IDE window */}
            <div className="flex items-center gap-1 mt-0.5">
              <button
                className="flex items-center gap-1 hover:underline cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  api.overlay.focusIdeByName(session.__projectName).then(r => r.json()).then(data => {
                    if (!data.success) console.log('No matching IDE window for:', session.__projectName);
                  }).catch(() => {});
                }}
                title={`Focus ${session.__projectDisplayName} in IDE`}
              >
                <Folder className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate">
                  {session.__projectDisplayName}
                </span>
              </button>
              {session.messageCount > 0 && (
                <Badge variant="secondary" className="text-xs px-1 py-0 ml-auto h-4">
                  {session.messageCount}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Last messages preview - click icons to see full message */}
        <div className="space-y-1.5 pl-8">
          {session.lastUserMessage && (
            <div className="flex items-start gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewSession(session); }}
                className="mt-0.5 flex-shrink-0 hover:scale-125 transition-transform cursor-pointer"
                title="View full message"
              >
                <User className="w-3 h-3 text-blue-500" />
              </button>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {truncateText(session.lastUserMessage, 60)}
              </p>
            </div>
          )}
          {session.lastAssistantMessage && (
            <div className="flex items-start gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewSession(session); }}
                className="mt-0.5 flex-shrink-0 hover:scale-125 transition-transform cursor-pointer"
                title="View full message"
              >
                <Bot className="w-3 h-3 text-orange-500" />
              </button>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {truncateText(session.lastAssistantMessage, 100)}
              </p>
            </div>
          )}
          {!session.lastUserMessage && !session.lastAssistantMessage && (
            <p className="text-xs text-muted-foreground/60 italic">
              No messages yet
            </p>
          )}
        </div>

      </div>
    );
  };

  const renderGroup = (title, sessions) => {
    if (sessions.length === 0) return null;

    return (
      <div className="mb-4">
        <div className="sticky top-0 z-10 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border/50">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {title}
          </h3>
        </div>
        <div className="mt-1">
          {sessions.map(renderSessionItem)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Recent Messages</h2>
          <Badge variant="secondary" className="text-xs">
            {filteredSessions.length}
          </Badge>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search messages..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="pl-9 h-9 text-sm bg-muted/50 border-0 focus:bg-background focus:ring-1 focus:ring-primary/20"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter('')}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-accent rounded"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Sessions List */}
      <ScrollArea className="flex-1">
        <div className="py-2">
          {filteredSessions.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-medium text-foreground mb-1">
                {searchFilter ? 'No matching messages' : 'No messages yet'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {searchFilter
                  ? 'Try adjusting your search term'
                  : 'Start a conversation to see messages here'}
              </p>
            </div>
          ) : (
            <>
              {favoriteSessions.length > 0 && renderGroup('⭐ Favorites', favoriteSessions)}
              {renderGroup('Today', groupedSessions.today)}
              {renderGroup('Yesterday', groupedSessions.yesterday)}
              {renderGroup('This Week', groupedSessions.thisWeek)}
              {renderGroup('Earlier', groupedSessions.earlier)}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Message Preview Modal */}
      {previewSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setPreviewSession(null)}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-lg w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col mx-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-medium text-foreground truncate">
                  {previewSession.summary || previewSession.name || 'Session'}
                </h3>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {previewSession.__projectDisplayName}
                </span>
              </div>
              <button
                onClick={() => setPreviewSession(null)}
                className="p-1 hover:bg-accent rounded transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {previewSession.lastUserMessage && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <User className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-medium text-blue-500">User</span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap pl-5.5">
                    {previewSession.lastUserMessage}
                  </p>
                </div>
              )}
              {previewSession.lastAssistantMessage && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Bot className="w-4 h-4 text-orange-500" />
                    <span className="text-xs font-medium text-orange-500">Assistant</span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap pl-5.5">
                    {previewSession.lastAssistantMessage}
                  </p>
                </div>
              )}
              {!previewSession.lastUserMessage && !previewSession.lastAssistantMessage && (
                <p className="text-sm text-muted-foreground italic">No messages</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MessagesView;
