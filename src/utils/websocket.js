import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket() {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef(null);
  // Use ref to store websocket so sendMessage always has access to current instance
  const wsRef = useRef(null);
  // Track if we've already initiated connection to prevent double connect
  const hasConnectedRef = useRef(false);

  const connect = useCallback(async () => {
    // Prevent multiple simultaneous connection attempts
    if (hasConnectedRef.current) return;
    hasConnectedRef.current = true;

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
          hasConnectedRef.current = false;
          return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      }

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        console.log('[WebSocket] Connected');
        wsRef.current = websocket;
        setIsConnected(true);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMessages(prev => [...prev, data]);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        console.log('[WebSocket] Disconnected');
        wsRef.current = null;
        setIsConnected(false);
        hasConnectedRef.current = false;
        
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
      hasConnectedRef.current = false;
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
