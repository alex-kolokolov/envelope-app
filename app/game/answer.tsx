import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Video, ResizeMode } from 'expo-av';
import { View, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { useWebSocketGame, GameStatus } from '~/hooks/useWebSocketGame'; // Import hook and GameStatus

const ANSWER_INPUT_DURATION_S = 60; // 60 seconds for player to input answer

export default function AnswerScreen() {
  // --- Hooks and State ---
  const params = useLocalSearchParams<{ gameId: string; userId?: string; isAdmin?: string; scenario?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null;
  const isAdmin = params.isAdmin === 'true';
  const scenarioFromParams = params.scenario;
  
  // Get scenario from params or WebSocket if available

  const [answerText, setAnswerText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ANSWER_INPUT_DURATION_S);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timerInitializedRef = useRef<boolean>(false); // Flag to track if timer has been initialized

  const adVideos = [
    require('../../assets/videos/Запись 2025-04-29 020627.mp4'),
    require('../../assets/videos/Запись экрана 2025-04-29 020404.mp4'),
    require('../../assets/videos/Запись экрана 2025-04-29 020605.mp4'),
  ];
  const [adVideoIdx, setAdVideoIdx] = useState<number | null>(null);
  const [showAd, setShowAd] = useState(false);
  // Обработчик ошибок для предупреждений видео
  const [videoError, setVideoError] = useState<boolean>(false);
  // State for API-fetched theme
  const [apiTheme, setApiTheme] = useState<string | null>(null);
  const [isLoadingTheme, setIsLoadingTheme] = useState<boolean>(false);
  
  // Обработчик ошибок для компонента Video
  useEffect(() => {
    // Переопределяем console.warn, чтобы игнорировать предупреждения expo-av
    const originalWarn = console.warn;
    console.warn = (...args) => {
      // Игнорируем предупреждения от expo-av
      if (args[0] && typeof args[0] === 'string' && args[0].includes('expo-av')) {
        // Просто логируем их без сбоя
        console.log('Игнорируем предупреждение expo-av:', args[0].substring(0, 100) + '...');
        return;
      }
      originalWarn(...args);
    };
    
    return () => {
      // Восстанавливаем оригинальную функцию
      console.warn = originalWarn;
    };
  }, []);

  // WebSocket connection - Use gameStatus
  const {
    sendMessage,
    gameStatus, // Use status from hook
    error: wsError,
    isConnected: isWsConnected,
    currentTheme: wsTheme, // Get theme from WebSocket
  } = useWebSocketGame(gameId, userId);
  
  // Fetch theme from API if needed
  useEffect(() => {
    const fetchThemeFromAPI = async () => {
      // Only fetch from API if we don't have theme from params or WebSocket
      if (!scenarioFromParams && !wsTheme && !apiTheme && gameId) {
        console.log(`[AnswerScreen] No theme from params or WebSocket, fetching from API...`);
        setIsLoadingTheme(true);
        
        try {
          const response = await fetch(`http://103.137.250.117:6952/room/${gameId}/theme`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.theme) {
              console.log(`[AnswerScreen] Successfully fetched theme from API: "${data.theme}"`);
              setApiTheme(data.theme);
            } else {
              console.log(`[AnswerScreen] API response didn't contain theme:`, data);
            }
          } else {
            console.log(`[AnswerScreen] API response not ok: ${response.status} ${response.statusText}`);
          }
        } catch (error) {
          console.error(`[AnswerScreen] Error fetching theme from API:`, error);
        } finally {
          setIsLoadingTheme(false);
        }
      }
    };
    
    fetchThemeFromAPI();
  }, [gameId, scenarioFromParams, wsTheme, apiTheme]);
  
  // Use scenario from params first, then from WebSocket, then from API, then fallback
  const scenario = scenarioFromParams || wsTheme || apiTheme || 'Scenario not provided.';
  
  // Log for debugging
  console.log(`[AnswerScreen] Scenario sources - fromParams: "${scenarioFromParams}", fromWS: "${wsTheme}", fromAPI: "${apiTheme}", using: "${scenario}"`);

  // --- Timer Logic ---
  useEffect(() => {
    console.log(`[AnswerScreen] Timer effect: gameStatus=${gameStatus}, timerInitialized=${timerInitializedRef.current}, timeLeft=${timeLeft}`);
    
    // Only initialize the timer once when we first enter the correct state
    if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT' && !hasSubmitted && !timerInitializedRef.current) {
      console.log('[AnswerScreen] Initializing timer for the first time');
      setTimeLeft(ANSWER_INPUT_DURATION_S); // Set initial timer value
      timerInitializedRef.current = true; // Mark timer as initialized
      
      timerRef.current = setInterval(() => {
        setTimeLeft((prevTime) => {
          console.log(`[AnswerScreen] Timer tick: ${prevTime} seconds remaining`);
          if (prevTime <= 1) {
            clearInterval(timerRef.current!);
            timerRef.current = null;
            // Handle timer expiration - auto-submit "Нет ответа" when time runs out
            console.log("Answer input timer expired. Auto-submitting default answer.");
            Alert.alert("Время вышло!", "Вы не успели отправить ответ.", [{ text: "OK" }]);
            // Auto-submit default answer
            if (!hasSubmitted && isWsConnected) {
              console.log(`Auto-submitting default answer: "Нет ответа"`);
              sendMessage("Нет ответа");
              setHasSubmitted(true);
            }
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000);
    } else if (hasSubmitted || gameStatus !== 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
      // Clear timer if already submitted or game status changes
      if (timerRef.current) {
        console.log('[AnswerScreen] Clearing timer due to submission or status change');
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    // Cleanup timer on unmount
    return () => {
      if (timerRef.current) {
        console.log('[AnswerScreen] Cleaning up timer on unmount');
        clearInterval(timerRef.current);
      }
    };
  }, [gameStatus, hasSubmitted, isWsConnected, sendMessage]); // Keep dependencies

  useEffect(() => {
    if (hasSubmitted && (gameStatus === 'WAITING_FOR_GPT' || gameStatus === 'WAITING_FOR_ALL_ANSWERS_FROM_GPT')) {
      if (adVideoIdx === null) {
        const idx = Math.floor(Math.random() * adVideos.length);
        setAdVideoIdx(idx);
      }
      setShowAd(true);
    } else {
      setShowAd(false);
    }
  }, [hasSubmitted, gameStatus]);

  // --- Actions ---
  const handleSubmit = useCallback(async () => {
    // Allow submission only if not already submitted, time > 0, and connected
    if (!hasSubmitted && timeLeft > 0 && isWsConnected) {
      setIsSubmitting(true);
      setError(null);
      try {
        // Send the answer text, or "Нет ответа" if empty
        const finalAnswer = answerText.trim() || "Нет ответа";
        console.log(`Submitting answer: ${finalAnswer}`);
        sendMessage(finalAnswer);
        setHasSubmitted(true); // Mark as submitted
        timerInitializedRef.current = false; // Reset the timer and initialization flag when submitting

        // Stop the timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        // Keep user here, wait for WebSocket status update to navigate
      } catch (err) {
        console.error('Failed to send answer:', err);
        setError(err instanceof Error ? err.message : 'Failed to submit answer.');
        // Don't reset hasSubmitted here, maybe allow retry? For now, no retry.
      } finally {
        setIsSubmitting(false); // Finished submission attempt
      }
    }
  }, [answerText, hasSubmitted, timeLeft, isWsConnected, sendMessage]);

  // --- API Theme Fetching ---
  // This hook needs to be at the top level, not nested inside another hook
  useEffect(() => {
    const fetchThemeFromAPI = async () => {
      // Only fetch from API if we don't have theme from params or WebSocket
      if (!scenarioFromParams && !wsTheme && !apiTheme && gameId) {
        console.log(`[AnswerScreen] No theme from params or WebSocket, fetching from API...`);
        setIsLoadingTheme(true);
        
        try {
          const response = await fetch(`http://103.137.250.117:6952/room/${gameId}/theme`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.theme) {
              console.log(`[AnswerScreen] Successfully fetched theme from API: "${data.theme}"`);
              setApiTheme(data.theme);
            } else {
              console.log(`[AnswerScreen] API response didn't contain theme:`, data);
            }
          } else {
            console.log(`[AnswerScreen] API response not ok: ${response.status} ${response.statusText}`);
          }
        } catch (error) {
          console.error(`[AnswerScreen] Error fetching theme from API:`, error);
        } finally {
          setIsLoadingTheme(false);
        }
      }
    };
    
    fetchThemeFromAPI();
  }, [gameId, scenarioFromParams, wsTheme, apiTheme]);
  
  // --- Game Status Change Handling (Navigation) ---
  useEffect(() => {
    console.log(`[AnswerScreen] Status Changed: ${gameStatus}, isAdmin: ${isAdmin}, userId: ${userId}, scenarioParam: ${params.scenario}`);
    
    // Enhanced logging for debugging navigation flow
    console.log(`[AnswerScreen] 📊 Current state: gameStatus=${gameStatus}, hasSubmitted=${hasSubmitted}, isWsConnected=${isWsConnected}`);

    // Force an immediate re-render if isAdmin was passed as a string instead of boolean
    if (!isAdmin && params.isAdmin === 'true') {
      console.log(`[AnswerScreen] ⚠️ isAdmin flag incorrect (string vs boolean issue). Fixing...`);
      
      // Add random query param to prevent stale navigation cache issues
      const randomParam = Date.now().toString();
      
      router.replace({
        pathname: '/game/answer',
        params: { 
          gameId, 
          userId, 
          isAdmin: 'true', 
          scenario: scenario,
          _: randomParam // Cache-busting parameter
        }
      });
      return;
    }
    
    // Navigate when results are ready or game is done/closed
    if (
      gameStatus === 'RESULTS_READY' ||
      gameStatus === 'STATS_READY' ||
      gameStatus === 'GAME_DONE'
    ) {
      console.log(`[AnswerScreen] Navigating to results screen due to status: ${gameStatus}`);
      console.log(`[AnswerScreen] 📝 Passing scenario to results: "${scenario}"`);
      
      // Add a random parameter for cache busting
      const randomParam = Date.now().toString();
      
      router.replace({ // Use replace
        pathname: '/game/results',
        params: { 
          gameId, 
          userId, 
          isAdmin: isAdmin.toString(),
          scenario: scenario,
          _: randomParam // Cache-busting parameter
        },
      });
    }
    // Handle other status changes like game closing unexpectedly or regressing
    else if (gameStatus === 'CLOSED') {
         console.log(`Game closed (Status: ${gameStatus}). Navigating back to index.`);
         Alert.alert("Игра завершена", "Игра была закрыта. Возвращаемся на главный экран.", [{ text: "OK" }]);
         router.replace('/');
    } else if (
        gameStatus === 'WAITING_FOR_PLAYERS' ||
        gameStatus === 'MAIN_PLAYER_THINKING' ||
        gameStatus === 'THEME_INPUT' ||
        gameStatus === 'SCENARIO_PRESENTED' // If status goes back before answer phase
    ) {
        console.log(`Status changed unexpectedly to ${gameStatus}. Navigating back to lobby.`);
        router.replace({ pathname: '/lobby/[gameId]', params: { gameId, userId, isAdmin: isAdmin.toString() } });
    }
    // Stay on this screen if status is WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT or UNKNOWN

  }, [gameStatus, gameId, userId, isAdmin]); // Dependencies

  // --- UI Rendering ---
  const canSubmit = answerText.trim() && !hasSubmitted && timeLeft > 0 && isWsConnected;
  const displayStatus = gameStatus === 'UNKNOWN' ? 'Connecting...' : gameStatus;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className='flex-1 bg-background'
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <Stack.Screen options={{ title: 'Ответ' }} />

      <ScrollView 
        contentContainerStyle={{ 
          flexGrow: 1, 
          justifyContent: 'center',
          padding: 16,
          paddingBottom: 32 // Восстановленный отступ для правильного отображения видео
        }}
      >
        <View className='w-full mx-auto' style={{ maxWidth: 640 }}>
          {/* Display Scenario with Loading State */}
          {isLoadingTheme ? (
            <Card className='mb-6 bg-secondary'>
              <CardHeader>
                <CardTitle className='text-secondary-foreground'>Загрузка ситуации...</CardTitle>
              </CardHeader>
              <CardContent className='items-center justify-center'>
                <ActivityIndicator size="large" color={'hsl(var(--primary))'} />
                <Text className='text-base text-secondary-foreground mt-2 text-center'>
                  Получение ситуации из API...
                </Text>
              </CardContent>
            </Card>
          ) : (
            <Card className='mb-6 bg-secondary'>
              <CardHeader>
                <CardTitle className='text-secondary-foreground'>Ситуация:</CardTitle>
              </CardHeader>
              <CardContent>
                <Text className='text-base text-secondary-foreground'>
                  {scenario}
                </Text>
              </CardContent>
            </Card>
          )}

          {/* Timer */}
          {!hasSubmitted && timeLeft > 0 && (
             <Text className='text-lg mb-4 text-center text-muted-foreground'>Время осталось: {timeLeft}s</Text>
          )}
          {timeLeft <= 0 && !hasSubmitted && (
              <Text className='text-lg mb-4 text-center text-destructive'>Время вышло!</Text>
          )}


          {/* Answer Input Area */}
          <Text className='text-lg font-semibold mb-2 text-foreground'>
            Ваш ответ:
          </Text>
          <TextInput
            placeholder='Введите ваш ответ...'
            placeholderTextColor={'hsl(var(--muted-foreground))'}
            value={answerText}
            onChangeText={setAnswerText}
            multiline
            numberOfLines={5}
            className={`border border-border rounded p-3 mb-6 text-foreground bg-input h-40 text-base align-text-top ${hasSubmitted || timeLeft <= 0 ? 'opacity-50' : ''}`}
            textAlignVertical='top'
            editable={!isSubmitting && !hasSubmitted && timeLeft > 0} // Disable after submitting or time up
          />

          {/* Submit Button / Status */}
          {hasSubmitted ? (
             <View className='items-center p-4 border border-dashed border-primary rounded-lg bg-muted'>
                {showAd && adVideoIdx !== null && !videoError && (
                  <View className="mb-4">
                    <Video
                      source={adVideos[adVideoIdx]}
                      style={{ width: '100%', height: 200 }}
                      resizeMode={ResizeMode.CONTAIN}
                      shouldPlay
                      isLooping
                      onError={(e) => {
                        console.log('Video error:', e);
                        setVideoError(true);
                      }}
                    />
                  </View>
                )}
                <Text className='text-primary font-semibold'>Ответ отправлен!</Text>
                <Text className='text-muted-foreground text-center mt-1'>Ожидаем других игроков или результатов...</Text>
                <Text className='text-muted-foreground text-xs mt-2'>Статус: {displayStatus}</Text>
                {/* Show spinner while waiting for next status */}
                {(gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT' ||
                  gameStatus === 'WAITING_FOR_GPT' ||
                  gameStatus === 'WAITING_FOR_ALL_ANSWERS_FROM_GPT') && <ActivityIndicator size="small" className='mt-2'/>}
             </View>
          ) : (
            <Button onPress={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text>Отправить</Text>
              )}
            </Button>
          )}
           {error && <Text className='text-destructive text-center mt-2'>{error}</Text>}
           {wsError && <Text className='text-destructive text-center mt-1'>Ошибка соединения: {wsError instanceof Error ? wsError.message : 'Проблема с соединением'}</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}