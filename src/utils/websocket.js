import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket() {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef(null);
  // Use ref to store websocket so sendMessage always has access to current instance
  const wsRef = useRef(null);

  const connect = useCallback(async () => {
    // Don't reconnect if already connected or connecting
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';

      // Construct WebSocket URL
      let wsUrl;

      if (isPlatform) {
        // Platform mode: Use same domain as the page (goes through proxy)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws`;
      } else {
        // OSS mode: Connect to same host:port that served the page
        const token = localStorage.getItem('auth-token');
        if (!token) {
          console.warn('No authentication token found for WebSocket connection');
          return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      }

      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;

      websocket.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Limit message buffer to prevent memory bloat
          // Only keep the most recent 50 messages since consumers only read the latest
          setMessages(prev => {
            const newMessages = [...prev, data];
            return newMessages.slice(-50);
          });
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        console.log('[WebSocket] Disconnected');
        wsRef.current = null;
        setIsConnected(false);
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      wsRef.current = null;
      
      // Attempt to reconnect after error
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    }
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []); // Empty deps - connect is stable due to useCallback with empty deps

  // Use useCallback to ensure sendMessage always accesses current wsRef
  const sendMessage = useCallback((message) => {
    const websocket = wsRef.current;
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Sending message:', message.type);
      websocket.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send - not connected. readyState:', websocket?.readyState);
    }
  }, []);

  return {
    ws: wsRef.current,  // Return current value for backward compatibility (truthiness checks)
    sendMessage,
    messages,
    isConnected
  };
}
