import React, { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Text } from '~/components/ui/text';
import { useWebSocketGame, GameStatus } from '~/hooks/useWebSocketGame'; // Import hook and GameStatus
import { closeGame } from '~/lib/api/client';

export default function ScenarioScreen() {
  // --- Hooks ---
  // Add 'theme' to the expected params
  const params = useLocalSearchParams<{ gameId: string; userId?: string; isAdmin?: string; theme?: string; scenario?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null;
  const isAdmin = params.isAdmin === 'true';
  const adminThemeParam = params.theme ?? params.scenario ?? null; // Get the theme passed from thinking screen (for admin)

  // WebSocket connection - Use gameStatus and currentTheme from hook (for non-admins)
  const {
    gameStatus,
    currentTheme: wsTheme, // Theme from WebSocket for non-admins
    error: wsError,
    readyState: wsReadyState,
    lastSystemMessage, // Добавляем для отладки
  } = useWebSocketGame(gameId, userId);

  // Determine the theme to display and pass forward
  // Admin sees their submitted theme immediately via param, others wait for WebSocket
  const themeToUse = isAdmin && adminThemeParam ? adminThemeParam : wsTheme;
  
  // Debug log for theme values to track issues
  console.log(`[ScenarioScreen] Theme values - adminThemeParam: "${adminThemeParam}", wsTheme: "${wsTheme}", themeToUse: "${themeToUse}"`);

  // --- Timer for MAIN_PLAYER_THINKING ---
  const MAIN_PLAYER_THINKING_DURATION_S = isAdmin ? 60 : 65; // +5 секунд для не-админа
  const [timeLeft, setTimeLeft] = useState(MAIN_PLAYER_THINKING_DURATION_S);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start timer when MAIN_PLAYER_THINKING
  useEffect(() => {
    if (gameStatus === 'MAIN_PLAYER_THINKING') {
      setTimeLeft(isAdmin ? 60 : 65);
      setTimerExpired(false);
      timerRef.current = setInterval(() => {
        setTimeLeft((prevTime) => {
          if (prevTime <= 1) {
            clearInterval(timerRef.current!);
            timerRef.current = null;
            setTimerExpired(true);
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setTimerExpired(false);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [gameStatus, isAdmin]);

  // По окончании времени: если админ — закрыть комнату и выйти в главное меню, если не админ — просто выйти в главное меню
  useEffect(() => {
    if (timerExpired && gameStatus === 'MAIN_PLAYER_THINKING') {
      if (isAdmin) {
        (async () => {
          try {
            await closeGame(gameId);
          } catch (err) {
            setError('Ошибка при автозакрытии комнаты.');
          } finally {
            router.replace('/'); // Всегда выходим в главное меню
          }
        })();
      } else {
        // Для не-админа — выход в главное меню
        router.replace('/');
      }
    }
  }, [timerExpired, isAdmin, gameStatus, gameId]);

  // --- Game Status Change Handling (Navigation) ---
  useEffect(() => {
    console.log(`[ScenarioScreen] Status Changed: ${gameStatus}, isAdmin: ${isAdmin}, theme: ${themeToUse}, wsTheme: ${wsTheme}`);

    // Для отладки: добавим важную информацию о содержании сообщений от сервера
    if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
      console.log(`[ScenarioScreen] ⚠️ КРИТИЧЕСКАЯ ТОЧКА НАВИГАЦИИ - ДОЛЖЕН ПЕРЕЙТИ НА ANSWER!`);
    }

    // Navigate when the status indicates it's time for player input
    if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
        console.log(`[ScenarioScreen] 🚨 Navigating to answer screen due to status: ${gameStatus}, isAdmin: ${isAdmin}`);
        
        // Explicitly get the latest theme values to avoid stale closure issues
        const currentThemeToUse = isAdmin && adminThemeParam ? adminThemeParam : wsTheme;
        console.log(`[ScenarioScreen] 📝 Current theme values - adminThemeParam: "${adminThemeParam}", wsTheme: "${wsTheme}"`);
        console.log(`[ScenarioScreen] 📝 Theme to use: "${currentThemeToUse || 'undefined'}"`);
        
        // Add random query param to prevent stale navigation cache issues
        const randomParam = Date.now().toString();
        
        // Forcibly navigate to answer screen for ALL users when the status changes - fixes navigation issue
        router.replace({ // Use replace to prevent going back here
            pathname: '/game/answer',
            // Pass the determined theme (param for admin, hook for others) as 'scenario'
            params: { 
                gameId, 
                userId, 
                isAdmin: isAdmin.toString(), 
                scenario: isAdmin && adminThemeParam ? adminThemeParam : wsTheme || '', // Get fresh theme values to avoid stale data
                _: randomParam // Cache-busting parameter
            },
        });
    }
    // Handle other status changes like game ending, closing, or regressing
    else if (
        gameStatus === 'GAME_DONE' ||
        gameStatus === 'STATS_READY' || // Treat STATS_READY as end-game state too
        gameStatus === 'CLOSED'
    ) {
        console.log(`Game ended or closed (Status: ${gameStatus}). Navigating back to index.`);
        // Consider navigating to a results screen first if GAME_DONE/STATS_READY
        if (gameStatus === 'GAME_DONE' || gameStatus === 'STATS_READY') {
             console.log(`[ScenarioScreen] 📝 Navigating to results with theme: "${themeToUse || 'undefined'}"`);
             
             // Add a random parameter for cache busting
             const randomParam = Date.now().toString();
             
             router.replace({ 
                pathname: '/game/results', 
                params: { 
                  gameId, 
                  userId, 
                  isAdmin: isAdmin.toString(),
                  scenario: themeToUse || '', // Pass the theme as scenario
                  _: randomParam // Cache-busting parameter
                } 
             });
        } else {
             router.replace('/'); // Go back to the main screen for CLOSED
        }
    } else if (
        gameStatus === 'WAITING_FOR_PLAYERS' // Only navigate back if status truly regresses to waiting for players
     ) {
         // If status unexpectedly goes back to lobby/thinking states
         console.log(`Status regressed to ${gameStatus}. Navigating back to lobby.`);
         router.replace({ pathname: '/lobby/[gameId]', params: { gameId, isAdmin: isAdmin.toString() } });
     }
     // No navigation needed if status is SCENARIO_PRESENTED or UNKNOWN/Connecting

  }, [gameStatus, gameId, isAdmin, adminThemeParam, wsTheme]); // Depend on source values instead of derived themeToUse

  // --- UI Rendering ---
  // Use themeToUse for loading check and display
  const isLoading = gameStatus === 'UNKNOWN' || (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT' && !themeToUse);
  const displayStatus = gameStatus === 'UNKNOWN' ? 'Соединение...' : gameStatus;

  return (
    <View className='flex-1 bg-background p-6 justify-center items-center'>
      <Stack.Screen options={{ title: 'Сценарий' }} />

      {/* Показываем таймер только в фазе MAIN_PLAYER_THINKING */}
      {gameStatus === 'MAIN_PLAYER_THINKING' && (
        <Text className='text-lg mb-6 text-muted-foreground'>Осталось времени: {timeLeft}с</Text>
      )}
      {timerExpired && !isAdmin && (
        <Text className='text-destructive mb-6'>Время ожидания истекло. Ожидаем решения ведущего...</Text>
      )}
      {error && (
        <Text className='text-destructive mb-6'>{error}</Text>
      )}
      {isLoading ? (
        <>
          <ActivityIndicator size="large" />
          <Text className='mt-4 text-muted-foreground'>Ожидание сценария...</Text>
        </>
      ) : wsError ? (
         <Text className='text-destructive text-center'>Ошибка WebSocket: {wsError instanceof Error ? wsError.message : 'Проблема с соединением'}</Text>
      ) : gameStatus === 'MAIN_PLAYER_THINKING' && !isAdmin ? (
        <View className='items-center'>
          <Text className='text-xl font-semibold mb-6 text-center text-foreground'>
            Ожидание ведущего
          </Text>
          <Text className='text-lg text-center mb-8 text-foreground p-4 border border-border rounded bg-card'>
            Ведущий думает над темой игры. Пожалуйста, подождите...
          </Text>
          <ActivityIndicator size="large" className='mb-4' />
          <Text className='text-muted-foreground italic'>
             Статус: Ожидание ведущего
          </Text>
        </View>
      ) : (
        <View className='items-center'>
          <Text className='text-xl font-semibold mb-6 text-center text-foreground'>
            Вот ситуация:
          </Text>
          <Text className='text-lg text-center mb-8 text-foreground p-4 border border-border rounded bg-card'>
            {/* Display theme based on admin status */}
            {themeToUse || 'Ожидаем, пока ведущий выберет тему'}
          </Text>
          <Text className='text-muted-foreground italic'>
             Статус: {displayStatus}
          </Text>
           {/* Show spinner if we are in scenario state but waiting for next status */}
           {gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT' && (
             <ActivityIndicator size="small" className='mt-4' />
           )}
        </View>
      )}
    </View>
  );
}