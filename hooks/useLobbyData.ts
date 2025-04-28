import { useCallback } from 'react';
import { useGamesList } from './useGamesList'; // Keep the import if needed elsewhere, or remove if unused
import { useAsyncStorageState } from './useAsyncStorageState';

// Define the structure for a player in the lobby
export interface Player {
  id: string;
  nickname: string;
  isHost?: boolean; // Optional: Mark the host
}

// Define the structure for a chat message
export interface ChatMessage {
  id: string;
  senderId: string; // Corresponds to Player.id
  senderNickname: string;
  text: string;
  timestamp: number;
}

// Define the structure for the lobby data
interface LobbyData {
  players: Player[];
  messages: ChatMessage[];
}

// Initial empty data for a new lobby
const initialLobbyData: LobbyData = {
  players: [],
  messages: [],
};

/**
 * Custom hook to manage lobby data (players, chat) for a specific game,
 * stored in AsyncStorage.
 *
 * @param gameId The ID of the game lobby.
 * @returns A tuple containing the current lobby data and functions to modify it.
 */
export function useLobbyData(
  gameId: string | undefined
): [
  LobbyData,
  (newPlayer: Player) => Promise<void>,
  (playerId: string) => Promise<void>,
  (newMessage: Omit<ChatMessage, 'id' | 'timestamp'>) => Promise<void>
] {
console.log(`[useLobbyData] Initializing for gameId: ${gameId}`);
  const storageKey = `lobbyData_${gameId || 'unknown'}`;
  const [lobbyData, setLobbyData] = useAsyncStorageState<LobbyData>(
    storageKey,
    initialLobbyData
  );

  // NOTE: Removed incorrect usage of useGamesList here.
  // Player count updates need to be handled differently, perhaps by refreshing the game list
  // where it's displayed, or via WebSocket updates.

  // Add a player to the lobby
  const addPlayer = useCallback(
    async (newPlayer: Player) => {
      if (!gameId) return; // Don't operate if gameId is missing
      // Prevent adding duplicates by ID
      if (!lobbyData.players.some((p) => p.id === newPlayer.id)) {
        const updatedData = {
          ...lobbyData,
          players: [...lobbyData.players, newPlayer],
        };
        await setLobbyData(updatedData);
        // Removed call to non-existent updateGamePlayerCount
      }
    },
    [lobbyData, setLobbyData, gameId] // Removed updateGamePlayerCount from dependencies
  );

  // Remove a player from the lobby
  const removePlayer = useCallback(
    async (playerId: string) => {
      if (!gameId) return;
      const updatedPlayers = lobbyData.players.filter((p) => p.id !== playerId);
      const updatedData = { ...lobbyData, players: updatedPlayers };
      await setLobbyData(updatedData);
      // Removed call to non-existent updateGamePlayerCount
    },
    [lobbyData, setLobbyData, gameId]
  );

  // Add a chat message to the lobby
  const addChatMessage = useCallback(
    async (newMessageData: Omit<ChatMessage, 'id' | 'timestamp'>) => {
      if (!gameId) return;
      const newMessage: ChatMessage = {
        ...newMessageData,
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, // Simple unique ID
        timestamp: Date.now(),
      };
      const updatedData = {
        ...lobbyData,
        messages: [...lobbyData.messages, newMessage],
      };
      await setLobbyData(updatedData);
    },
    [lobbyData, setLobbyData, gameId]
  );

  return [lobbyData, addPlayer, removePlayer, addChatMessage];
}