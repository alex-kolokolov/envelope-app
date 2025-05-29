import React, { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Text } from '~/components/ui/text';
import { useWebSocketGame, GameStatus } from '~/hooks/useWebSocketGame'; // Import hook and GameStatus

export default function ScenarioScreen() {
  // --- Hooks ---
  const params = useLocalSearchParams<{ gameId: string; userId?: string; theme?: string; scenario?: string; isAdmin?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null;
  const isAdmin = params.isAdmin === 'true';
  const themeFromParams = params.theme ?? params.scenario ?? null; // Get the theme passed from thinking screen for admin

  // WebSocket connection for game status and theme
  const {
    gameStatus,
    currentTheme: wsTheme, // Theme from WebSocket
    error: wsError,
    readyState: wsReadyState,
    lastSystemMessage, // For debugging
  } = useWebSocketGame(gameId, userId);

  // The theme to display - use param theme first (for admin), fallback to WebSocket
  const themeToUse = themeFromParams || wsTheme;
  
  // Debug log for theme values
  console.log(`[ScenarioScreen] Theme values - themeFromParams: "${themeFromParams}", wsTheme: "${wsTheme}", themeToUse: "${themeToUse}"`);

  // --- Timer for MAIN_PLAYER_THINKING ---
  const MAIN_PLAYER_THINKING_DURATION_S = 65; // Duration for non-admin
  const [timeLeft, setTimeLeft] = useState(MAIN_PLAYER_THINKING_DURATION_S);
  // Use a more flexible type that works in both Node.js and browser environments
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start timer when MAIN_PLAYER_THINKING
  useEffect(() => {
    console.log(`[ScenarioScreen] Timer effect triggered. Status: ${gameStatus}`);
    
    if (gameStatus === 'MAIN_PLAYER_THINKING') {
      console.log(`[ScenarioScreen] Starting timer. Duration: ${MAIN_PLAYER_THINKING_DURATION_S}s`);
      setTimeLeft(MAIN_PLAYER_THINKING_DURATION_S);
      setTimerExpired(false);
      
      // Clear any existing timer first to prevent duplicates
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      // Start a new timer
      timerRef.current = setInterval(() => {
        setTimeLeft((prevTime) => {
          console.log(`[ScenarioScreen] Timer tick: ${prevTime-1}s`);
          if (prevTime <= 1) {
            console.log(`[ScenarioScreen] Timer expired`);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setTimerExpired(true);
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
    } else {
      console.log(`[ScenarioScreen] Status is not MAIN_PLAYER_THINKING, clearing timer if exists`);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setTimerExpired(false);
    }
    
    // Cleanup function
    return () => {
      console.log(`[ScenarioScreen] Cleanup: clearing timer`);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [gameStatus, MAIN_PLAYER_THINKING_DURATION_S]);

  // По окончании времени: выйти в главное меню
  useEffect(() => {
    if (timerExpired && gameStatus === 'MAIN_PLAYER_THINKING') {
      // Для не-админа — выход в главное меню
      router.replace('/');
    }
  }, [timerExpired, gameStatus, gameId]);

  // Force a refresh of game status when component mounts to ensure we detect MAIN_PLAYER_THINKING
  useEffect(() => {
    console.log(`[ScenarioScreen] Component mounted - Current status: ${gameStatus}`);
    // Immediately check if we're already in MAIN_PLAYER_THINKING to start timer
    if (gameStatus === 'MAIN_PLAYER_THINKING' && !timerRef.current) {
      console.log(`[ScenarioScreen] Found MAIN_PLAYER_THINKING on mount, manually triggering timer`);
      setTimeLeft(MAIN_PLAYER_THINKING_DURATION_S);
      timerRef.current = setInterval(() => {
        setTimeLeft((prevTime) => {
          if (prevTime <= 1) {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setTimerExpired(true);
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
    }
  }, [gameStatus, MAIN_PLAYER_THINKING_DURATION_S]);

  // --- Game Status Change Handling (Navigation) ---
  useEffect(() => {
    console.log(`[ScenarioScreen] Status Changed: ${gameStatus}, theme: ${themeToUse}, wsTheme: ${wsTheme}`);

    // Для отладки: добавим важную информацию о содержании сообщений от сервера
    if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
      console.log(`[ScenarioScreen] ⚠️ КРИТИЧЕСКАЯ ТОЧКА НАВИГАЦИИ - ДОЛЖЕН ПЕРЕЙТИ НА ANSWER!`);
    }

    // Navigate when the status indicates it's time for player input
    if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
        console.log(`[ScenarioScreen] 🚨 Navigating to answer screen due to status: ${gameStatus}`);
        
        // Get the latest theme values
        console.log(`[ScenarioScreen] 📝 Current theme values - themeFromParams: "${themeFromParams}", wsTheme: "${wsTheme}"`);
        console.log(`[ScenarioScreen] 📝 Theme to use: "${themeToUse || 'undefined'}"`);
        
        // Add random query param to prevent stale navigation cache issues
        const randomParam = Date.now().toString();
        
        // Forcibly navigate to answer screen when the status changes
        router.replace({ // Use replace to prevent going back here
            pathname: '/game/answer',
            params: { 
                gameId, 
                userId, 
                isAdmin: isAdmin ? 'true' : 'false',
                scenario: themeToUse || '', // Use the best theme we have
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
                  isAdmin: isAdmin ? 'true' : 'false',
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
         router.replace({ pathname: '/lobby/[gameId]', params: { gameId, isAdmin: isAdmin ? 'true' : 'false' } });
     }
     // No navigation needed if status is SCENARIO_PRESENTED or UNKNOWN/Connecting

  }, [gameStatus, gameId, wsTheme, themeFromParams, isAdmin, themeToUse]); // Depend on all theme sources

  // --- UI Rendering ---
  // Use themeToUse for loading check and display
  const isLoading = gameStatus === 'UNKNOWN' || (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT' && !themeToUse);
  const displayStatus = gameStatus === 'UNKNOWN' ? 'Соединение...' : gameStatus;

  return (
    <View className='flex-1 bg-background'>
      <Stack.Screen options={{ title: 'Сценарий' }} />
      
      <View className='flex-1 justify-center items-center p-6' style={{ paddingBottom: 40 }}>
        <View className='mx-auto w-full' style={{ maxWidth: 640 }}>
          {/* Показываем таймер только в фазе MAIN_PLAYER_THINKING */}
          {gameStatus === 'MAIN_PLAYER_THINKING' && (
            <Text className='text-lg mb-6 text-muted-foreground font-bold text-center'>Осталось времени: {timeLeft}с</Text>
          )}
          {timerExpired && (
            <Text className='text-destructive mb-6 text-center'>Время ожидания истекло. Ожидаем решения ведущего...</Text>
          )}
          {error && (
            <Text className='text-destructive mb-6 text-center'>{error}</Text>
          )}
          {isLoading ? (
            <View className='items-center'>
              <ActivityIndicator size="large" color={'hsl(var(--primary))'} />
              <Text className='mt-4 text-muted-foreground'>Ожидание сценария...</Text>
            </View>
          ) : wsError ? (
             <Text className='text-destructive text-center'>Ошибка WebSocket: {wsError instanceof Error ? wsError.message : 'Проблема с соединением'}</Text>
          ) : gameStatus === 'MAIN_PLAYER_THINKING' ? (
            <View className='items-center'>
              <Text className='text-xl font-semibold mb-6 text-center text-foreground'>
                Ожидание ведущего
              </Text>
              <Text className='text-lg text-center mb-8 text-foreground p-4 border border-border rounded bg-card'>
                Ведущий думает над темой игры. Пожалуйста, подождите...
              </Text>
              <ActivityIndicator size="large" color={'hsl(var(--primary))'} className='mb-4' />
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
                {themeToUse || 'Ожидаем, пока ведущий выберет тему'}
              </Text>
              <Text className='text-muted-foreground italic'>
                 Статус: {displayStatus}
              </Text>
               {/* Show spinner if we are in scenario state but waiting for next status */}
               {gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT' && (
                 <ActivityIndicator size="small" color={'hsl(var(--primary))'} className='mt-4' />
               )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}