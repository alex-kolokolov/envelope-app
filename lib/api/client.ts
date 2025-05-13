// Base URL for the API
const BASE_URL = "http://103.137.250.117:6952"; // Replace with your actual base URL

// --- Enums ---
export enum RoomStatus {
  WAITING_FOR_PLAYERS = "WAITING_FOR_PLAYERS",
  MAIN_PLAYER_THINKING = "MAIN_PLAYER_THINKING",
  WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT = "WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT",
  WAITING_FOR_ALL_ANSWERS_FROM_GPT = "WAITING_FOR_ALL_ANSWERS_FROM_GPT",
  GAME_DONE = "GAME_DONE",
  CLOSED = "CLOSED",
}

// --- API Response/Request Types (Based on Swagger Schemas) ---

export interface Player {
  id: string; // Уникальный идентификатор игрока
  name: string; // Ник игрока
  admin: boolean;
}

export interface CreateGameResult {
  roomId: string; // Идентификатор комнаты
  userId: string; // Сгенерированный ID создателя комнаты
  admin: boolean;
}

export interface ConnectGameResult {
  roomId: string; // Идентификатор комнаты
  userId: string; // Сгенерированный ID создателя комнаты
  admin: boolean;
}

export interface Theme {
  theme: string;
}

export interface PlayerStats {
  survivedCount: number; // Сколько раз выжил
  diedCount: number; // Сколько раз не выжил
}

export interface PlayerRoundResult {
  userAnswer: string; // Что ввёл игрок
  result: string; // Оценка GPT: выжил или нет
  gptAnswer: string; // Что предложил GPT
}

export interface RoomSummary {
  players: string[]; // Список ников всех игроков
  admin: string; // Ник администратора комнаты
}

export interface RoomInfo {
  id: string; // ID комнаты
  status: RoomStatus; // Статус комнаты
  capacity: number; // Вместимость комнаты
  currentPrompt: string; // Текущая тема
  players: Player[]; // Список игроков
  rawAnswers: Record<string, string>; // Сырые ответы пользователей (userId → answer)
  roundResults: Record<string, PlayerRoundResult>; // Полные результаты раунда (userId → { userAnswer, result, gptAnswer })
  stats: Record<string, PlayerStats>; // Статистика пользователей (userId → { survivedCount, diedCount })
}

export interface RoomCache {
  id: string; // ID комнаты
  status: RoomStatus; // Статус комнаты
  capacity: number; // Вместимость комнаты
  players: Player[]; // Список игроков
}

// --- API Client Functions (To be implemented) ---

// Example function structure
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      // Attempt to read error details from the response body
      let errorBody = null;
      try {
        errorBody = await response.json();
      } catch (e) {
        // Ignore if the body isn't valid JSON
      }
      console.error(`API Error: ${response.status} ${response.statusText}`, errorBody);
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
    }
    // Handle cases where the response might be empty (e.g., 200 OK with no content)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      return await response.json() as T;
    } else {
      // Return null or an appropriate value for non-JSON responses or empty bodies
      return null as T; // Adjust as needed based on expected non-JSON responses
    }
  } catch (error) {
    console.error("Fetch error:", error);
    throw error; // Re-throw the error after logging
  }
}

// --- Games API ---

/**
 * Получить все открытые игры (комнаты)
 */
export async function getAllOpenedGames(): Promise<RoomCache[]> {
  return apiFetch<RoomCache[]>("/games/open");
}

/**
 * Создать новую игру (комнату)
 * @param nick - Nickname of the creator
 * @param capacity - Maximum number of players
 */
export async function createGame(nick: string, capacity: number): Promise<CreateGameResult> {
  const params = new URLSearchParams({ nick, capacity: capacity.toString() });
  return apiFetch<CreateGameResult>(`/games/create?${params.toString()}`, {
    method: "POST",
  });
}

/**
 * Подключиться к открытой игре (комнате)
 * @param roomId - ID of the room to connect to
 * @param nick - Nickname of the player connecting
 */
export async function connectToOpenedGame(roomId: string, nick: string): Promise<ConnectGameResult> {
  const params = new URLSearchParams({ roomId, nick });
  return apiFetch<ConnectGameResult>(`/games/connect?${params.toString()}`, {
    method: "POST",
  });
}

/**
 * Принудительно стартовать игру (комнату)
 * @param roomId - ID of the room to start
 * @throws {Error} - If the API call fails.
 */
export async function forceStartGame(roomId: string): Promise<void> {
  const params = new URLSearchParams({ roomId });
  
  try {
    // Make the API call to force start the game
    await apiFetch<null>(`/games/forceStart?${params.toString()}`, {
      method: "POST",
    });
    
    // After successful force start, get the room status
    const status = await getRoomStatus(roomId);
    
    // If the status is MAIN_PLAYER_THINKING, the game should be started
    if (status === RoomStatus.MAIN_PLAYER_THINKING) {
      console.log("Game successfully started, status is MAIN_PLAYER_THINKING");
      // Additional game start logic can be added here if needed
      return;
    } else {
      console.log(`Game forced to start, but status is ${status}`);
    }
  } catch (error) {
    console.error("Error during force start game:", error);
    throw error;
  }
}

/**
 * Закрыть игру (комнату) и удалить из кэша
 * @param roomId - ID of the room to close
 */
export async function closeGame(roomId: string): Promise<void> {
  const params = new URLSearchParams({ roomId });
  try {
    // Make the API call to close the game
    await apiFetch<null>(`/games/close?${params.toString()}`, {
      method: "POST",
    });
    
    console.log("Game close request sent successfully");
  } catch (error) {
    console.error("Failed to close game:", error);
    throw error;
  }
}


// --- Room API ---

/**
 * Получить полную информацию по комнате
 * @param roomId - ID of the room
 */
export async function getRoomInfo(roomId: string): Promise<RoomInfo> {
  return apiFetch<RoomInfo>(`/room/${roomId}/info`);
}

/**
 * Получить текущий статус комнаты
 * @param roomId - ID of the room
 */
export async function getRoomStatus(roomId: string): Promise<RoomStatus> {
  // The swagger indicates the response is a plain string enum, not JSON
  try {
    const response = await fetch(`${BASE_URL}/room/${roomId}/status`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    let statusText = await response.text();
    
    // Handle possible quotation marks around the status text
    statusText = statusText.replace(/^"(.*)"$/, '$1');
    
    // Validate if the text is a valid RoomStatus enum key
    if (Object.values(RoomStatus).includes(statusText as RoomStatus)) {
      return statusText as RoomStatus;
    } else {
      console.error(`Invalid room status received: ${statusText}`);
      throw new Error(`Invalid room status received: ${statusText}`);
    }
  } catch (error) {
    console.error("Fetch error:", error);
    throw error;
  }
}

// closeGame function is already defined above

/**
 * Получить текущую тему (prompt)
 * @param roomId - ID of the room
 */
export async function getTheme(roomId: string): Promise<Theme> {
  return apiFetch<Theme>(`/room/${roomId}/theme`);
}

/**
 * Получить статистику по раундам (выжил/не выжил)
 * @param roomId - ID of the room
 */
export async function getStats(roomId: string): Promise<Record<string, PlayerStats>> {
  return apiFetch<Record<string, PlayerStats>>(`/room/${roomId}/stats`);
}

/**
 * Получить «сырые» ответы пользователей (только их ответы)
 * @param roomId - ID of the room
 */
export async function getRawAnswers(roomId: string): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>(`/room/${roomId}/raw-answers`);
}

/**
 * Получить полные результаты раунда (ответ игрока + результат GPT + подсказка GPT)
 * @param roomId - ID of the room
 */
export async function getRoundResults(roomId: string): Promise<Record<string, PlayerRoundResult>> {
  return apiFetch<Record<string, PlayerRoundResult>>(`/room/${roomId}/answers`);
}

/**
 * Получить сводку по всем комнатам: список игроков и админ
 */
export async function getRoomsSummary(): Promise<Record<string, RoomSummary>> {
  return apiFetch<Record<string, RoomSummary>>(`/games/summary`);
}

// --- WebSocket ---
// WebSocket URLs for different connections
const WS_BASE_URL = "ws://103.137.250.117:6952";
export const WEBSOCKET_URL = `${WS_BASE_URL}/ws/game`; // For backward compatibility
export const WEBSOCKET_GAME_URL = `${WS_BASE_URL}/ws/game`; // Game WebSocket endpoint
export const WEBSOCKET_ROOMS_URL = `${WS_BASE_URL}/ws/rooms`; // Rooms monitoring endpoint