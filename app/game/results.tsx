import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { useWebSocketGame, GameStatus } from '~/hooks/useWebSocketGame'; // Import hook and GameStatus
import {
  getRoomInfo,
  getRoundResults,
  getStats,
  RoomInfo,
  PlayerRoundResult,
  PlayerStats,
  Player,
  closeGame, // Import closeGame API
} from '~/lib/api/client';

// Helper type combining data for display
interface DisplayResult extends PlayerRoundResult {
  nickname: string;
  stats: PlayerStats | null;
  isSelf: boolean;
}

export default function ResultsScreen() {
  // --- Hooks and State ---
  const params = useLocalSearchParams<{ gameId: string; userId?: string; isAdmin?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null;
  const isAdmin = params.isAdmin === 'true';

  // Use gameStatus from hook to drive state
  const { gameStatus, error: wsError } = useWebSocketGame(gameId, userId);

  const [players, setPlayers] = useState<Player[]>([]); // Store player list for nicknames
  const [roundResults, setRoundResults] = useState<Record<string, PlayerRoundResult> | null>(null);
  const [playerStats, setPlayerStats] = useState<Record<string, PlayerStats> | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false); // Loading state for API calls
  const [fetchError, setFetchError] = useState<string | null>(null);

  // --- Data Fetching ---
  const fetchPlayerData = useCallback(async () => {
      if (!gameId) return;
      // Fetch player info once initially for nicknames
      try {
          const info = await getRoomInfo(gameId);
          setPlayers(info.players ?? []);
      } catch (err) {
          console.error('Failed to fetch player info:', err);
          setFetchError('Failed to load player names.');
      }
  }, [gameId]);

  const fetchResultsData = useCallback(async () => {
    if (!gameId) return;
    setIsLoadingData(true);
    setFetchError(null);
    try {
      // Fetch results and stats concurrently when ready
      const [results, stats] = await Promise.all([
        getRoundResults(gameId),
        getStats(gameId),
      ]);
      setRoundResults(results);
      setPlayerStats(stats);
    } catch (err) {
      console.error('Failed to fetch results/stats data:', err);
      setFetchError(err instanceof Error ? err.message : 'Failed to load results.');
    } finally {
      setIsLoadingData(false);
    }
  }, [gameId]);

  // Fetch player data on mount
  useEffect(() => {
      fetchPlayerData();
  }, [fetchPlayerData]);

  // Fetch results/stats based on gameStatus
  useEffect(() => {
      if (
          gameStatus === 'RESULTS_READY' ||
          gameStatus === 'STATS_READY' ||
          gameStatus === 'GAME_DONE'
      ) {
          // Fetch data only if we don't have it yet or need refresh
          if (!roundResults || !playerStats) {
             fetchResultsData();
          }
      } else {
          // Reset results if status changes away from results states
          setRoundResults(null);
          setPlayerStats(null);
      }
  }, [gameStatus, fetchResultsData, roundResults, playerStats]);


  // --- Game Status Change Handling (Navigation) ---
  useEffect(() => {
    // Navigate if status indicates a new round or game closed/regressed
    if (
        gameStatus === 'MAIN_PLAYER_THINKING' ||
        gameStatus === 'THEME_INPUT' ||
        gameStatus === 'SCENARIO_PRESENTED' ||
        gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT'
    ) {
        // Determine correct screen based on where the game regressed/progressed to
        let pathname = '/game/scenario';
        if (gameStatus === 'THEME_INPUT') pathname = '/game/thinking';
        else if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') pathname = '/game/answer';

        router.replace({
            pathname: pathname as any, // Cast needed here too
            params: { gameId, userId, isAdmin: isAdmin.toString() },
        });
    } else if (gameStatus === 'CLOSED') {
        router.replace('/');
    } else if (gameStatus === 'WAITING_FOR_PLAYERS') {
        // If status goes all the way back to lobby
        router.replace({ pathname: '/lobby/[gameId]', params: { gameId, userId, isAdmin: isAdmin.toString() } });
    }
    // Stay on this screen for WAITING_FOR_GPT, WAITING_FOR_ALL_ANSWERS_FROM_GPT, RESULTS_READY, STATS_READY, GAME_DONE

  }, [gameStatus, gameId, userId, isAdmin]); // Dependencies

  // --- UI Rendering ---

  const getPlayerNickname = useCallback((pId: string): string => {
    return players?.find(p => p.id === pId)?.name ?? `User ${pId.substring(0, 4)}`;
  }, [players]);

  // Combine data for easier rendering
  const displayResults: DisplayResult[] = React.useMemo(() => {
    if (!roundResults || !players) return [];
    
    // Create our array with user first, then others
    const resultsArray = Object.entries(roundResults).map(([pId, result]) => ({
      ...result,
      nickname: getPlayerNickname(pId),
      stats: playerStats?.[pId] ?? null,
      isSelf: pId === userId,
    }));
    
    // Sort: first the current user, then others
    return resultsArray.sort((a, b) => {
      if (a.isSelf) return -1; // Current user always first
      if (b.isSelf) return 1;
      return 0; // Keep original order for other players
    });
  }, [roundResults, playerStats, players, userId, getPlayerNickname]);


  const handleBackToMenu = async () => {
    if (isAdmin && gameId) {
      try {
        await closeGame(gameId);
      } catch (error) {
        console.error('Failed to close game:', error);
        // Optionally show an error to the user, but always navigate
      }
    }
    router.replace('/'); // Go back to main menu
  };

  // Determine screen state based on gameStatus
  const isWaitingForProcessing = gameStatus === 'WAITING_FOR_GPT' || gameStatus === 'WAITING_FOR_ALL_ANSWERS_FROM_GPT';
  const showResults = gameStatus === 'RESULTS_READY' || gameStatus === 'STATS_READY' || gameStatus === 'GAME_DONE';
  const isGameOver = gameStatus === 'STATS_READY' || gameStatus === 'GAME_DONE' || gameStatus === 'CLOSED';

  let title = 'Результаты';
  if (isWaitingForProcessing) title = 'Обработка...';
  else if (isGameOver) title = 'Итоговые результаты';
  else if (showResults) title = 'Результаты раунда';

  return (
    <ScrollView className='flex-1 bg-background p-4'>
      <Stack.Screen options={{ title: title }} />

       <Text className='text-2xl font-bold text-center mb-2 text-primary'>
           {title}
       </Text>

       {/* Waiting State */}
       {isWaitingForProcessing && (
           <View className='flex-1 justify-center items-center my-10'>
               <ActivityIndicator size='large' />
               <Text className='mt-4 text-lg text-foreground'>ИИ обрабатывает ответы...</Text>
           </View>
       )}

       {/* Loading API Data State */}
       {isLoadingData && showResults && (
           <View className='flex-1 justify-center items-center my-10'>
               <ActivityIndicator size='large' />
               <Text className='mt-4 text-lg text-foreground'>Загрузка данных результатов...</Text>
           </View>
       )}

       {/* Error State */}
       {fetchError && (
         <View className='flex-1 justify-center items-center my-10'>
           <Text className='text-destructive text-center mb-4'>{fetchError}</Text>
           <Button onPress={fetchResultsData} variant='outline'><Text>Повторить</Text></Button>
         </View>
       )}

      {/* Solution & Players Results */}
      {!isLoadingData && !fetchError && showResults && displayResults.length > 0 && (
        <View>
          {/* Solution Card */}
          <Card className="mb-6 border-primary-foreground border-2">
            <CardHeader className="pb-2 bg-primary-foreground/10">
              <CardTitle className="text-xl text-center">Решение раунда</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <View className="mb-2">
                <Text className="text-base font-semibold mb-3 text-center">Сводка результатов</Text>
                {displayResults.map((result, idx) => (
                  <View key={`summary-${idx}`} className="flex-row justify-between mb-2">
                    <Text className="text-sm">{result.nickname} {result.isSelf ? '(Вы)' : ''}</Text>
                    <Text className={`text-sm font-medium ${result.result?.toLowerCase() === 'выжил' ? 'text-green-600' : 'text-red-600'}`}>
                      {result.result ?? 'N/A'}
                    </Text>
                  </View>
                ))}
              </View>
            </CardContent>
          </Card>
          
          {/* Your Result First */}
          {displayResults.map((result, index) => (
            <Card key={`player-${index}`} className={`mb-6 ${result.isSelf ? 'border-primary border-2' : ''}`}>
              <CardHeader className="pb-2">
                <View className="flex-row justify-between items-center">
                  <CardTitle className={`text-lg ${result.isSelf ? 'text-primary' : 'text-card-foreground'}`}>
                    {result.nickname} {result.isSelf ? '(Вы)' : ''}
                  </CardTitle>
                  <Text className={`text-sm font-semibold ${result.result?.toLowerCase() === 'выжил' ? 'text-green-600' : 'text-red-600'}`}>
                    {result.result ?? 'N/A'}
                  </Text>
                </View>
              </CardHeader>
              <CardContent>
                <View className="py-2">
                  <Text className="text-sm font-semibold mb-2">Ответ игрока:</Text>
                  <Text className="text-sm text-muted-foreground mb-4 italic">
                    <Text>"</Text>
                    {result.userAnswer ?? 'N/A'}
                    <Text>"</Text>
                  </Text>
                  
                  <Text className="text-sm font-semibold mb-2">Решение ИИ:</Text>
                  <Text className="text-sm text-muted-foreground">{result.gptAnswer ?? 'No explanation available'}</Text>
                  
                  {/* Show stats if game is over */}
                  {isGameOver && result.stats && (
                    <View className="mt-4 pt-4 border-t border-border">
                      <Text className="text-xs text-muted-foreground">
                        Итоговая статистика: Выжил {result.stats.survivedCount} | Погиб {result.stats.diedCount}
                      </Text>
                    </View>
                  )}
                </View>
              </CardContent>
            </Card>
          ))}
        </View>
      )}

      {/* No Results Message */}
      {!isLoadingData && !fetchError && showResults && displayResults.length === 0 && (
        <Text className='text-center text-muted-foreground my-10'>Результаты пока недоступны.</Text>
      )}

      {/* Back to Menu Button */}
      {isGameOver && !isLoadingData && (
          <View className='mt-8 mb-4'>
            <Button
               onPress={handleBackToMenu}
               size='lg'
             >
              <Text>Вернуться в меню</Text>
            </Button>
          </View>
      )}

      {/* Waiting indicator if not game over but showing results (waiting for next round signal) */}
      {showResults && !isGameOver && !isLoadingData && (
          <View className='items-center mt-4 mb-4'>
              <ActivityIndicator size="small"/>
              <Text className='text-muted-foreground mt-1'>Ожидание следующего раунда...</Text>
          </View>
      )}

    </ScrollView>
  );
}