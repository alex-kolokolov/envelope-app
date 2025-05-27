import React, { createContext, useContext, ReactNode } from 'react';
import { useRoomsMonitor } from '../hooks/useRoomsMonitor';
import type { RoomEvent, RoomEventWithPlayer } from '../lib/websocket/RoomsWebSocketManager';

// Re-export types for backward compatibility
export type { RoomEvent, RoomEventWithPlayer };

// Define the state and functions provided by the context
export interface RoomsMonitorContextState {
  isConnected: boolean;
  error: Event | Error | string | null;
  readyState: number;
  roomEvents: Record<string, RoomEventWithPlayer[]>; // Map roomId to events array with player info
  startMonitoring: () => void;
  stopMonitoring: () => void;
}

// Create the context with undefined default value
export const RoomsMonitorContext = createContext<RoomsMonitorContextState | undefined>(undefined);

interface RoomsMonitorProviderProps {
  children: ReactNode;
}

/**
 * Обновленный провайдер, использующий новую WebSocket архитектуру
 * через RoomsWebSocketManager и useRoomsMonitor хук
 */
export const RoomsMonitorProvider: React.FC<RoomsMonitorProviderProps> = ({ children }) => {
  // Используем новый хук вместо прямого управления WebSocket
  const roomsMonitorData = useRoomsMonitor();

  console.log('[RoomsMonitorProvider] Rendering with state:', {
    isConnected: roomsMonitorData.isConnected,
    readyState: roomsMonitorData.readyState,
    roomEventsCount: Object.keys(roomsMonitorData.roomEvents).length
  });

  return (
    <RoomsMonitorContext.Provider value={roomsMonitorData}>
      {children}
    </RoomsMonitorContext.Provider>
  );
};

/**
 * Hook для использования контекста мониторинга комнат
 */
export const useRoomsMonitorContext = (): RoomsMonitorContextState => {
  const context = useContext(RoomsMonitorContext);
  if (!context) {
    throw new Error('useRoomsMonitorContext must be used within a RoomsMonitorProvider');
  }
  return context;
};
