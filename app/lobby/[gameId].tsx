import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, FlatList, ActivityIndicator, Alert } from 'react-native';
import { Stack, useLocalSearchParams, router, useNavigation } from 'expo-router'; 
import Animated, { Layout, FadeIn, FadeOut, Easing } from 'react-native-reanimated';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { useWebSocketGame, GameStatus } from '~/hooks/useWebSocketGame';
import { getRoomInfo, forceStartGame, closeGame, getRoomStatus, RoomInfo, Player, RoomStatus } from '~/lib/api/client'; 

const AnimatedView = Animated.createAnimatedComponent(View);

// Mapping from GameStatus (from hook) to display text
const gameStatusDisplayMap: Record<GameStatus, string> = {
    UNKNOWN: 'Подключение...',
    WAITING_FOR_PLAYERS: 'Ожидание игроков',
    MAIN_PLAYER_THINKING: 'Ожидание ведущего',
    THEME_INPUT: 'Ведущий выбирает тему',
    SCENARIO_PRESENTED: 'Сценарий готов',
    WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT: 'Ожидание ответов',
    WAITING_FOR_GPT: 'ИИ думает...',
    WAITING_FOR_ALL_ANSWERS_FROM_GPT: 'ИИ обрабатывает...',
    RESULTS_READY: 'Результаты готовы',
    STATS_READY: 'Игра окончена',
    GAME_DONE: 'Игра завершена',
    CLOSED: 'Комната закрыта',
};

export default function LobbyScreen() {
  // Хуки и состояния
  const params = useLocalSearchParams<{ gameId: string; userId?: string; isAdmin?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null; // Обработка случая, когда userId отсутствует
  const isAdmin = params.isAdmin === 'true'; // Преобразование строки в булево значение
  const navigation = useNavigation(); // Хук для управления навигацией

  const isNavigatingProgrammatically = useRef(false); // Ref для отслеживания программной навигации
  const initialMountRef = useRef(true); // Ref для отслеживания первого монтирования
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isClosing, setIsClosing] = useState(false); // Для кнопки "Закрыть игру" (только для админа)
  const [isLeaving, setIsLeaving] = useState(false); // Для обработки выхода назад
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // WebSocket — получение переменных состояния и функции закрытия
  const {
    isConnected: isWsConnected,
    
    error: wsError,
    readyState: wsReadyState,
    gameStatus,
    
    
    closeConnection, // Получить функцию ручного закрытия соединения
  } = useWebSocketGame(gameId, userId);

  // Получение данных о комнате
  const fetchRoomData = useCallback(async () => {
    if (!gameId) return;
    // Не сбрасывать загрузку, если данные уже загружены, просто обновить
    setError(null);
    try {
      console.log('Fetching room info...');
      const data = await getRoomInfo(gameId);
      setRoomInfo(data);
    } catch (err) {
      console.error('Failed to fetch room info:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load lobby data.';
      setError(errorMessage);
      if ((err as any)?.response?.status === 404) {
          Alert.alert("Ошибка", "Комната не найдена.", [{ text: "OK", onPress: () => router.back() }]);
      } else {
          // Показывать другие ошибки без возврата назад
          Alert.alert("Ошибка", errorMessage);
      }
    } finally {
      setIsLoading(false); // Всегда сбрасывать загрузку после обновления
    }
  }, [gameId]);

  useEffect(() => {
    setIsLoading(true); // Включать загрузку только при первом монтировании
    fetchRoomData();
    // Можно добавить периодическое обновление данных комнаты
    // const intervalId = setInterval(fetchRoomData, 15000); // Обновлять каждые 15 секунд
    // return () => clearInterval(intervalId);
  }, [fetchRoomData]); // Запускать только при первом монтировании

  // Обработка сообщений WebSocket (например, обновление списка игроков)
  // Может потребоваться корректировка под реальные сообщения бэкенда
  // Для простоты просто обновляем данные при изменении статуса или периодически
  // Если есть сообщения PLAYER_JOINED/LEFT, обрабатывайте их здесь
  // useEffect(() => {
  //   if (wsMessage) {
  //     console.log("Обработка JSON-сообщения WebSocket:", wsMessage);
  //     if (wsMessage.type === 'PLAYER_JOINED' || wsMessage.type === 'PLAYER_LEFT') {
  //        fetchRoomData();
  //     } else if (wsMessage.type === 'GAME_STATE_UPDATE') {
  //        setRoomInfo(wsMessage.payload as RoomInfo);
  //     }
  //   }
  // }, [wsMessage, fetchRoomData]);

  // Обработка смены статуса игры (навигация)
  useEffect(() => {
    console.log("Game Status Changed:", gameStatus, "initialMount:", initialMountRef.current);
    
    // Предотвращаем навигацию при первом монтировании компонента
    if (initialMountRef.current) {
      console.log("[LobbyScreen] Пропускаем первую навигацию для стабилизации экрана");
      initialMountRef.current = false;
      return;
    }
    
    // Переход из лобби при изменении статуса игры
    if (
        gameStatus !== 'UNKNOWN' &&
        gameStatus !== 'WAITING_FOR_PLAYERS' &&
        gameStatus !== 'CLOSED' // Не переходить, если игра уже закрыта
    ) {
        console.log(`Navigating to game screen due to status: ${gameStatus}`);
        let pathname = '/game/scenario'; // Экран сценария по умолчанию для не-админов или поздних этапов

        // Админ сначала попадает на экран размышления, остальные ждут на экране сценария
        if ((gameStatus === 'MAIN_PLAYER_THINKING' || gameStatus === 'THEME_INPUT')) {
            if (isAdmin) {
                pathname = '/game/thinking';
                console.log('Admin detected, navigating to /game/thinking');
            } else {
                // Не-админы ждут на экране сценария, пока админ думает
                pathname = '/game/scenario'; // Or a dedicated waiting screen if you prefer
                console.log('Non-admin detected, navigating to /game/scenario (waiting for admin)');
            }
        }
        else if (gameStatus === 'SCENARIO_PRESENTED') pathname = '/game/scenario';
        else if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') pathname = '/game/answer';
        else if (gameStatus === 'RESULTS_READY') pathname = '/game/results';
        else if (gameStatus === 'STATS_READY' || gameStatus === 'GAME_DONE') pathname = '/game/results';

        isNavigatingProgrammatically.current = true; // Mark as programmatic navigation
        router.replace({
            pathname: pathname as any,
            params: { gameId, userId, isAdmin: isAdmin.toString() }
        });
    } else if (gameStatus === 'CLOSED' && !isLoading && !isLeaving) { // Only alert if not already leaving
        // Handle room closed state (e.g., if closed by admin remotely)
        Alert.alert("Комната закрыта", "Эта игровая комната была закрыта.", [{ text: "OK", onPress: () => router.replace('/') }]);
    }

  }, [gameStatus, gameId, userId, isAdmin, isLoading, isLeaving]); // Depend on gameStatus and other relevant state

  // --- Back Action Handling ---
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', async (e) => {
      // Prevent default behavior if we're handling it
      if (isLeaving) {
        return; // Already processing
      }

      console.log('Back action triggered (beforeRemove)');

      // Check if this is programmatic navigation
      if (isNavigatingProgrammatically.current) {
          console.log('Allowing programmatic navigation.');
          isNavigatingProgrammatically.current = false; // Reset the flag
          return; // Don't prevent default, let the navigation happen
      }

      // --- It's a manual back action, proceed with cleanup ---
      e.preventDefault(); // Stop the navigation action immediately
      setIsLeaving(true); // Set loading state

      try {
        // 1. Close WebSocket connection
        console.log('Closing WebSocket connection...');
        closeConnection(); // Use the function from the hook

        // 2. If admin, call closeGame API
        if (isAdmin && gameId) {
          console.log('Admin leaving, attempting to close game via API...');
          try {
            await closeGame(gameId);
            console.log('Game closed successfully via API.');
          } catch (apiError) {
            console.error('Failed to close game via API:', apiError);
            // Show error, but still navigate back
            Alert.alert('Ошибка', `Failed to close the game room: ${apiError instanceof Error ? apiError.message : 'Unknown error'}`);
          }
        } else {
            console.log('Non-admin leaving or gameId missing.');
        }

        // 3. Perform the navigation back
        console.log('Navigating back...');
        navigation.dispatch(e.data.action); // Perform the original action (go back)

      } catch (err) {
          console.error("Error during back action handling:", err);
          // Ensure navigation still happens even if WS close fails somehow
          if (!navigation.isFocused()) { // Check if already navigated away
             navigation.dispatch(e.data.action);
          }
      } finally {
         // Resetting isLeaving might cause issues if the component unmounts immediately.
         // It's generally safer to let the unmount handle final state.
         // setIsLeaving(false);
         console.log('Back action processing finished.');
      }
    });

    return unsubscribe; // Cleanup listener on unmount
  }, [navigation, isAdmin, gameId, closeConnection, isLeaving]); // Add dependencies

  // --- Actions ---
  const handleStartGame = useCallback(async () => {
    if (!gameId || isStarting) return; // Prevent double clicks
    setIsStarting(true);
    setError(null);
    try {
      console.log(`Attempting to force start game: ${gameId}`);
      await forceStartGame(gameId);
      console.log('Force start game request sent successfully.');
      
      // Manually check the status after force start
      const roomStatus = await getRoomStatus(gameId);
      if (roomStatus === RoomStatus.MAIN_PLAYER_THINKING) {
        console.log('Game status is MAIN_PLAYER_THINKING, navigating to thinking screen');
        // Manual navigation since WebSocket update might be delayed or missed
        isNavigatingProgrammatically.current = true;
        router.replace({
          pathname: isAdmin ? '/game/thinking' : '/game/scenario',
          params: { gameId, userId, isAdmin: isAdmin.toString() }
        });
      } else {
        console.log(`Game forced to start, but status is ${roomStatus}, waiting for WebSocket update`);
      }
    } catch (err) {
      console.error('Failed to start game via API:', err);
      const errorMessage = err instanceof Error ? err.message : 'Could not start the game.';
      setError(errorMessage);
      Alert.alert('Ошибка запуска игры', errorMessage);
    } finally {
      setIsStarting(false);
    }
  }, [gameId, isStarting, isAdmin, userId]);

  // Admin's explicit "Close Game" button action
  const handleCloseGame = useCallback(async () => {
      if (!isAdmin || !gameId) return;
      setIsClosing(true); // Use dedicated state for this button
      setError(null);
      try {
          console.log('Admin explicitly closing game...');
          // 1. Close API first (optional, depends on desired flow)
          await closeGame(gameId);
          console.log('Game closed successfully via API (explicit button).');
          // 2. Close WebSocket (hook's onclose should set status to CLOSED)
          closeConnection();
          // 3. Navigation is handled by gameStatus useEffect watching for 'CLOSED'
      } catch (err) {
          console.error('Failed to close game (explicit button):', err);
          setError(err instanceof Error ? err.message : 'Failed to close the game.');
          Alert.alert('Ошибка', `Failed to close game: ${err instanceof Error ? err.message : 'Unknown error'}`);
          setIsClosing(false); // Reset loading only on error here
      }
      // Don't reset isClosing in finally, let the navigation handle unmount
  }, [isAdmin, gameId, closeConnection]);

  // Pull-to-refresh for player list
  const handleRefreshPlayers = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchRoomData();
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchRoomData]);

  // --- UI Rendering ---
  const renderPlayerItem = useCallback(({ item }: { item: Player }) => {
    const isSelf = item.id === userId;
    return (
      <AnimatedView
        layout={Layout.easing(Easing.inOut(Easing.quad)).duration(300)}
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(300)}
        className='p-3 border-b border-border flex-row justify-between items-center bg-card'
      >
        <Text className={`text-card-foreground ${isSelf ? 'font-bold' : ''}`}>
          {item.name} {item.admin ? '(Ведущий)' : ''} {isSelf ? '(Вы)' : ''}
        </Text>
      </AnimatedView>
    );
  }, [userId]);

  // Display loading or error states
  if (isLoading) {
    return (
      <View className='flex-1 justify-center items-center bg-background'>
        <ActivityIndicator size="large" />
        <Text className='mt-2 text-muted-foreground'>Загрузка лобби...</Text>
      </View>
    );
  }

  // Show specific WebSocket connection status/errors
   let wsStatusText = '';
   switch (wsReadyState) {
       case WebSocket.CONNECTING: wsStatusText = 'Подключение...'; break;
       case WebSocket.OPEN: wsStatusText = 'Подключено'; break;
       case WebSocket.CLOSING: wsStatusText = 'Отключение...'; break;
       case WebSocket.CLOSED: wsStatusText = 'Отключено'; break;
       default: wsStatusText = 'Неизвестно';
   }

  return (
    <View className='flex-1 bg-background'>
      <Stack.Screen options={{ title: `Лобби: ${gameId?.substring(0, 8)}...` }} />

      {/* Header Info */}
      <View className='p-4 border-b border-border bg-card'>
        <View className='mx-auto w-full' style={{ maxWidth: 768 }}>
          <Text className='text-xl font-semibold text-center text-card-foreground'>
            Статус комнаты: {gameStatusDisplayMap[gameStatus] ?? 'Загрузка...'}
          </Text>
          <Text className={`text-sm text-center ${isWsConnected ? 'text-green-600' : 'text-red-600'}`}>
              WebSocket: {wsStatusText} {isLeaving ? '(Выход...)' : ''}
          </Text>
          {error && <Text className='text-destructive text-center mt-2'>{error}</Text>}
          {wsError && <Text className='text-destructive text-center mt-1'>Ошибка WS: {wsError instanceof Error ? wsError.message : 'Проблема соединения'}</Text>}
        </View>
      </View>

      <View className='flex-1 p-4'>
        {/* Container for max width */}
        <View className='mx-auto w-full h-full' style={{ maxWidth: 768 }}>
          {/* Player List */}
          <Card className='flex-1'>
            <CardHeader>
              <CardTitle>Игроки ({roomInfo?.players?.length ?? 0} / {roomInfo?.capacity ?? '?'})</CardTitle>
            </CardHeader>
            <CardContent className='flex-1 p-0'>
              <FlatList
                data={roomInfo?.players ?? []}
                renderItem={renderPlayerItem}
                keyExtractor={(item) => item.id}
                refreshing={isRefreshing}
                onRefresh={handleRefreshPlayers}
                ListEmptyComponent={<Text className='text-center text-muted-foreground p-4'>Ожидание игроков...</Text>}
                contentContainerStyle={{ paddingBottom: 20 }} // Extra padding for mobile
              />
            </CardContent>
          </Card>
        </View>
      </View>

      {/* Footer Buttons */}
      <View className='p-4 border-t border-border bg-card'>
        <View className='mx-auto w-full' style={{ maxWidth: 768 }}>
          {isAdmin ? (
            <View className='flex-row justify-between items-center'>
              <Button
                variant="destructive"
                onPress={handleCloseGame}
                disabled={isClosing || isLeaving || !isWsConnected} // Disable if leaving or already closing
                className='flex-1 mr-2'
              >
                {isClosing ? <ActivityIndicator size="small" color="#ffffff" /> : <Text>Закрыть игру</Text>}
              </Button>
              <Button
                onPress={handleStartGame}
                // Enable start only when waiting and connected, and not leaving/closing
                disabled={isStarting || isClosing || isLeaving || !isWsConnected || !(gameStatus === 'WAITING_FOR_PLAYERS' || gameStatus === 'MAIN_PLAYER_THINKING')}
                className='flex-1 ml-2'
              >
                {isStarting ? <ActivityIndicator size="small" color="#ffffff" /> : <Text>Принудительно начать игру</Text>}
              </Button>
            </View>
          ) : (
            // Non-admin: No explicit leave button needed, back action handles it.
            <View className='flex-1'>
              <Text className='text-muted-foreground text-center'>Нажмите "Назад", чтобы выйти из лобби.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}