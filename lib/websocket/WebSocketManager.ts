// WebSocket Manager - Singleton для управления WebSocket соединениями
import { WEBSOCKET_URL } from '../api/client';

export type GameStatus =
  | 'UNKNOWN'
  | 'WAITING_FOR_PLAYERS'
  | 'MAIN_PLAYER_THINKING'
  | 'THEME_INPUT'
  | 'SCENARIO_PRESENTED'
  | 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT'
  | 'WAITING_FOR_GPT'
  | 'WAITING_FOR_ALL_ANSWERS_FROM_GPT'
  | 'RESULTS_READY'
  | 'STATS_READY'
  | 'GAME_DONE'
  | 'CLOSED';

interface WebSocketConnection {
  ws: WebSocket;
  roomId: string;
  userId: string;
  isConnected: boolean;
  reconnectAttempts: number;
  reconnectTimeout: NodeJS.Timeout | number | null;
  isManualClose: boolean;
  subscribers: Set<WebSocketSubscriber>;
}

interface WebSocketSubscriber {
  onStatusChange: (status: GameStatus) => void;
  onThemeChange: (theme: string | null) => void;
  onConnectionChange: (isConnected: boolean) => void;
  onError: (error: Event | Error | null) => void;
  onSystemMessage: (message: string, hasAdminMessage: boolean) => void;
  onReadyStateChange: (readyState: number) => void;
}

class WebSocketManager {
  private connections: Map<string, WebSocketConnection> = new Map();
  private static instance: WebSocketManager | null = null;
  
  // Regex patterns for parsing system messages
  private statusRegex = /\[SYSTEM\]: Статус — (.*)/;
  private themeInputRegex = /\[SYSTEM\]: Главный игрок вводит тему/;
  private situationRegex = /\[SYSTEM\]: Ситуация: (.*)/;
  private resultRegex = /\[RESULT\]:/;
  private statsRegex = /\[ALL_STATS\]:/;
  private continueRegex = /\[SYSTEM\]: Вы хотите продолжить\? \[YES\/NO\]/;
  private resultThemeRegex = /\[RESULT\]:\s*(.*?)\s*→/; // Extract theme from result message
  
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_INTERVAL_MS = 3000;
  
  // Flag to determine if we're in React Native environment
  private isReactNative = typeof window === 'undefined' || typeof window.location === 'undefined';

  private constructor() {}

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  private getConnectionKey(roomId: string, userId: string): string {
    return `${roomId}:${userId}`;
  }

  subscribe(
    roomId: string,
    userId: string,
    subscriber: WebSocketSubscriber
  ): () => void {
    const key = this.getConnectionKey(roomId, userId);
    let connection = this.connections.get(key);

    if (!connection) {
      console.log(`[WebSocketManager] Creating new connection for ${key}`);
      connection = this.createConnection(roomId, userId);
      this.connections.set(key, connection);
    } else {
      console.log(`[WebSocketManager] Reusing existing connection for ${key}`);
    }

    connection.subscribers.add(subscriber);
    console.log(`[WebSocketManager] Added subscriber to ${key}. Total subscribers: ${connection.subscribers.size}`);
    
    // Немедленно уведомляем подписчика о текущем состоянии
    subscriber.onConnectionChange(connection.isConnected);
    subscriber.onReadyStateChange(connection.ws.readyState);

    // Возвращаем функцию отписки
    return () => {
      const conn = this.connections.get(key);
      if (conn) {
        conn.subscribers.delete(subscriber);
        console.log(`[WebSocketManager] Removed subscriber from ${key}. Remaining subscribers: ${conn.subscribers.size}`);
        
        // Если больше нет подписчиков, закрываем соединение через небольшую задержку
        if (conn.subscribers.size === 0) {
          console.log(`[WebSocketManager] No subscribers left for ${key}. Scheduling connection close in 5 seconds...`);
          setTimeout(() => {
            const currentConn = this.connections.get(key);
            if (currentConn && currentConn.subscribers.size === 0) {
              console.log(`[WebSocketManager] Closing unused connection for ${key}`);
              this.closeConnection(roomId, userId);
            } else if (currentConn) {
              console.log(`[WebSocketManager] Connection ${key} has new subscribers, keeping alive`);
            }
          }, 5000); // 5 секунд задержки перед закрытием
        }
      }
    };
  }

  private createConnection(roomId: string, userId: string): WebSocketConnection {
    const wsUrl = `${WEBSOCKET_URL}?roomId=${roomId}&userId=${userId}`;
    console.log(`[WebSocketManager] Creating new connection: ${wsUrl}`);
    
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      console.log(`[WebSocketManager] WebSocket instance created for ${roomId}:${userId}`);
    } catch (error) {
      console.error(`[WebSocketManager] Error creating WebSocket:`, error);
      // Create a mock WebSocket that's always closed
      ws = {
        readyState: WebSocket.CLOSED,
        close: () => {},
        send: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        CONNECTING: WebSocket.CONNECTING,
        OPEN: WebSocket.OPEN,
        CLOSING: WebSocket.CLOSING,
        CLOSED: WebSocket.CLOSED,
        url: wsUrl,
        binaryType: 'blob',
        bufferedAmount: 0,
        extensions: '',
        protocol: ''
      } as unknown as WebSocket;
    }
    
    const connection: WebSocketConnection = {
      ws,
      roomId,
      userId,
      isConnected: false,
      reconnectAttempts: 0,
      reconnectTimeout: null,
      isManualClose: false,
      subscribers: new Set()
    };

    this.setupWebSocketHandlers(connection);
    return connection;
  }

  private setupWebSocketHandlers(connection: WebSocketConnection) {
    const { ws } = connection;

    try {
      ws.onopen = () => {
        console.log(`[WebSocketManager] Connected to ${connection.roomId}:${connection.userId}`);
        connection.isConnected = true;
        connection.reconnectAttempts = 0;
        
        this.notifySubscribers(connection, 'onConnectionChange', true);
        try {
          this.notifySubscribers(connection, 'onReadyStateChange', ws.readyState);
        } catch (error) {
          console.error(`[WebSocketManager] Error getting readyState in onopen:`, error);
          this.notifySubscribers(connection, 'onReadyStateChange', WebSocket.OPEN); // Assume OPEN state
        }
        this.notifySubscribers(connection, 'onError', null);
      };

      ws.onmessage = (event) => {
        this.handleMessage(connection, event);
      };

      ws.onerror = (event) => {
        console.error(`[WebSocketManager] Error for ${connection.roomId}:${connection.userId}:`, event);
        const error = event instanceof Error ? event : new Error('WebSocket error occurred');
        this.notifySubscribers(connection, 'onError', error);
        try {
          this.notifySubscribers(connection, 'onReadyStateChange', ws.readyState);
        } catch (err) {
          console.error(`[WebSocketManager] Error getting readyState in onerror:`, err);
          this.notifySubscribers(connection, 'onReadyStateChange', WebSocket.CLOSING); // Assume CLOSING state
        }
      };

      ws.onclose = (event) => {
        console.log(`[WebSocketManager] Closed ${connection.roomId}:${connection.userId}: Code=${event.code}, Reason=${event.reason}`);
        
        connection.isConnected = false;
        this.notifySubscribers(connection, 'onConnectionChange', false);
        try {
          this.notifySubscribers(connection, 'onReadyStateChange', ws.readyState);
        } catch (err) {
          console.error(`[WebSocketManager] Error getting readyState in onclose:`, err);
          this.notifySubscribers(connection, 'onReadyStateChange', WebSocket.CLOSED); // Assume CLOSED state
        }
        this.notifySubscribers(connection, 'onStatusChange', 'CLOSED');
        this.notifySubscribers(connection, 'onThemeChange', null);

        // Попытка переподключения только если закрытие не было ручным
        if (!connection.isManualClose && !event.wasClean && 
            connection.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect(connection);
        } else if (!connection.isManualClose && !event.wasClean) {
          console.error(`[WebSocketManager] Reconnect limit reached for ${connection.roomId}:${connection.userId}`);
          this.notifySubscribers(connection, 'onError', 
            new Error('WebSocket connection lost and reconnect limit reached.'));
        }
      };
    } catch (error) {
      console.error(`[WebSocketManager] Error setting up WebSocket handlers:`, error);
      // If we fail to set up handlers, notify subscribers of the error
      this.notifySubscribers(connection, 'onError', 
        error instanceof Error ? error : new Error('Failed to set up WebSocket handlers'));
    }
  }

  private scheduleReconnect(connection: WebSocketConnection) {
    connection.reconnectAttempts++;
    const delay = this.RECONNECT_INTERVAL_MS * Math.pow(2, connection.reconnectAttempts - 1);
    
    console.log(`[WebSocketManager] Scheduling reconnect ${connection.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    
    connection.reconnectTimeout = setTimeout(() => {
      if (connection.subscribers.size > 0) { // Переподключаемся только если есть подписчики
        this.reconnect(connection);
      }
    }, delay);
  }

  private reconnect(connection: WebSocketConnection) {
    const key = this.getConnectionKey(connection.roomId, connection.userId);
    console.log(`[WebSocketManager] Reconnecting ${key}`);
    
    // Создаем новое соединение
    const newConnection = this.createConnection(connection.roomId, connection.userId);
    newConnection.subscribers = connection.subscribers; // Переносим подписчиков
    newConnection.reconnectAttempts = connection.reconnectAttempts; // Сохраняем счетчик попыток
    
    // Заменяем соединение в карте
    this.connections.set(key, newConnection);
  }

  private handleMessage(connection: WebSocketConnection, event: MessageEvent) {
    console.log(`[WebSocketManager] Message for ${connection.roomId}:${connection.userId}:`, event.data);
    
    if (typeof event.data !== 'string') {
      console.log('[WebSocketManager] Received non-string message:', typeof event.data);
      return;
    }

    const messageText = event.data;
    let statusUpdated = false;
    let hasAdminMessage = false;

    // Парсинг системных сообщений
    const statusMatch = messageText.match(this.statusRegex);
    if (statusMatch && statusMatch[1]) {
      const rawStatus = statusMatch[1].trim() as GameStatus;
      this.notifySubscribers(connection, 'onStatusChange', rawStatus);
      console.log(`[WebSocketManager] Parsed Game Status: ${rawStatus}`);
      statusUpdated = true;
    } else if (this.themeInputRegex.test(messageText)) {
      this.notifySubscribers(connection, 'onStatusChange', 'THEME_INPUT');
      console.log('[WebSocketManager] Parsed Game Status: THEME_INPUT - NON-ADMIN ROLE');
      statusUpdated = true;
    } else if (this.situationRegex.test(messageText)) {
      const situationMatch = messageText.match(this.situationRegex);
      if (situationMatch && situationMatch[1]) {
        const theme = situationMatch[1].trim();
        this.notifySubscribers(connection, 'onThemeChange', theme);
        this.notifySubscribers(connection, 'onStatusChange', 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT');
        console.log(`[WebSocketManager] 🔄 Parsed Game Status: WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT, Theme: ${theme}, RoomId: ${connection.roomId}, UserId: ${connection.userId}`);
        
        // Enhanced debug information for navigation flow
        console.log(`[WebSocketManager] 🚨 CRITICAL NAVIGATION POINT - All participants should navigate to answer.tsx`);
        console.log(`[WebSocketManager] 📱 Current subscribers count: ${connection.subscribers.size}`);
        
        statusUpdated = true;
      }
    } else if (messageText === '[SYSTEM]: Ответ сохранён') {
      this.notifySubscribers(connection, 'onStatusChange', 'WAITING_FOR_GPT');
      console.log('[WebSocketManager] Parsed Game Status: WAITING_FOR_GPT');
      statusUpdated = true;
    } else if (this.resultRegex.test(messageText)) {
      this.notifySubscribers(connection, 'onStatusChange', 'RESULTS_READY');
      console.log('[WebSocketManager] 📊 Parsed Game Status: RESULTS_READY');
      
      // Try to extract theme from result message format: "[RESULT]: theme → outcome"
      const resultTextMatch = messageText.match(/\[RESULT\]:\s*(.*?)\s*→/);
      if (resultTextMatch && resultTextMatch[1]) {
        const theme = resultTextMatch[1].trim();
        console.log(`[WebSocketManager] 📝 Extracted theme from result: "${theme}"`);
        // Notify about theme extraction
        this.notifySubscribers(connection, 'onThemeChange', theme);
      }
      
      statusUpdated = true;
    } else if (this.statsRegex.test(messageText)) {
      this.notifySubscribers(connection, 'onStatusChange', 'STATS_READY');
      console.log('[WebSocketManager] 📊 Parsed Game Status: STATS_READY');
      statusUpdated = true;
    } else if (this.continueRegex.test(messageText)) {
      // No status change, but handle the continue prompt
      console.log('[WebSocketManager] 🔄 Received continue prompt: "Вы хотите продолжить? [YES/NO]"');
      // Notify all subscribers about this specific system message
      statusUpdated = true;
    } else if (messageText === '[SYSTEM]: Введите ситуацию') {
      this.notifySubscribers(connection, 'onStatusChange', 'MAIN_PLAYER_THINKING');
      hasAdminMessage = true;
      console.log('[WebSocketManager] 🔑 Parsed Game Status: MAIN_PLAYER_THINKING - ADMIN ROLE DETECTED');
      console.log('[WebSocketManager] 🔑 Setting hasAdminMessage=true for:', connection.userId);
      statusUpdated = true;
    }

    // Уведомляем о системном сообщении
    this.notifySubscribers(connection, 'onSystemMessage', messageText, hasAdminMessage);

    if (statusUpdated) {
      this.notifySubscribers(connection, 'onError', null); // Очищаем ошибки при успешном парсинге
    } else {
      console.warn('[WebSocketManager] Unhandled message:', messageText);
    }
  }

  private notifySubscribers<K extends keyof WebSocketSubscriber>(
    connection: WebSocketConnection,
    method: K,
    ...args: Parameters<WebSocketSubscriber[K]>
  ) {
    try {
      if (!connection || !connection.subscribers) {
        console.error(`[WebSocketManager] Cannot notify subscribers - connection or subscribers is undefined`);
        return;
      }
      
      connection.subscribers.forEach(subscriber => {
        try {
          if (subscriber && typeof subscriber[method] === 'function') {
            (subscriber[method] as any)(...args);
          } else {
            console.warn(`[WebSocketManager] Subscriber doesn't have method: ${String(method)}`);
          }
        } catch (error) {
          console.error(`[WebSocketManager] Error notifying subscriber with method ${String(method)}:`, error);
        }
      });
    } catch (error) {
      console.error(`[WebSocketManager] Error in notifySubscribers:`, error);
    }
  }

  sendMessage(roomId: string, userId: string, message: any): boolean {
    const key = this.getConnectionKey(roomId, userId);
    const connection = this.connections.get(key);

    if (!connection) {
      console.warn(`[WebSocketManager] Cannot send message - connection not found for ${key}`);
      return false;
    }
    
    try {
      if (connection.ws.readyState !== WebSocket.OPEN) {
        console.warn(`[WebSocketManager] Cannot send message - connection not ready for ${key}, readyState: ${connection.ws.readyState}`);
        return false;
      }

      const messageString = typeof message === 'string' ? message : JSON.stringify(message);
      console.log(`[WebSocketManager] Sending message for ${key}:`, messageString);
      connection.ws.send(messageString);
      return true;
    } catch (error) {
      console.error(`[WebSocketManager] Failed to send message for ${key}:`, error);
      if (connection) {
        this.notifySubscribers(connection, 'onError', 
          error instanceof Error ? error : new Error('Failed to send message'));
      }
      return false;
    }
  }

  closeConnection(roomId: string, userId: string) {
    const key = this.getConnectionKey(roomId, userId);
    const connection = this.connections.get(key);

    if (connection) {
      console.log(`[WebSocketManager] Closing connection ${key}`);
      connection.isManualClose = true;
      
      if (connection.reconnectTimeout) {
        clearTimeout(connection.reconnectTimeout);
        connection.reconnectTimeout = null;
      }
      
      try {
        if (connection.ws.readyState === WebSocket.OPEN || connection.ws.readyState === WebSocket.CONNECTING) {
          connection.ws.close(1000, "User initiated disconnect");
        }
      } catch (error) {
        console.error(`[WebSocketManager] Error closing connection ${key}:`, error);
      }
      
      this.connections.delete(key);
    }
  }

  getReadyState(roomId: string, userId: string): number {
    const key = this.getConnectionKey(roomId, userId);
    const connection = this.connections.get(key);
    try {
      return connection ? connection.ws.readyState : WebSocket.CLOSED;
    } catch (error) {
      console.error(`[WebSocketManager] Error getting readyState for ${key}:`, error);
      return WebSocket.CLOSED;
    }
  }

  isConnected(roomId: string, userId: string): boolean {
    const key = this.getConnectionKey(roomId, userId);
    const connection = this.connections.get(key);
    return connection ? connection.isConnected : false;
  }

  // Метод для получения статистики соединений (для отладки)
  getConnectionStats(): Array<{
    key: string;
    roomId: string;
    userId: string;
    isConnected: boolean;
    readyState: number;
    subscribersCount: number;
    reconnectAttempts: number;
  }> {
    const stats: Array<any> = [];
    
    this.connections.forEach((connection, key) => {
      stats.push({
        key,
        roomId: connection.roomId,
        userId: connection.userId,
        isConnected: connection.isConnected,
        readyState: connection.ws.readyState,
        subscribersCount: connection.subscribers.size,
        reconnectAttempts: connection.reconnectAttempts,
      });
    });
    
    return stats;
  }

  // Метод для принудительного закрытия всех соединений
  closeAllConnections(): void {
    console.log(`[WebSocketManager] Closing all connections (${this.connections.size} total)`);
    
    this.connections.forEach((connection, key) => {
      console.log(`[WebSocketManager] Force closing connection ${key}`);
      connection.isManualClose = true;
      
      if (connection.reconnectTimeout) {
        clearTimeout(connection.reconnectTimeout);
      }
      
      try {
        if (connection.ws.readyState === WebSocket.OPEN || 
            connection.ws.readyState === WebSocket.CONNECTING) {
          connection.ws.close(1000, "Manager shutdown");
        }
      } catch (error) {
        console.error(`[WebSocketManager] Error closing connection ${key}:`, error);
      }
    });
    
    this.connections.clear();
  }
}

export default WebSocketManager;
