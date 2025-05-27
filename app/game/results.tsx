import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, ActivityIndicator, Alert } from 'react-native';
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
  createGame,
} from '~/lib/api/client';


// Helper type combining data for display
interface DisplayResult extends PlayerRoundResult {
  nickname: string;
  stats: PlayerStats | null;
  isSelf: boolean;
}

export default function ResultsScreen() {

  // --- Hooks and State ---
  const params = useLocalSearchParams<{ gameId: string; userId?: string; isAdmin?: string; scenario?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null;
  const isAdmin = params.isAdmin === 'true';
  const scenario = params.scenario ?? ''; // Get scenario from navigation params

  // Use gameStatus from hook to drive state
  const {
    gameStatus,
    error: wsError,
    sendMessage,
    readyState,
    lastSystemMessage,
    hasAdminMessage
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

  // Функция резервного HTTP запроса в случае ошибки разбора данных от GPT
  const fetchResultsViaDirectApi = useCallback(async () => {
    if (!gameId) return;
    console.log(`[ResultsScreen] 🚨 Using direct API requests for gameId: ${gameId}`);
    try {
      // According to the OpenAPI spec, we should use the standard endpoints
      // Instead of a fallback endpoint, we'll use the official endpoints directly
      const [results, stats, info] = await Promise.all([
        getRoundResults(gameId),   // /room/{roomId}/answers endpoint
        getStats(gameId),          // /room/{roomId}/stats endpoint
        getRoomInfo(gameId)        // /room/{roomId}/info endpoint (for full data)
      ]);
      
      console.log('[ResultsScreen] 🔄 Direct API requests successful');
      console.log('[ResultsScreen] 📃 Results count:', Object.keys(results || {}).length);
      console.log('[ResultsScreen] 📈 Stats count:', Object.keys(stats || {}).length);
      console.log('[ResultsScreen] 👥 Players count:', info.players?.length || 0);
      
      // Combine data in the format that the component expects
      return {
        results,
        stats,
        players: info.players
      };
    } catch (apiErr) {
      console.error('Direct API requests failed:', apiErr);
      throw apiErr;
    }
  }, [gameId]);

  const fetchResultsData = useCallback(async () => {
    if (!gameId) return;
    setIsLoadingData(true);
    setFetchError(null);
    console.log(`[ResultsScreen] 🔍 Fetching result data for gameId: ${gameId}`);
    try {
      // Fetch results and stats concurrently when ready
      const [results, stats] = await Promise.all([
        getRoundResults(gameId),
        getStats(gameId),
      ]);
      
      console.log('[ResultsScreen] 📈 Received results data:', {
        resultsCount: Object.keys(results || {}).length,
        statsCount: Object.keys(stats || {}).length
      });
      
      // Проверка на ошибки разбора данных от GPT
      if (!results || Object.keys(results).length === 0 || !isValidResultData(results)) {
        console.log('[ResultsScreen] ⚠️ Invalid or empty results data from GPT, using fallback');
        try {
          // Пробуем получить данные напрямую через API
          const directData = await fetchResultsViaDirectApi();
          
          // Устанавливаем данные из прямых API запросов
          if (directData) {
            setRoundResults(directData.results || {});
            setPlayerStats(directData.stats || {});
            if (directData.players && directData.players.length > 0) {
              setPlayers(directData.players);
            }
            console.log('[ResultsScreen] ✅ Successfully used direct API data');
          } else {
            console.warn('[ResultsScreen] ⚠️ Direct API returned no data');
            // Use original data as fallback
            setRoundResults(results);
            setPlayerStats(stats);
          }
        } catch (directApiErr) {
          // Если и прямые API запросы не сработали, используем оригинальные данные (даже если они неполные)
          console.warn('[ResultsScreen] ⚠️ Direct API requests failed, using original incomplete data');
          
          // Автоматически заполняем пустые поля для тех результатов, которые имеют userAnswer, но не имеют других полей
          const enhancedResults = { ...results };
          let enhancedCount = 0;
          
          for (const key in enhancedResults) {
            const result = enhancedResults[key];
            if (result.userAnswer && (!result.gptAnswer || !result.result)) {
              // Если есть ответ пользователя, но нет других полей, добавляем временные значения
              enhancedResults[key] = {
                ...result,
                gptAnswer: result.gptAnswer || 'Обработка ответа...',
                result: result.result || 'Ожидание результата'
              };
              enhancedCount++;
            }
          }
          
          if (enhancedCount > 0) {
            console.log(`[ResultsScreen] 🔧 Enhanced ${enhancedCount} incomplete results with placeholder data`);
          }
          
          setRoundResults(enhancedResults);
          setPlayerStats(stats);
        }
      } else {
        // Если данные корректные, используем их как обычно
        setRoundResults(results);
        setPlayerStats(stats);
      }
    } catch (err) {
      console.error('Failed to fetch results/stats data:', err);
      
      // При любой ошибке в основном запросе пробуем прямые API запросы
      try {
        console.log('[ResultsScreen] 🔄 Attempting direct API requests due to error');
        const directData = await fetchResultsViaDirectApi();
        
        if (directData) {
          setRoundResults(directData.results || {});
          setPlayerStats(directData.stats || {});
          if (directData.players && directData.players.length > 0) {
            setPlayers(directData.players);
          }
          console.log('[ResultsScreen] ✅ Direct API requests successful');
        }
      } catch (directApiErr) {
        // Если оба метода не сработали, показываем ошибку пользователю
        console.error('Both primary and direct API requests failed:', directApiErr);
        setFetchError('Не удалось загрузить результаты. Пожалуйста, попробуйте позже.');
      }
    } finally {
      setIsLoadingData(false);
    }
  }, [gameId, fetchResultsViaDirectApi]);

  // Keep track of which invalid results we've already tried to fetch directly
  const [attemptedDirectFetchFor, setAttemptedDirectFetchFor] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Если данные уже загружены, но они невалидны, попробуем прямые API запросы
    if (roundResults && players?.length > 0 && !isValidResultData(roundResults)) {
      console.log('[ResultsScreen] ⚠️ Detected invalid loaded results data, using direct API requests');
      
      // Create a unique key to identify this set of invalid results
      const resultsKey = Object.keys(roundResults).sort().join('-');
      
      // Only make the API request if we haven't already tried for these specific results
      if (!isLoadingData && !fetchError && !attemptedDirectFetchFor[resultsKey]) {
        // Mark that we've attempted to fetch this set of results
        setAttemptedDirectFetchFor(prev => ({ ...prev, [resultsKey]: true }));
        
        // Запускаем прямые API запросы
        setIsLoadingData(true);
        fetchResultsViaDirectApi()
          .then(data => {
            if (data) {
              // Check if the new data is different from what we already have
              const newResultsKey = Object.keys(data.results || {}).sort().join('-');
              const isDifferentData = newResultsKey !== resultsKey;
              
              // Only update state if the data is different or valid
              if (isDifferentData || isValidResultData(data.results)) {
                setRoundResults(data.results || {});
                setPlayerStats(data.stats || {});
                if (data.players && data.players.length > 0) {
                  setPlayers(data.players);
                }
                console.log('[ResultsScreen] ✅ Successfully used direct API data');
              } else {
                console.log('[ResultsScreen] ⚠️ Direct API returned the same invalid data, avoiding loop');
                // Set a special flag to indicate we've tried and should stop retrying
                setFetchError('Unable to get valid results data');
              }
            }
          })
          .catch(err => {
            console.error('Direct API requests failed:', err);
            setFetchError('Direct API requests failed');
          })
          .finally(() => {
            setIsLoadingData(false);
          });
      }
    }
  }, [roundResults, players, fetchResultsViaDirectApi, isLoadingData, fetchError, attemptedDirectFetchFor]);

  // Fetch player data on mount
  useEffect(() => {
      fetchPlayerData();
  }, [fetchPlayerData]);

  // Track if we've detected a GPT error in the results
  const [hasGptError, setHasGptError] = useState(false);
  
  // Check for GPT errors in results data
  useEffect(() => {
    if (roundResults) {
      const hasError = Object.values(roundResults).some(r => r.gptAnswer === "Ошибка разбора ответа от GPT");
      setHasGptError(hasError);
      
      if (hasError) {
        console.log('[ResultsScreen] 🚨 Detected GPT parsing error in results');
      }
    }
  }, [roundResults]);

  // Fetch results/stats based on gameStatus
  useEffect(() => {
      console.log('[ResultsScreen] 🔄 Checking if results fetch needed - gameStatus:', gameStatus);
      console.log('[ResultsScreen] 📊 Current data state - roundResults:', !!roundResults, 'playerStats:', !!playerStats);
      console.log('[ResultsScreen] 🧩 Scenario param present:', !!scenario && scenario.trim() !== '');
      
      // Check if we should fetch results data
      const shouldFetchResults = (
          // Normal conditions from WebSocket status
          gameStatus === 'RESULTS_READY' ||
          gameStatus === 'STATS_READY' ||
          gameStatus === 'GAME_DONE' ||
          // Special case: We have scenario from params (coming from answer screen with GAME_DONE)
          // but WebSocket status might have reset to UNKNOWN during navigation
          (gameStatus === 'UNKNOWN' && !!scenario && scenario.trim() !== '')
      );
      
      if (shouldFetchResults) {
          // Fetch data only if we don't have it yet or need refresh
          // Skip fetching if we already know there's a GPT error (avoid loops)
          if ((!roundResults || !playerStats) && !hasGptError) {
             console.log('[ResultsScreen] 🔍 Fetching results and stats data...');
             fetchResultsData();
          } else if (hasGptError) {
             console.log('[ResultsScreen] ⚠️ Skipping fetch due to known GPT error');
          } else {
             console.log('[ResultsScreen] ✅ Already have results data, skipping fetch');
          }
      } else if (gameStatus && gameStatus !== 'UNKNOWN') {
          // Only reset results if we have a valid non-UNKNOWN status
          // that doesn't match our result states
          console.log('[ResultsScreen] 🔄 Resetting results due to status change to:', gameStatus);
          setRoundResults(null);
          setPlayerStats(null);
          setHasGptError(false); // Reset GPT error flag on status change
      }
  }, [gameStatus, fetchResultsData, roundResults, playerStats, hasGptError]);

  // --- Game Status Change Handling (Navigation) ---
  useEffect(() => {
    // Логирование изменений статуса игры с дополнительной информацией
    console.log('[ResultsScreen] Game status changed:', gameStatus, 'isAdmin:', isAdmin, 'userId:', userId);
    console.log('[ResultsScreen] Current scenario/theme from params:', scenario);
    console.log('[ResultsScreen] Last system message:', lastSystemMessage, 'hasAdminMessage:', hasAdminMessage);
    
    // Only navigate if we have a valid game status
    if (gameStatus) {
      console.log(`[ResultsScreen] Determining navigation for status: ${gameStatus}`);
      
      // Navigate based on game status
      if (gameStatus === 'MAIN_PLAYER_THINKING' || gameStatus === 'THEME_INPUT') {
        // Определяем роль на основе сообщений WebSocket
        let isCurrentlyAdmin = false;
        
        // Check for exact admin message first
        if (lastSystemMessage && lastSystemMessage.includes('Введите ситуацию')) {
          isCurrentlyAdmin = true;
          console.log('[ResultsScreen] 🔑 Определена роль АДМИНА из сообщения: "Введите ситуацию"');
        } 
        // Use hasAdminMessage flag as backup admin detection
        else if (hasAdminMessage) {
          isCurrentlyAdmin = true;
          console.log('[ResultsScreen] 🔑 Определена роль АДМИНА из флага hasAdminMessage=true');
        } 
        // Message for regular player
        else if (lastSystemMessage && lastSystemMessage.includes('Главный игрок вводит тему')) {
          isCurrentlyAdmin = false;
          console.log('[ResultsScreen] 🔑 Определена роль НЕ-АДМИНА из сообщения: "Главный игрок вводит тему"');
        }
        // Use URL param as a backup if no messages yet
        else if (isAdmin) {
          isCurrentlyAdmin = true;
          console.log('[ResultsScreen] 🔑 Определена роль АДМИНА из URL параметра (резервный вариант)');
        }
        
        console.log('[ResultsScreen] Role determination result:', { isCurrentlyAdmin });
        
        // Add random param for cache busting
        const randomParam = Date.now().toString();
        
        // Направляем пользователя в зависимости от роли
        if (isCurrentlyAdmin) {
          console.log('[ResultsScreen] Redirecting user as ADMIN to thinking screen');
          router.replace({
            pathname: '/game/thinking',
            params: { 
              gameId, 
              userId,
              isAdmin: 'true',
              _: randomParam // Cache-busting parameter
            }
          });
        } else {
          console.log('[ResultsScreen] Redirecting user as NON-ADMIN to scenario screen');
          router.replace({
            pathname: '/game/scenario',
            params: { 
              gameId, 
              userId,
              isAdmin: 'false',
              _: randomParam // Cache-busting parameter
            }
          });
        }
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
  }, [gameStatus, isAdmin, userId, gameId, lastSystemMessage, hasAdminMessage]);

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
      readyState,
      lastSystemMessage,
      hasAdminMessage
    });
    
    // Не выполняем немедленный переход, а ждем сообщения от WebSocket
    // Дальнейший роутинг оставляем на useEffect, который слушает gameStatus и lastSystemMessage
    console.log('[ResultsScreen] Ожидаем сообщение от WebSocket для определения роли...');
    // ВАЖНО: После продолжения роли будут переназначены на основе сообщений WebSocket
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

  // --- Helper Functions ---

  // Функция для проверки валидности данных результатов от GPT
  const isValidResultData = (results: Record<string, PlayerRoundResult>): boolean => {
    // Проверяем, что есть хотя бы один результат
    if (!results || Object.keys(results).length === 0) return false;
    
    // Проверяем на наличие ошибки от GPT
    const hasGptError = Object.values(results).some(r => 
      r.gptAnswer === "Ошибка разбора ответа от GPT" || 
      r.result === "Неизвестно"
    );
    
    // Если есть ошибка от GPT, считаем результаты невалидными
    // Но мы все равно покажем ответы пользователей и специальное сообщение
    if (hasGptError) {
      console.log('[ResultsScreen] 🚨 GPT parsing error detected in results');
      return false;
    }
    
    // Проверяем, что хотя бы 50% результатов содержат необходимые поля
    let validCount = 0;
    const totalCount = Object.keys(results).length;
    
    for (const key in results) {
      const result = results[key];
      
      // Учитываем все возможные форматы результатов
      if (result.result && result.userAnswer && result.gptAnswer && 
          typeof result.result === 'string' && 
          (result.result.toLowerCase() === 'выжил' || 
           result.result.toLowerCase() === 'погиб' || 
           result.result.toLowerCase() === 'не выжил')) {
        validCount++;
        console.log(`[ResultsScreen] ✅ Valid result for player ${key}: ${result.result}`);
      } else {
        console.log(`[ResultsScreen] ⚠️ Invalid result data for player ${key}:`, result);
      }
    }
    
    // Если хотя бы 50% результатов валидны, считаем данные достаточными для отображения
    const validPercentage = (validCount / totalCount) * 100;
    console.log(`[ResultsScreen] 📊 Valid results: ${validCount}/${totalCount} (${validPercentage.toFixed(1)}%)`);
    
    return validPercentage >= 50;
  };

  // --- UI Rendering ---

  const getPlayerNickname = useCallback((pId: string): string => {
    return players?.find(p => p.id === pId)?.name ?? `User ${pId.substring(0, 4)}`;
  }, [players]);  // Combine data for easier rendering
  const displayResults: DisplayResult[] = React.useMemo(() => {
    console.log('[ResultsScreen] 🔄 Recalculating displayResults');
    console.log('[ResultsScreen] 📊 Data available: roundResults=', !!roundResults, 'players=', !!players, 'playerStats=', !!playerStats);
    
    if (!roundResults || !players) {
      console.log('[ResultsScreen] ⚠️ Missing data for display: roundResults or players');
      return [];
    }
    
    // Log the raw data for debugging
    console.log('[ResultsScreen] 🔍 Raw roundResults data:', roundResults);
    console.log('[ResultsScreen] 👥 Available players:', players.map(p => `${p.name} (${p.id})`).join(', '));
    
    // Create our array with user first, then others
    const resultsArray = Object.entries(roundResults).map(([pId, result]) => {
      const nickname = getPlayerNickname(pId);
      const isSelf = pId === userId;
      console.log(`[ResultsScreen] 📝 Processing result for ${nickname} (${pId}) ${isSelf ? '(self)' : ''}`);
      
      return {
        ...result,
        nickname,
        stats: playerStats?.[pId] ?? null,
        isSelf
      };
    });

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

  // Function to restart the game with current user as new admin
  const handleRestartGame = async () => {
    try {
      // Close current game if admin
      if (isAdmin) {
        try {
          await closeGame(gameId);
          console.log('[ResultsScreen] Current game closed successfully');
        } catch (err) {
          console.error('Failed to close current game:', err);
          // Continue with creating new game anyway
        }
      }
      
      // Get current player name from players list
      const currentPlayer = players?.find(p => p.id === userId);
      const playerName = currentPlayer?.name || 'Player';
      
      // Create a new game with current user as admin
      console.log(`[ResultsScreen] Creating new game with user ${playerName} as admin`);
      const newGame = await createGame(playerName, 8); // Use player's name and default capacity of 8
      
      console.log('[ResultsScreen] New game created:', newGame.roomId);
      
      // Navigate to the lobby of the new game as admin
      router.replace({
        pathname: '/lobby/[gameId]',
        params: {
          gameId: newGame.roomId,
          isAdmin: 'true', // This user becomes the admin
          playerName,
        }
      });
    } catch (err) {
      console.error('Failed to restart game:', err);
      Alert.alert('Ошибка', 'Не удалось создать новую игру. Попробуйте позже.');
    }
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
                {/* Show scenario/theme if available from params */}
                {scenario && scenario.trim() !== '' && (
                  <View className="mb-4 p-3 bg-muted/20 rounded-md">
                    <Text className="text-sm font-medium mb-1 text-center">Тема:</Text>
                    <Text className="text-base text-center">{scenario}</Text>
                  </View>
                )}
                
                {/* If no scenario from params, try to extract from results */}
                {!scenario && displayResults.length > 0 && displayResults[0].userAnswer && displayResults[0].userAnswer.includes('→') && (
                  <View className="mb-4 p-3 bg-muted/20 rounded-md">
                    <Text className="text-sm font-medium mb-1 text-center">Тема:</Text>
                    <Text className="text-base text-center">
                      {displayResults[0].userAnswer.split('→')[0].trim()}
                    </Text>
                  </View>
                )}
                
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
        
        {/* GPT Error Message */}
        {!isLoadingData && roundResults && Object.values(roundResults).some(r => r.gptAnswer === "Ошибка разбора ответа от GPT") && (
          <Card className='mb-6 border-warning'>
            <CardHeader className='pb-2 bg-warning/10'>
              <CardTitle className='text-lg text-center text-warning'>Ошибка обработки ответа</CardTitle>
            </CardHeader>
            <CardContent className='pt-4'>
              <Text className='text-center mb-4'>Возникла проблема при обработке ответа. Вы можете вернуться в лобби или продолжить игру.</Text>
              
              <View className='flex-row justify-between mt-4'>
                <Button
                  onPress={handleBackToMenu}
                  variant='outline'
                  className='flex-1 mr-2'
                >
                  <Text>Вернуться в лобби</Text>
                </Button>
                
                {isAdmin && (
                  <Button
                    onPress={handleContinue}
                    disabled={isContinuing || readyState !== WebSocket.OPEN}
                    className='flex-1 ml-2'
                  >
                    {isContinuing ? (
                      <ActivityIndicator size='small' color='#ffffff' />
                    ) : (
                      <Text>Начать новый раунд</Text>
                    )}
                  </Button>
                )}
              </View>
            </CardContent>
          </Card>
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

        {/* Game Over Buttons */}
        {isGameOver && !isLoadingData && (
            <View className='mt-8 mb-4 gap-4'>
              {/* Restart Game Button */}
              <Button
                onPress={handleRestartGame}
                size='lg'
                className='mb-3'
              >
                <Text>Начать новую игру (стать ведущим)</Text>
              </Button>
              
              {/* Back to Menu Button */}
              <Button
                onPress={handleBackToMenu}
                size='lg'
                variant='outline'
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