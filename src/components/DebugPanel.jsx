import React, { useState, useEffect } from 'react';
import { X, RefreshCw, AlertCircle, Clock, Activity } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

function DebugPanel({ isOpen, onClose }) {
  const [debugInfo, setDebugInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchDebugInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/debug/info');
      if (!response.ok) {
        throw new Error('Failed to fetch debug info');
      }
      const data = await response.json();
      setDebugInfo(data);
    } catch (err) {
      console.error('Error fetching debug info:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDebugInfo();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !autoRefresh) return;

    const interval = setInterval(fetchDebugInfo, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, [isOpen, autoRefresh]);

  if (!isOpen) return null;

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getStatusColor = (runningTimeMs) => {
    if (runningTimeMs > 300000) return 'text-red-500'; // > 5 minutes
    if (runningTimeMs > 120000) return 'text-yellow-500'; // > 2 minutes
    return 'text-green-500';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90vw] h-[80vh] max-w-6xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-blue-500" />
            <h2 className="text-xl font-semibold">Debug Monitor</h2>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh
            </label>
            <button
              onClick={fetchDebugInfo}
              disabled={loading}
              className="p-2 hover:bg-accent rounded-md transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-accent rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-500">Error</p>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Active Sessions */}
          <section>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Active Sessions ({debugInfo?.activeSessions?.length || 0})
            </h3>
            {debugInfo?.activeSessions?.length > 0 ? (
              <div className="space-y-2">
                {debugInfo.activeSessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className="bg-card border border-border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{session.sessionId}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            session.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-500'
                          }`}>
                            {session.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span className={getStatusColor(session.runningTimeMs)}>
                              {session.runningTimeFormatted}
                            </span>
                          </div>
                          <div>
                            Started: {new Date(session.startTime).toLocaleTimeString()}
                          </div>
                          {session.hasTempFiles && (
                            <div className="text-blue-500">Has temp files</div>
                          )}
                        </div>
                      </div>
                    </div>
                    {session.runningTimeMs > 120000 && (
                      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2 text-sm text-yellow-600 dark:text-yellow-400">
                        ⚠️ Session running for over 2 minutes - may be stuck
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No active sessions
              </div>
            )}
          </section>

          {/* Pending Permissions */}
          <section>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Pending Permission Requests ({debugInfo?.pendingPermissions?.length || 0})
            </h3>
            {debugInfo?.pendingPermissions?.length > 0 ? (
              <div className="space-y-2">
                {debugInfo.pendingPermissions.map((perm) => (
                  <div
                    key={perm.requestId}
                    className="bg-card border border-yellow-500/30 rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                            {perm.toolName}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {perm.requestId}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span className={getStatusColor(perm.waitingTimeMs)}>
                              Waiting: {perm.waitingTimeFormatted}
                            </span>
                          </div>
                          <div>
                            Requested: {new Date(perm.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                        {perm.input && (
                          <div className="mt-2 p-2 bg-muted rounded text-xs font-mono overflow-x-auto">
                            {JSON.stringify(perm.input, null, 2)}
                          </div>
                        )}
                        {perm.suggestions && perm.suggestions.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-muted-foreground mb-1">Suggestions:</p>
                            <div className="space-y-1">
                              {perm.suggestions.map((sugg, idx) => (
                                <div key={idx} className="text-xs bg-muted p-1 rounded">
                                  {sugg.label || sugg.name}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {perm.waitingTimeMs > 30000 && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded p-2 text-sm text-red-600 dark:text-red-400">
                        🚨 Permission request waiting for over 30 seconds - UI may not have received it!
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No pending permission requests
              </div>
            )}
          </section>

          {/* Summary */}
          {debugInfo && (
            <section className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-2">Summary</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Active Sessions:</span>
                  <span className="ml-2 font-semibold">{debugInfo.activeSessions.length}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Pending Permissions:</span>
                  <span className="ml-2 font-semibold">{debugInfo.pendingPermissions.length}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Last Updated:</span>
                  <span className="ml-2 font-mono text-xs">
                    {new Date(debugInfo.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default DebugPanel;
