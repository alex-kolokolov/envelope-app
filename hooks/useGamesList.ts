import { useState, useEffect, useCallback } from 'react';
import { getAllOpenedGames, RoomCache, RoomStatus } from '../lib/api/client'; // Import API function and type

// Define the structure for the hook's return value
export interface UseGamesListResult {
  games: RoomCache[];
  isLoading: boolean;
  error: Error | null;
  refreshGames: () => Promise<void>;
}

/**
 * Custom hook to fetch and manage the list of available games from the backend API.
 *
 * @returns An object containing the current list of games, loading state, error state, and a refresh function.
 */
export function useGamesList(): UseGamesListResult {
  const [games, setGames] = useState<RoomCache[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchGames = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedGames = await getAllOpenedGames();
      // Ensure players array exists, even if empty, for consistency
      const gamesWithPlayers = (fetchedGames || []).map(game => ({
        ...game,
        players: game.players || [],
      }));
      setGames(gamesWithPlayers.filter(game => game.status === RoomStatus.WAITING_FOR_PLAYERS));
    } catch (err) {
      console.error("Failed to fetch games:", err);
      setError(err instanceof Error ? err : new Error('Failed to fetch games'));
      setGames([]); // Clear games on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch games on initial mount
  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  // Provide a function to manually refresh the list
  const refreshGames = useCallback(async () => {
    await fetchGames();
  }, [fetchGames]);

  return { games, isLoading, error, refreshGames };
}