import { useState, useEffect, useRef, useCallback } from 'react';
import WebSocketManager, { GameStatus } from '../lib/websocket/WebSocketManager';

// Define the state and functions returned by the hook
interface UseWebSocketGameResult {
  isConnected: boolean;
  error: Event | Error | null;
  sendMessage: (message: any) => void; // Function to send messages (if needed)
  readyState: number; // Expose WebSocket readyState
  gameStatus: GameStatus; // Current parsed game status
  currentTheme: string | null; // Current theme/scenario text
  closeConnection: () => void; // Function to manually close the connection
  handleApiError: (error: any, gameId: string, userId: string | null, isAdmin: boolean) => void; // New function to handle API errors
  lastSystemMessage: string | null; // Last system message received for role determination
  hasAdminMessage: boolean; // Flag indicating if admin message was received
}

// Экспортируем GameStatus из WebSocketManager
export type { GameStatus } from '../lib/websocket/WebSocketManager';

/**
 * Custom hook to manage WebSocket connection for a game room using WebSocketManager.
 * Provides persistent connections that survive component unmounting/remounting.
 *
 * @param roomId The ID of the game room.
 * @param userId The ID of the current user.
 * @returns An object with connection status, error, sendMessage function, readyState, gameStatus, currentTheme, and closeConnection function.
 */
export function useWebSocketGame(roomId: string | null, userId: string | null): UseWebSocketGameResult {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<Event | Error | null>(null);
  const [readyState, setReadyState] = useState<number>(WebSocket.CLOSED);
  const [gameStatus, setGameStatus] = useState<GameStatus>('UNKNOWN');
  const [currentTheme, setCurrentTheme] = useState<string | null>(null);
  const [lastSystemMessage, setLastSystemMessage] = useState<string | null>(null);
  const [hasAdminMessage, setHasAdminMessage] = useState<boolean>(false);
  
  const wsManager = useRef(WebSocketManager.getInstance());
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Subscribe to WebSocket manager when roomId/userId change
  useEffect(() => {
    if (!roomId || !userId) {
      // Cleanup existing subscription
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      
      // Reset state
      setIsConnected(false);
      setError(null);
      setReadyState(WebSocket.CLOSED);
      setGameStatus('UNKNOWN');
      setCurrentTheme(null);
      setLastSystemMessage(null);
      setHasAdminMessage(false);
      return;
    }

    // React Native doesn't have window.location.href like browsers do
    // Instead, we'll use the incoming parameters directly
    console.log(`[useWebSocketGame] 🔍 Using direct params for room: ${roomId} and user: ${userId}`);

    console.log(`[useWebSocketGame] Subscribing to ${roomId}:${userId}`);

    // Create subscriber
    const subscriber = {
      onStatusChange: (status: GameStatus) => {
        console.log(`[useWebSocketGame] 🔄 Status changed to: ${status}, roomId: ${roomId}, userId: ${userId}`);
        
        // First set the game status
        setGameStatus(status);
        
        // Extra logging for critical state transitions
        if (status === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
          console.log(`[useWebSocketGame] 🚨 CRITICAL STATUS CHANGE: ${status} - should navigate to answer screen`);
          console.log(`[useWebSocketGame] 📝 Current theme: "${currentTheme}"`);
        }
        
        // Reset admin flag when returning to lobby or waiting for players (new game session)
        if (status === 'WAITING_FOR_PLAYERS' || status === 'STATS_READY') {
          setHasAdminMessage(false);
        }
      },
      
      onThemeChange: (theme: string | null) => {
        console.log(`[useWebSocketGame] Theme changed to: ${theme}`);
        setCurrentTheme(theme);
      },
      
      onConnectionChange: (connected: boolean) => {
        console.log(`[useWebSocketGame] Connection changed to: ${connected}`);
        setIsConnected(connected);
      },
      
      onError: (err: Event | Error | null) => {
        console.log(`[useWebSocketGame] Error changed to:`, err);
        setError(err);
      },
      
      onSystemMessage: (message: string, isAdminMessage: boolean) => {
        console.log(`[useWebSocketGame] System message: ${message}, isAdmin: ${isAdminMessage}`);
        setLastSystemMessage(message);
        if (isAdminMessage) {
          console.log(`[useWebSocketGame] 🔑 Admin message detected, setting hasAdminMessage=true for ${userId}`);
          setHasAdminMessage(true);
        }
        
        // Explicit check for admin message in the content regardless of flag
        if (message.includes('Введите ситуацию')) {
          console.log(`[useWebSocketGame] 🔑 Admin message content detected ("Введите ситуацию"), forcing hasAdminMessage=true`);
          setHasAdminMessage(true);
        }
      },
      
      onReadyStateChange: (state: number) => {
        console.log(`[useWebSocketGame] Ready state changed to: ${state}`);
        setReadyState(state);
      }
    };

    // Subscribe to manager
    const unsubscribe = wsManager.current.subscribe(roomId, userId, subscriber);
    unsubscribeRef.current = unsubscribe;

    // Cleanup function
    return () => {
      console.log(`[useWebSocketGame] Unsubscribing from ${roomId}:${userId}`);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [roomId, userId]);

  // Handle API errors with redirection in case of 500 status
  const handleApiError = useCallback((error: any, gameId: string, userId: string | null, isAdmin: boolean) => {
    console.error('API Error:', error);
    
    // Check if the error is a server error (500)
    const is500Error = error?.status === 500 || 
                       (error?.message && error.message.includes('500')) ||
                       (typeof error === 'string' && error.includes('500'));
    
    if (is500Error) {
      console.log('Received 500 error from server. Setting timeout to redirect to lobby...');
      
      // Set a timeout to redirect to lobby after 5 seconds
      setTimeout(() => {
        // Use the router from expo-router to navigate back to lobby
        const { router } = require('expo-router');
        console.log('Redirecting to lobby due to 500 error');
        router.replace({ 
          pathname: '/lobby/[gameId]', 
          params: { 
            gameId: gameId, 
            userId: userId, 
            isAdmin: isAdmin.toString() 
          } 
        });
      }, 5000); // 5 seconds timeout before redirect
    }
  }, []);

  // Function to send messages
  const sendMessage = useCallback((message: any) => {
    if (!roomId || !userId) {
      console.warn('[useWebSocketGame] Cannot send message - missing roomId or userId');
      setError(new Error('Cannot send message - missing room or user ID'));
      return;
    }

    const success = wsManager.current.sendMessage(roomId, userId, message);
    if (!success) {
      setError(new Error('Failed to send message - connection not ready'));
    }
  }, [roomId, userId]);

  // Function to manually close the connection
  const closeConnection = useCallback(() => {
    if (!roomId || !userId) {
      console.warn('[useWebSocketGame] Cannot close connection - missing roomId or userId');
      return;
    }

    console.log(`[useWebSocketGame] Closing connection for ${roomId}:${userId}`);
    wsManager.current.closeConnection(roomId, userId);
  }, [roomId, userId]);

  return {
    isConnected,
    error,
    sendMessage,
    readyState,
    gameStatus,
    currentTheme,
    closeConnection,
    handleApiError,
    lastSystemMessage,
    hasAdminMessage,
  };
}