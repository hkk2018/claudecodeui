import { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Minimize2, Maximize2, Send, Loader2, Sparkles, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, authenticatedFetch } from '../utils/api';

interface GeminiAssistantProps {
  sessions: Array<{
    projectName: string;
    sessionId: string;
    lastActivity: string;
    messageCount: number;
    isActive: boolean;
  }>;
}

interface ProjectLinkProps {
  projectName: string;
  onFocus: (projectName: string) => void;
}

// Component to render text with clickable project links
function MessageContent({ content, onFocusProject }: { content: string; onFocusProject: (name: string) => void }) {
  // Parse [project:xxx] and convert to clickable links
  const parts = content.split(/(\[project:[^\]]+\])/g);

  return (
    <div className="space-y-2">
      {parts.map((part, idx) => {
        const match = part.match(/\[project:([^\]]+)\]/);
        if (match) {
          const projectName = match[1];
          return (
            <button
              key={idx}
              onClick={() => onFocusProject(projectName)}
              className="inline-flex items-center gap-1 px-2 py-0.5 mx-1 text-xs font-medium bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
              title={`Focus ${projectName}`}
            >
              <span>{projectName}</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          );
        }
        // Regular markdown rendering for non-project parts
        return (
          <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]}>
            {part}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function GeminiAssistant({ sessions }: GeminiAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastAnalysisTime, setLastAnalysisTime] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current && !isMinimized) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isMinimized]);

  // Analyze sessions every 10 minutes
  useEffect(() => {
    const analyzeActiveSessions = async () => {
      // Only analyze if there are active sessions
      const activeSessions = sessions
        .filter(s => s.isActive)
        .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
        .slice(0, 3); // Top 3 most recent active sessions

      if (activeSessions.length === 0) return;

      const now = Date.now();
      // Skip if analyzed within last 9 minutes (give 1 min buffer)
      if (now - lastAnalysisTime < 9 * 60 * 1000) return;

      setLastAnalysisTime(now);

      try {
        // Call backend API to get Gemini recommendation
        const response = await authenticatedFetch('/api/gemini/analyze', {
          method: 'POST',
          body: JSON.stringify({ sessions: activeSessions }),
        });

        if (response.ok) {
          const data = await response.json();
          const recommendation = data.recommendation;

          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content: recommendation,
              timestamp: Date.now(),
            },
          ]);

          // Auto-open the assistant if closed
          if (!isOpen) {
            setIsOpen(true);
          }
        }
      } catch (error) {
        console.error('Failed to get Gemini recommendation:', error);
      }
    };

    // Run immediately on mount
    analyzeActiveSessions();

    // Set up 10-minute interval
    intervalRef.current = setInterval(analyzeActiveSessions, 10 * 60 * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [sessions, isOpen, lastAnalysisTime]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await authenticatedFetch('/api/gemini/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: userMessage.content,
          history: messages,
          sessions,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.response,
            timestamp: Date.now(),
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '抱歉，我現在無法回應。請稍後再試。',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFocusProject = async (projectName: string) => {
    try {
      const res = await api.overlay.focusIdeByName(projectName);
      const data = await res.json();
      if (!data.success) {
        console.error('Failed to focus project:', data);
      }
    } catch (error) {
      console.error('Failed to focus project:', error);
    }
  };

  const handleQuickAsk = async () => {
    const quickMessage = '請告訴我最該先處理的三個訊息';

    const userMessage: Message = {
      role: 'user',
      content: quickMessage,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await authenticatedFetch('/api/gemini/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: userMessage.content,
          history: messages,
          sessions,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.response,
            timestamp: Date.now(),
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '抱歉，我現在無法回應。請稍後再試。',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center group"
        title="Open AI Assistant"
      >
        <Sparkles className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 bg-card border border-border rounded-lg shadow-2xl transition-all duration-300',
        isMinimized ? 'w-80 h-14' : 'w-96 h-[32rem]'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-purple-500/10 to-pink-500/10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          <span className="font-semibold text-sm">AI 助手</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-accent rounded transition-colors"
            title={isMinimized ? 'Maximize' : 'Minimize'}
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4" />
            ) : (
              <Minimize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-accent rounded transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      {!isMinimized && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 h-[calc(32rem-8rem)]">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm text-center">
                <Sparkles className="w-12 h-12 mb-3 text-purple-500/50" />
                <p>我會每 10 分鐘分析你最近的活躍會話</p>
                <p className="mt-1">並推薦你應該優先處理的問題</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'flex gap-2',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-accent text-foreground prose prose-sm dark:prose-invert max-w-none'
                    )}
                  >
                    {msg.role === 'assistant' ? (
                      <MessageContent content={msg.content} onFocusProject={handleFocusProject} />
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex gap-2 justify-start">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="bg-accent rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <button
                onClick={handleQuickAsk}
                disabled={isLoading}
                className="px-2 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-1"
                title="快速詢問：請告訴我最該先處理的三個訊息"
              >
                <Zap className="w-4 h-4" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="詢問 AI 助手..."
                className="flex-1 px-3 py-2 text-sm bg-accent border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
