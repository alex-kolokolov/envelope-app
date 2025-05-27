// RoomsWebSocketManager - Singleton для управления WebSocket соединения мониторинга комнат
import { WEBSOCKET_ROOMS_URL } from '../api/client';

// Define room event types based on the protocol
export type RoomEvent = 
  | 'CREATED' 
  | 'PLAYER_JOINED' 
  | 'FORCE_STARTED' 
  | 'ANSWERS_EVALUATED' 
  | 'CONTINUED' 
  | 'CLOSED';

// Type for room event with player information
export type RoomEventWithPlayer = {
  type: RoomEvent;
  player?: string; // For PLAYER_JOINED events which include player nickname
};

interface RoomsWebSocketConnection {
  ws: WebSocket;
  isConnected: boolean;
  reconnectAttempts: number;
  reconnectTimeout: NodeJS.Timeout | number | null;
  isManualClose: boolean;
  subscribers: Set<RoomsWebSocketSubscriber>;
  keepAliveInterval: NodeJS.Timeout | number | null;
}

interface RoomsWebSocketSubscriber {
  onConnectionChange: (isConnected: boolean) => void;
  onReadyStateChange: (readyState: number) => void;
  onError: (error: Event | Error | string | null) => void;
  onRoomEvent: (roomId: string, event: RoomEventWithPlayer) => void;
}

/**
 * Singleton для управления WebSocket соединением мониторинга комнат
 * Отличается от WebSocketManager тем, что:
 * - Использует один глобальный канал мониторинга (/ws/rooms)
 * - Обрабатывает события всех комнат в одном потоке
 * - Не привязан к конкретной комнате или пользователю
 */
class RoomsWebSocketManager {
  private connection: RoomsWebSocketConnection | null = null;
  private static instance: RoomsWebSocketManager | null = null;
  
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_INTERVAL_MS = 3000;
  private readonly KEEP_ALIVE_INTERVAL_MS = 30000;

  private constructor() {}

  static getInstance(): RoomsWebSocketManager {
    if (!RoomsWebSocketManager.instance) {
      RoomsWebSocketManager.instance = new RoomsWebSocketManager();
    }
    return RoomsWebSocketManager.instance;
  }

  /**
   * Подписка на события мониторинга комнат
   */
  subscribe(subscriber: RoomsWebSocketSubscriber): () => void {
    if (!this.connection) {
      console.log('[RoomsWebSocketManager] Creating new rooms monitoring connection');
      this.connection = this.createConnection();
    } else {
      console.log('[RoomsWebSocketManager] Reusing existing rooms monitoring connection');
    }

    this.connection.subscribers.add(subscriber);
    console.log(`[RoomsWebSocketManager] Added subscriber. Total subscribers: ${this.connection.subscribers.size}`);
    
    // Немедленно уведомляем подписчика о текущем состоянии
    subscriber.onConnectionChange(this.connection.isConnected);
    subscriber.onReadyStateChange(this.connection.ws.readyState);

    // Возвращаем функцию отписки
    return () => {
      if (this.connection) {
        this.connection.subscribers.delete(subscriber);
        console.log(`[RoomsWebSocketManager] Removed subscriber. Remaining subscribers: ${this.connection.subscribers.size}`);
        
        // Если больше нет подписчиков, закрываем соединение через задержку
        if (this.connection.subscribers.size === 0) {
          console.log('[RoomsWebSocketManager] No subscribers left. Scheduling connection close in 5 seconds...');
          setTimeout(() => {
            if (this.connection && this.connection.subscribers.size === 0) {
              console.log('[RoomsWebSocketManager] Closing unused rooms monitoring connection');
              this.closeConnection();
            } else if (this.connection) {
              console.log('[RoomsWebSocketManager] Connection has new subscribers, keeping alive');
            }
          }, 5000);
        }
      }
    };
  }

  private createConnection(): RoomsWebSocketConnection {
    console.log(`[RoomsWebSocketManager] Creating connection to ${WEBSOCKET_ROOMS_URL}`);
    
    const ws = new WebSocket(WEBSOCKET_ROOMS_URL);
    
    const connection: RoomsWebSocketConnection = {
      ws,
      isConnected: false,
      reconnectAttempts: 0,
      reconnectTimeout: null,
      isManualClose: false,
      subscribers: new Set(),
      keepAliveInterval: null,
    };

    this.setupWebSocketHandlers(connection);
    return connection;
  }

  private setupWebSocketHandlers(connection: RoomsWebSocketConnection) {
    const { ws } = connection;

    ws.onopen = () => {
      console.log('[RoomsWebSocketManager] Rooms monitoring connection opened');
      connection.isConnected = true;
      connection.reconnectAttempts = 0;
      this.notifySubscribers(connection, 'onConnectionChange', true);
      this.notifySubscribers(connection, 'onReadyStateChange', ws.readyState);
      this.startKeepAlive(connection);
    };

    ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(connection, event);
    };

    ws.onerror = (event: Event) => {
      console.error('[RoomsWebSocketManager] WebSocket error:', event);
      connection.isConnected = false;
      this.notifySubscribers(connection, 'onConnectionChange', false);
      this.notifySubscribers(connection, 'onError', event);
    };

    ws.onclose = (event: CloseEvent) => {
      console.log(`[RoomsWebSocketManager] Connection closed: Code=${event.code}, Reason=${event.reason}`);
      
      connection.isConnected = false;
      this.notifySubscribers(connection, 'onConnectionChange', false);
      this.notifySubscribers(connection, 'onReadyStateChange', ws.readyState);
      this.clearKeepAlive(connection);

      // Попытка переподключения только если закрытие не было ручным
      if (!connection.isManualClose && !event.wasClean && 
          connection.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.scheduleReconnect(connection);
      } else if (!connection.isManualClose && !event.wasClean) {
        console.error('[RoomsWebSocketManager] Reconnect limit reached');
        this.notifySubscribers(connection, 'onError', 'Failed to connect to rooms monitor after maximum attempts');
      }
    };
  }

  private handleMessage(connection: RoomsWebSocketConnection, event: MessageEvent) {
    console.log('[RoomsWebSocketManager] Message received:', event.data);
    
    if (typeof event.data !== 'string') {
      console.log('[RoomsWebSocketManager] Received non-string message:', typeof event.data);
      return;
    }

    try {
      const message = event.data;
      
      // Parse the message format "<roomId> : <ACTION>" or "<roomId> : PLAYER_JOINED (Nick)"
      const match = message.match(/^([^:]+)\s*:\s*(.+)$/);
      
      if (match) {
        const roomId = match[1].trim();
        const actionText = match[2].trim();
        
        // Check for PLAYER_JOINED with nickname in parentheses
        const playerJoinedMatch = actionText.match(/PLAYER_JOINED\s*\((.+)\)/);
        
        let eventObj: RoomEventWithPlayer;
        
        if (playerJoinedMatch) {
          // It's a player joined event with player info
          const playerName = playerJoinedMatch[1].trim();
          eventObj = {
            type: 'PLAYER_JOINED',
            player: playerName
          };
        } else if ([
          'CREATED', 'FORCE_STARTED', 'ANSWERS_EVALUATED', 'CONTINUED', 'CLOSED'
        ].includes(actionText)) {
          // It's one of the standard events
          eventObj = {
            type: actionText as RoomEvent
          };
        } else {
          // Unknown event type - store as is
          console.warn('[RoomsWebSocketManager] Unknown room event type:', actionText);
          eventObj = {
            type: 'CREATED', // Fallback
            player: actionText // Store full text in player field as fallback
          };
        }
        
        // Уведомляем всех подписчиков о событии комнаты
        this.notifySubscribers(connection, 'onRoomEvent', roomId, eventObj);
      } else {
        console.warn('[RoomsWebSocketManager] Received unrecognized room event format:', message);
      }
    } catch (e) {
      console.error('[RoomsWebSocketManager] Error parsing message:', e);
      this.notifySubscribers(connection, 'onError', e instanceof Error ? e.message : 'Failed to parse message');
    }
  }

  private startKeepAlive(connection: RoomsWebSocketConnection) {
    this.clearKeepAlive(connection);
    
    console.log('[RoomsWebSocketManager] Starting keep-alive interval');
    connection.keepAliveInterval = setInterval(() => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(JSON.stringify({ type: 'ping' }));
          console.log('[RoomsWebSocketManager] Ping sent');
        } catch (e) {
          console.error('[RoomsWebSocketManager] Failed to send ping:', e);
        }
      } else {
        console.log('[RoomsWebSocketManager] WebSocket not open, skipping ping');
      }
    }, this.KEEP_ALIVE_INTERVAL_MS);
  }

  private clearKeepAlive(connection: RoomsWebSocketConnection) {
    if (connection.keepAliveInterval) {
      clearInterval(connection.keepAliveInterval as NodeJS.Timeout);
      connection.keepAliveInterval = null;
      console.log('[RoomsWebSocketManager] Keep-alive interval cleared');
    }
  }

  private scheduleReconnect(connection: RoomsWebSocketConnection) {
    connection.reconnectAttempts += 1;
    console.log(`[RoomsWebSocketManager] Scheduling reconnect ${connection.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${this.RECONNECT_INTERVAL_MS}ms`);
    
    connection.reconnectTimeout = setTimeout(() => {
      this.reconnect(connection);
    }, this.RECONNECT_INTERVAL_MS);
  }

  private reconnect(connection: RoomsWebSocketConnection) {
    console.log('[RoomsWebSocketManager] Reconnecting...');
    
    // Создаем новое соединение
    const newConnection = this.createConnection();
    newConnection.subscribers = connection.subscribers; // Переносим подписчиков
    newConnection.reconnectAttempts = connection.reconnectAttempts; // Сохраняем счетчик попыток
    
    // Заменяем соединение
    this.connection = newConnection;
  }

  private notifySubscribers<K extends keyof RoomsWebSocketSubscriber>(
    connection: RoomsWebSocketConnection,
    method: K,
    ...args: Parameters<RoomsWebSocketSubscriber[K]>
  ) {
    connection.subscribers.forEach(subscriber => {
      try {
        (subscriber[method] as any)(...args);
      } catch (error) {
        console.error(`[RoomsWebSocketManager] Error notifying subscriber:`, error);
      }
    });
  }

  /**
   * Принудительное закрытие соединения
   */
  closeConnection(): void {
    if (this.connection) {
      console.log('[RoomsWebSocketManager] Manually closing connection');
      this.connection.isManualClose = true;
      this.clearKeepAlive(this.connection);
      
      if (this.connection.reconnectTimeout) {
        clearTimeout(this.connection.reconnectTimeout as NodeJS.Timeout);
        this.connection.reconnectTimeout = null;
      }
      
      this.connection.ws.close(1000, 'User initiated disconnect');
      this.connection = null;
    }
  }

  /**
   * Проверка состояния соединения
   */
  isConnected(): boolean {
    return this.connection ? this.connection.isConnected : false;
  }

  /**
   * Получение состояния WebSocket
   */
  getReadyState(): number {
    return this.connection ? this.connection.ws.readyState : WebSocket.CLOSED;
  }

  /**
   * Получение статистики для отладки
   */
  getConnectionStats() {
    if (!this.connection) {
      return null;
    }

    return {
      isConnected: this.connection.isConnected,
      readyState: this.connection.ws.readyState,
      subscribersCount: this.connection.subscribers.size,
      reconnectAttempts: this.connection.reconnectAttempts,
    };
  }
}

export default RoomsWebSocketManager;
