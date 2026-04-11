import { useState, useEffect } from 'react';
import { X, RefreshCw, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { authenticatedFetch } from '../utils/api';

interface ClaudeUsageData {
  session?: {
    used: number;
    resetTime: string;
  };
  weekAll?: {
    used: number;
    resetTime: string;
  };
  weekSonnet?: {
    used: number;
    resetTime: string;
  };
  extraUsage?: string;
}

interface ClaudeUsageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ClaudeUsageModal({ isOpen, onClose }: ClaudeUsageModalProps) {
  const [claudeUsage, setClaudeUsage] = useState<{
    loading: boolean;
    error: string | null;
    data: ClaudeUsageData | null;
    lastUpdated: Date | null;
  }>({
    loading: false,
    error: null,
    data: null,
    lastUpdated: null
  });

  const fetchClaudeUsage = async () => {
    setClaudeUsage(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await authenticatedFetch('/api/cli/claude/usage');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setClaudeUsage({
            loading: false,
            error: null,
            data: data.usage,
            lastUpdated: new Date()
          });
        } else {
          setClaudeUsage({
            loading: false,
            error: data.error || 'Failed to fetch usage',
            data: null,
            lastUpdated: null
          });
        }
      } else {
        setClaudeUsage({
          loading: false,
          error: 'Failed to fetch usage data',
          data: null,
          lastUpdated: null
        });
      }
    } catch (error: any) {
      console.error('Error fetching Claude usage:', error);
      setClaudeUsage({
        loading: false,
        error: error.message,
        data: null,
        lastUpdated: null
      });
    }
  };

  useEffect(() => {
    if (isOpen && !claudeUsage.data) {
      fetchClaudeUsage();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-foreground">Claude Usage</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {/* Last Updated & Refresh */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {claudeUsage.lastUpdated && (
                <span>
                  Updated {formatRelativeTime(claudeUsage.lastUpdated)}
                </span>
              )}
              <button
                onClick={fetchClaudeUsage}
                disabled={claudeUsage.loading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", claudeUsage.loading && "animate-spin")} />
                {claudeUsage.loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {/* Loading State */}
            {claudeUsage.loading && !claudeUsage.data ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                Loading usage data...
              </div>
            ) : claudeUsage.error && !claudeUsage.data ? (
              <div className="text-red-500 text-sm py-4 text-center">
                {claudeUsage.error}
              </div>
            ) : claudeUsage.data ? (
              <div className="space-y-6">
                {/* Current Session */}
                {claudeUsage.data.session && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Current session</span>
                      <span className={cn(
                        "font-medium",
                        claudeUsage.data.session.used >= 90 ? 'text-red-600 dark:text-red-400' :
                        claudeUsage.data.session.used >= 70 ? 'text-orange-600 dark:text-orange-400' :
                        'text-blue-600 dark:text-blue-400'
                      )}>{claudeUsage.data.session.used}% used</span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          claudeUsage.data.session.used >= 90 ? 'bg-red-500' :
                          claudeUsage.data.session.used >= 70 ? 'bg-orange-500' :
                          'bg-blue-500'
                        )}
                        style={{ width: `${claudeUsage.data.session.used}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500">Resets {claudeUsage.data.session.resetTime}</div>
                  </div>
                )}

                {/* Weekly (All Models) */}
                {claudeUsage.data.weekAll && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Weekly (all models)</span>
                      <span className={cn(
                        "font-medium",
                        claudeUsage.data.weekAll.used >= 90 ? 'text-red-600 dark:text-red-400' :
                        claudeUsage.data.weekAll.used >= 70 ? 'text-orange-600 dark:text-orange-400' :
                        'text-green-600 dark:text-green-400'
                      )}>{claudeUsage.data.weekAll.used}% used</span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          claudeUsage.data.weekAll.used >= 90 ? 'bg-red-500' :
                          claudeUsage.data.weekAll.used >= 70 ? 'bg-orange-500' :
                          'bg-green-500'
                        )}
                        style={{ width: `${claudeUsage.data.weekAll.used}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500">Resets {claudeUsage.data.weekAll.resetTime}</div>
                  </div>
                )}

                {/* Weekly (Sonnet Only) */}
                {claudeUsage.data.weekSonnet && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Weekly (Sonnet only)</span>
                      <span className={cn(
                        "font-medium",
                        claudeUsage.data.weekSonnet.used >= 90 ? 'text-red-600 dark:text-red-400' :
                        claudeUsage.data.weekSonnet.used >= 70 ? 'text-orange-600 dark:text-orange-400' :
                        'text-purple-600 dark:text-purple-400'
                      )}>{claudeUsage.data.weekSonnet.used}% used</span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          claudeUsage.data.weekSonnet.used >= 90 ? 'bg-red-500' :
                          claudeUsage.data.weekSonnet.used >= 70 ? 'bg-orange-500' :
                          'bg-purple-500'
                        )}
                        style={{ width: `${claudeUsage.data.weekSonnet.used}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500">Resets {claudeUsage.data.weekSonnet.resetTime}</div>
                  </div>
                )}

                {/* Extra Usage */}
                {claudeUsage.data.extraUsage && (
                  <div className="pt-4 border-t border-border">
                    <h4 className="text-sm font-medium text-foreground mb-2">Extra Usage</h4>
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {claudeUsage.data.extraUsage}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-muted-foreground text-sm py-8">
                No usage data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
