import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { useWebSocketGame } from '~/hooks/useWebSocketGame'; 
import {
  getRoomInfo,
  getRoundResults,
  getStats,
  RoomInfo,
  PlayerRoundResult,
  PlayerStats,
  Player,
  closeGame, 
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
  const {
    gameStatus,
    error: wsError,
    sendMessage,
    readyState,
  } = useWebSocketGame(gameId, userId);

  const [players, setPlayers] = useState<Player[]>([]); 
  const [roundResults, setRoundResults] = useState<Record<string, PlayerRoundResult> | null>(null);
  const [playerStats, setPlayerStats] = useState<Record<string, PlayerStats> | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false); 
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
 

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
    // Логирование изменений статуса игры с дополнительной информацией
    console.log('[ResultsScreen] Game status changed:', gameStatus, 'isAdmin:', isAdmin, 'userId:', userId);
    
    // Only navigate if we have a valid game status
    if (gameStatus) {
      console.log(`[ResultsScreen] Determining navigation for status: ${gameStatus}`);
      
      // Navigate based on game status
      if (gameStatus === 'MAIN_PLAYER_THINKING' || gameStatus === 'THEME_INPUT') {
        // ВАЖНО: При новом раунде отправляем ВСЕХ на thinking screen, 
        // чтобы WebSocket сообщения могли правильно определить, кто админ в этом раунде
        console.log('[ResultsScreen] Navigating all users to thinking screen for role determination');
        router.replace({
          pathname: '/game/thinking',
          params: { gameId, userId, isAdmin: isAdmin.toString() }
        });
      } 
      else if (gameStatus === 'SCENARIO_PRESENTED') {
        // Everyone goes to scenario screen when scenario is presented
        console.log('[ResultsScreen] Scenario presented, navigating to scenario screen');
        router.replace({
          pathname: '/game/scenario',
          params: { gameId, userId, isAdmin: isAdmin.toString() }
        });
      }
      else if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
        // Everyone goes to answer screen when it's time to answer
        console.log('[ResultsScreen] Time to answer, navigating to answer screen');
        router.replace({
          pathname: '/game/answer',
          params: { gameId, userId, isAdmin: isAdmin.toString() }
        });
      }
      else if (gameStatus === 'CLOSED') {
        // Game is closed, go back to main menu
        console.log('[ResultsScreen] Game closed, navigating to main menu');
        router.replace('/');
      }
      // For other statuses (like RESULTS_READY), stay on the results screen
    }
  }, [gameStatus, isAdmin, userId, gameId]);

  // Handle continue button press
  const handleContinue = () => {
    if (!isAdmin) return;                       // защитимся
    if (readyState !== WebSocket.OPEN) return;  // сокет упал
    setIsContinuing(true);
    console.log('[ResultsScreen] Отправляем YES по WebSocket. isAdmin =', isAdmin, 'userId:', userId);
    sendMessage('YES');                         // ← ключевой момент
    
    // Для отладки - выводим текущие параметры
    console.log('[ResultsScreen] Текущие параметры:', {
      gameId, 
      userId, 
      isAdmin, 
      gameStatus,
      readyState
    });
    // Дальнейший роутинг оставляем на useEffect, который уже слушает gameStatus.
  };

  // Additional handling for WAITING_FOR_PLAYERS status (return to lobby)
  useEffect(() => {
    if (gameStatus === 'WAITING_FOR_PLAYERS') {
      // If status goes all the way back to lobby
      console.log('[ResultsScreen] Возврат в лобби');
      router.replace({ 
        pathname: '/lobby/[gameId]', 
        params: { gameId, userId, isAdmin: isAdmin.toString() } 
      });
    }
  }, [gameStatus, gameId, userId, isAdmin]);

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
      if (a.isSelf) return -1; 
      if (b.isSelf) return 1;
      return 0; 
    });
  }, [roundResults, playerStats, players, userId, getPlayerNickname]);

  const handleBackToMenu = () => {
    if (isAdmin) {
      closeGame(gameId).catch((err) => {
        console.error('Failed to close game:', err);
      });
    }
    
    // Navigate back to main menu
    router.replace('/');
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
    <View style={{ flex: 1 }}>
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

        {/* Общая статистика по раундам */}
        {playerStats && Object.keys(playerStats).length > 0 && (
          <Card className='mb-6'>
            <CardHeader className='pb-2 bg-muted/20'>
              <CardTitle className='text-lg text-center'>Общие результаты</CardTitle>
            </CardHeader>
            <CardContent className='pt-4'>
              {Object.entries(playerStats).map(([pId, stats]) => (
                <View key={pId} className='flex-row justify-between mb-2'>
                  <Text className='text-sm'>
                    {getPlayerNickname(pId)} {pId === userId ? '(Вы)' : ''}
                  </Text>
                  <Text className='text-sm text-muted-foreground'>
                    выжил {stats.survivedCount} | погиб {stats.diedCount}
                  </Text>
                </View>
              ))}
            </CardContent>
          </Card>
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

        {/* Кнопки после окончания раунда */}
        {showResults && !isWaitingForProcessing && (
          <View className='mt-6 flex-row justify-between'>
            <Button
              onPress={handleContinue}
              disabled={!isAdmin || isContinuing || readyState !== WebSocket.OPEN}
              className='flex-1 mr-2'
            >
              {isContinuing ? (
                <ActivityIndicator size='small' color='#ffffff' />
              ) : (
                <Text>Продолжить</Text>
              )}
            </Button>

            <Button
              onPress={handleBackToMenu}
              variant='outline'
              className='flex-1 ml-2'
            >
              <Text>В лобби</Text>
            </Button>
          </View>
        )}

        {/* Waiting indicator if not game over but showing results (waiting for next round signal) */}
        {showResults && !isGameOver && !isLoadingData && isContinuing && (
            <View className='items-center mt-4 mb-4'>
                <ActivityIndicator size="small"/>
                <Text className='text-muted-foreground mt-1'>Ожидание следующего раунда...</Text>
            </View>
        )}
      </ScrollView>

    </View>
  );
}