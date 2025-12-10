import React, { useState, useMemo } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import { MessageSquare, Clock, Search, X, Folder, User, Bot, ChevronRight } from 'lucide-react';

// Format time ago helper
const formatTimeAgo = (dateString, currentTime) => {
  const date = new Date(dateString);
  const now = currentTime;

  if (isNaN(date.getTime())) {
    return 'Unknown';
  }

  const diffInMs = now - date;
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
      new Date(b.lastActivity) - new Date(a.lastActivity)
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

  // Group sessions by time period
  const groupedSessions = useMemo(() =>
    groupByTimePeriod(filteredSessions, currentTime),
    [filteredSessions, currentTime]
  );

  const handleSessionClick = (session) => {
    // Find the project for this session
    const project = projects.find(p => p.name === session.__projectName);
    if (project) {
      onProjectSelect(project);
    }
    onSessionSelect(session);
  };

  const renderSessionItem = (session) => {
    const isCursorSession = session.__provider === 'cursor';
    const sessionDate = new Date(session.lastActivity);
    const diffInMinutes = Math.floor((currentTime - sessionDate) / (1000 * 60));
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
              <div className="flex items-center gap-1 flex-shrink-0">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(session.lastActivity, currentTime)}
                </span>
              </div>
            </div>

            {/* Project name */}
            <div className="flex items-center gap-1 mt-0.5">
              <Folder className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">
                {session.__projectDisplayName}
              </span>
              {session.messageCount > 0 && (
                <Badge variant="secondary" className="text-xs px-1 py-0 ml-auto h-4">
                  {session.messageCount}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Last messages preview */}
        <div className="space-y-1.5 pl-8">
          {session.lastUserMessage && (
            <div className="flex items-start gap-1.5">
              <User className="w-3 h-3 text-blue-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground line-clamp-1">
                {truncateText(session.lastUserMessage, 60)}
              </p>
            </div>
          )}
          {session.lastAssistantMessage && (
            <div className="flex items-start gap-1.5">
              <Bot className="w-3 h-3 text-orange-500 mt-0.5 flex-shrink-0" />
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

        {/* Hover arrow */}
        <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
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
              {renderGroup('Today', groupedSessions.today)}
              {renderGroup('Yesterday', groupedSessions.yesterday)}
              {renderGroup('This Week', groupedSessions.thisWeek)}
              {renderGroup('Earlier', groupedSessions.earlier)}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default MessagesView;
