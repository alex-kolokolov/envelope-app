import { useState, useEffect, useRef, useCallback } from 'react';
import { WEBSOCKET_URL } from '../lib/api/client'; // Import base WebSocket URL

// Define the possible game statuses based on the plan
export type GameStatus =
  | 'UNKNOWN' // Initial or unparsed status
  | 'WAITING_FOR_PLAYERS'
  | 'MAIN_PLAYER_THINKING'
  | 'THEME_INPUT' // Custom status for "[SYSTEM]: Главный игрок вводит тему"
  | 'SCENARIO_PRESENTED' // Custom status for "[SYSTEM]: Ситуация: {THEME_TEXT}"
  | 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT' // From Swagger
  | 'WAITING_FOR_GPT' // Custom status for potential GPT processing phase
  | 'WAITING_FOR_ALL_ANSWERS_FROM_GPT' // From Swagger
  | 'RESULTS_READY' // Custom status for "[RESULT]: ..."
  | 'STATS_READY' // Custom status for "[ALL_STATS]: ..."
  | 'GAME_DONE' // From Swagger
  | 'CLOSED'; // From Swagger

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
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL_MS = 3000; // 3 seconds

// Regex patterns for parsing system messages
const statusRegex = /\[SYSTEM\]: Статус — (.*)/;
const themeInputRegex = /\[SYSTEM\]: Главный игрок вводит тему/;
const situationRegex = /\[SYSTEM\]: Ситуация: (.*)/;
const resultRegex = /\[RESULT\]:/;
const statsRegex = /\[ALL_STATS\]:/;

/**
 * Custom hook to manage WebSocket connection for a game room.
 * Handles connection, disconnection, message receiving, parsing game status, and automatic reconnection.
 *
 * @param roomId The ID of the game room.
 * @param userId The ID of the current user.
 * @returns An object with connection status, error, sendMessage function, readyState, gameStatus, currentTheme, and closeConnection function.
 */
export function useWebSocketGame(roomId: string | null, userId: string | null): UseWebSocketGameResult {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<Event | Error | null>(null);
  const [readyState, setReadyState] = useState<number>(WebSocket.CLOSED); // Initial state
  const [gameStatus, setGameStatus] = useState<GameStatus>('UNKNOWN'); // New state for game status
  const [currentTheme, setCurrentTheme] = useState<string | null>(null); // New state for theme/scenario
  const ws = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef<number>(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const isManualClose = useRef<boolean>(false); // Flag for manual closure

  const connect = useCallback(() => {
    if (!roomId || !userId || ws.current?.readyState === WebSocket.OPEN || ws.current?.readyState === WebSocket.CONNECTING) {
        console.log('WebSocket connect skipped:', { roomId, userId, readyState: ws.current?.readyState });
        return; // Don't connect if no IDs or already connected/connecting
    }

    // Clear any existing reconnect timeout
    if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
    }

    // Reset state on new connection attempt
    isManualClose.current = false; // Reset manual close flag
    setIsConnected(false);
    setError(null);
    setGameStatus('UNKNOWN');
    setCurrentTheme(null);

    const wsUrl = `${WEBSOCKET_URL}?roomId=${roomId}&userId=${userId}`;
    console.log(`Attempting to connect WebSocket: ${wsUrl}`);
    ws.current = new WebSocket(wsUrl);
    setReadyState(ws.current.readyState);

    ws.current.onopen = () => {
      console.log('WebSocket Connected');
      setIsConnected(true);
      setError(null);
      setReadyState(ws.current?.readyState ?? WebSocket.OPEN);
      reconnectAttempts.current = 0; // Reset reconnect attempts on successful connection
    };

    ws.current.onmessage = (event) => {
// --- START DEBUG LOG ---
      console.log('[DEBUG] Raw WebSocket message received:', event.data);
      // --- END DEBUG LOG ---
      // Log raw data for debugging
      console.log('Raw WebSocket Data:', event.data);

      // --- REMOVED JSON PARSING BLOCK ---

      if (typeof event.data === 'string') {
          // Handle string messages (system status updates, themes, etc.)
          const messageText = event.data;
          console.log('Received WebSocket message:', messageText);
          let statusUpdated = false;

          // Try matching known system message patterns
          const statusMatch = messageText.match(statusRegex);
          if (statusMatch && statusMatch[1]) {
              const rawStatus = statusMatch[1].trim() as GameStatus; // Assume it matches GameStatus for now
              // Basic validation/mapping if needed
              // Example: if (rawStatus === 'SOME_BACKEND_STATUS') setGameStatus('CORRESPONDING_FRONTEND_STATUS');
              setGameStatus(rawStatus);
              console.log('Parsed Game Status:', rawStatus);
              statusUpdated = true;
          } else if (themeInputRegex.test(messageText)) {
              setGameStatus('THEME_INPUT');
              console.log('Parsed Game Status: THEME_INPUT');
              statusUpdated = true;
          } else if (situationRegex.test(messageText)) {
              const situationMatch = messageText.match(situationRegex);
              if (situationMatch && situationMatch[1]) {
                  const theme = situationMatch[1].trim();
                  setCurrentTheme(theme);
                  // After scenario parsing, transition directly to answer phase
                  setGameStatus('WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT');
                  console.log('Parsed Game Status: WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT, Theme:', theme);
                  statusUpdated = true;
              }
          } else if (resultRegex.test(messageText)) {
              setGameStatus('RESULTS_READY');
              console.log('Parsed Game Status: RESULTS_READY');
              statusUpdated = true;
          } else if (statsRegex.test(messageText)) {
              setGameStatus('STATS_READY');
              console.log('Parsed Game Status: STATS_READY');
              statusUpdated = true;
          } else if (messageText === '[SYSTEM]: Введите ситуацию') { // Add check for the new message
              setGameStatus('MAIN_PLAYER_THINKING'); // Map to MAIN_PLAYER_THINKING as per user feedback
              console.log('Parsed Game Status: MAIN_PLAYER_THINKING (from Введите ситуацию)');
              statusUpdated = true;
          }

          if (statusUpdated) {
              setError(null); // Clear errors if we successfully parsed a known message
          } else {
              console.warn('Unhandled string message:', messageText);
              // Optionally set an error or leave status as is
          }

      } else {
          // Handle binary data or other types if necessary
          console.log('Received non-string WebSocket message:', typeof event.data);
      }
    };

    ws.current.onerror = (event) => {
      console.error('WebSocket Error:', event);
      setError(event instanceof Error ? event : new Error('WebSocket error occurred')); // Store the error event
      setReadyState(ws.current?.readyState ?? WebSocket.CLOSED);
    };

    ws.current.onclose = (event) => {
      console.log(`WebSocket Closed: Code=${event.code}, Reason=${event.reason}, Clean=${event.wasClean}`);
      const manualClose = isManualClose.current; // Capture flag before resetting
      isManualClose.current = false; // Reset flag

      setIsConnected(false);
      setReadyState(ws.current?.readyState ?? WebSocket.CLOSED);
      setGameStatus('CLOSED'); // Set status to CLOSED on disconnect
      setCurrentTheme(null); // Clear theme on disconnect
      ws.current = null; // Ensure ws ref is nullified

      // Attempt to reconnect ONLY if the closure was unexpected and NOT manual
      if (!manualClose && !event.wasClean && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current++;
        console.log(`Attempting to reconnect (${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})...`);
        reconnectTimeout.current = setTimeout(connect, RECONNECT_INTERVAL_MS * Math.pow(2, reconnectAttempts.current -1)); // Exponential backoff
      } else if (!manualClose && !event.wasClean) {
          console.error('WebSocket reconnect limit reached.');
          setError(new Error('WebSocket connection lost and reconnect limit reached.'));
      } else if (manualClose) {
          console.log('WebSocket closed manually, reconnection prevented.');
      }
    };

  }, [roomId, userId]); // Dependencies for connection logic

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

  // Effect to establish and clean up the connection
  useEffect(() => {
    if (roomId && userId) {
      connect();
    } else {
        // If roomId or userId becomes null, ensure cleanup
        if (ws.current) {
            console.log("Closing WebSocket due to missing roomId or userId.");
            isManualClose.current = true; // Prevent reconnect on this close
            ws.current.close(1000, "Client disconnected"); // Clean close
            ws.current = null;
            setIsConnected(false);
            setReadyState(WebSocket.CLOSED);
            setGameStatus('CLOSED');
            setCurrentTheme(null);
        }
        if (reconnectTimeout.current) {
            clearTimeout(reconnectTimeout.current);
            reconnectTimeout.current = null;
        }
    }

    // Cleanup function
    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (ws.current) {
        console.log('Closing WebSocket connection on component unmount or dependency change.');
        isManualClose.current = true; // Prevent reconnect on cleanup close
        ws.current.close(1000, "Client disconnected"); // Use standard code for normal closure
        ws.current = null;
      }
       setIsConnected(false);
       setReadyState(WebSocket.CLOSED);
       setGameStatus('CLOSED');
       setCurrentTheme(null);
    };
  }, [roomId, userId, connect]); // Re-run effect if roomId, userId, or connect function changes

  // Function to send messages
  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      try {
        // Expecting message to be a string for this game's protocol based on user description
        const messageString = typeof message === 'string' ? message : JSON.stringify(message);
        console.log('Sending WebSocket Message:', messageString);
        ws.current.send(messageString);
      } catch (e) {
        console.error('Failed to send WebSocket message:', message, e);
         setError(e instanceof Error ? e : new Error('Failed to send message'));
      }
    } else {
      console.warn('WebSocket not connected. Cannot send message.');
       setError(new Error('WebSocket not connected.'));
    }
  }, []); // No dependencies needed as it uses the ref

  // Function to manually close the connection
  const closeConnection = useCallback(() => {
      if (ws.current) {
          console.log('Manually closing WebSocket connection.');
          isManualClose.current = true; // Set flag to prevent reconnection
          ws.current.close(1000, "User initiated disconnect"); // Normal closure
          // State updates will happen in the onclose handler
          ws.current = null; // Nullify ref immediately
          // Explicitly update state here as well for immediate feedback if needed,
          // though onclose should handle it.
          setIsConnected(false);
          setReadyState(WebSocket.CLOSING); // Indicate closing state
          setGameStatus('CLOSED');
          setCurrentTheme(null);
      }
      if (reconnectTimeout.current) {
          clearTimeout(reconnectTimeout.current); // Prevent any pending reconnect
          reconnectTimeout.current = null;
      }
  }, []); // No dependencies

  // Return object including the new closeConnection function
  return {
    isConnected,
    error,
    sendMessage,
    readyState,
    gameStatus,
    currentTheme,
    closeConnection,
    handleApiError, // Add the new error handling function
  };
}