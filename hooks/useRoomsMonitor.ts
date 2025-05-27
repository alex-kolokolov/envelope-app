// Hook для работы с мониторингом комнат через RoomsWebSocketManager
import { useState, useEffect, useRef } from 'react';
import RoomsWebSocketManager, { type RoomEventWithPlayer } from '../lib/websocket/RoomsWebSocketManager';

interface UseRoomsMonitorReturn {
  isConnected: boolean;
  error: Event | Error | string | null;
  readyState: number;
  roomEvents: Record<string, RoomEventWithPlayer[]>;
  startMonitoring: () => void;
  stopMonitoring: () => void;
}

/**
 * Hook для мониторинга событий всех комнат
 * Использует новую архитектуру WebSocket с RoomsWebSocketManager
 */
export function useRoomsMonitor(): UseRoomsMonitorReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Event | Error | string | null>(null);
  const [readyState, setReadyState] = useState<number>(WebSocket.CLOSED);
  const [roomEvents, setRoomEvents] = useState<Record<string, RoomEventWithPlayer[]>>({});
  
  const wsManager = useRef(RoomsWebSocketManager.getInstance());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const isMonitoring = useRef(false);

  const startMonitoring = () => {
    if (isMonitoring.current) {
      console.log('[useRoomsMonitor] Already monitoring');
      return;
    }

    console.log('[useRoomsMonitor] Starting rooms monitoring');
    isMonitoring.current = true;

    const subscriber = {
      onConnectionChange: (connected: boolean) => {
        console.log('[useRoomsMonitor] Connection changed:', connected);
        setIsConnected(connected);
      },
      
      onReadyStateChange: (state: number) => {
        console.log('[useRoomsMonitor] Ready state changed:', state);
        setReadyState(state);
      },
      
      onError: (err: Event | Error | string | null) => {
        console.error('[useRoomsMonitor] Error:', err);
        setError(err);
      },
      
      onRoomEvent: (roomId: string, event: RoomEventWithPlayer) => {
        console.log('[useRoomsMonitor] Room event:', roomId, event);
        setRoomEvents(prev => {
          const roomEventsList = prev[roomId] || [];
          return {
            ...prev,
            [roomId]: [...roomEventsList, event]
          };
        });
      }
    };

    unsubscribeRef.current = wsManager.current.subscribe(subscriber);
  };

  const stopMonitoring = () => {
    if (!isMonitoring.current) {
      console.log('[useRoomsMonitor] Not monitoring');
      return;
    }

    console.log('[useRoomsMonitor] Stopping rooms monitoring');
    isMonitoring.current = false;

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

  // Cleanup при размонтировании
  useEffect(() => {
    return () => {
      console.log('[useRoomsMonitor] Hook unmounting');
      stopMonitoring();
    };
  }, []);

  return {
    isConnected,
    error,
    readyState,
    roomEvents,
    startMonitoring,
    stopMonitoring,
  };
}
