import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { useWebSocketGame, GameStatus } from '~/hooks/useWebSocketGame';
import { closeGame } from '~/lib/api/client'; // Import closeGame API

const THEME_INPUT_DURATION_S = 60; // 60 seconds for admin to input theme

export default function ThinkingScreen() {
  // --- Hooks and State ---
  const params = useLocalSearchParams<{ gameId: string; userId?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null;
  
  console.log('[ThinkingScreen] Mounted with params:', { gameId, userId });

  // Отладочная информация при монтировании компонента
  useEffect(() => {
    console.log('[ThinkingScreen] Монтирование с параметрами:', {
      gameId,
      userId,
      note: 'Экран только для админов'
    });
  }, []); // Выполняем только при монтировании

  const [themeText, setThemeText] = useState('');
  const [timeLeft, setTimeLeft] = useState(THEME_INPUT_DURATION_S);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Исправляем тип таймера для совместимости с React Native
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebSocket connection
  const {
    isConnected: isWsConnected,
    error: wsError,
    readyState: wsReadyState,
    gameStatus,
    currentTheme, // Получаем тему из WebSocket
    sendMessage,
    handleApiError, // Import the handleApiError function
  } = useWebSocketGame(gameId, userId);

  // Set up timer when component mounts
  useEffect(() => {
    console.log('[ThinkingScreen] 🕒 Starting timer for admin');
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        const newTime = prev - 1;
        if (newTime <= 0) {
          // Clear interval when time is up
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return newTime;
      });
    }, 1000);

    // Cleanup timer when component unmounts
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []); // Run only once on mount

  // Handle theme submission
  const handleSubmitTheme = useCallback(async () => {
    if (!themeText.trim() || !isWsConnected) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      
      // Send theme to the WebSocket server
      console.log('[ThinkingScreen] 📤 Sending theme to WebSocket server');
      sendMessage({
        action: 'admin-set-theme',
        theme: themeText.trim(),
        gameId: gameId,
      });
      
      // Success handled by the gameStatus/currentTheme effect which will route to scenario
      console.log('[ThinkingScreen] 🟢 Theme sent, waiting for server acknowledgement');
      
    } catch (err) {
      console.error('[ThinkingScreen] ❌ Error submitting theme:', err);
      handleApiError(err as Error, gameId, userId, true); // Use the imported error handler with all required arguments
      setError('Не удалось отправить тему. Попробуйте еще раз.');
    } finally {
      setIsSubmitting(false);
    }
  }, [gameId, themeText, isWsConnected, sendMessage, handleApiError]);

  // Handle transition to next screen based on game status
  useEffect(() => {
    console.log(`[ThinkingScreen] 🔄 Game status changed to: ${gameStatus}`);
    
    // Proceed directly to answer screen for admin when we receive the theme or when game status changes to SCENARIO_PRESENTED
    // We use currentTheme as a signal that the server has acknowledged our theme submission
    if (gameStatus === 'SCENARIO_PRESENTED' || (currentTheme && currentTheme.trim() !== '')) {
      console.log('[ThinkingScreen] 🔄 Admin: Transitioning directly to answer screen');
      router.replace({
        pathname: '/game/answer',
        params: { 
          gameId, 
          userId, 
          isAdmin: 'true',
          scenario: themeText.trim() // Pass the theme directly to answer screen
        }
      });
    }
  }, [gameStatus, gameId, userId, currentTheme, themeText]);

  // --- UI Rendering ---
  console.log(`[ThinkingScreen] 🎨 Rendering UI with gameStatus=${gameStatus}`);
  
  return (
    <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className='flex-1 bg-background'
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
        <ScrollView 
          contentContainerStyle={{ 
            flexGrow: 1, 
            justifyContent: 'center',
            padding: 16,
            paddingBottom: 40 // Extra padding at the bottom for mobile
          }}
        >
          <View className='flex-1 justify-center items-center'>
            <Stack.Screen options={{ title: 'Ввод темы' }} />
            
            <View className='w-full mx-auto' style={{ maxWidth: 640 }}>
              <Text className='text-2xl font-bold mb-4 text-foreground text-center'>Введите тему для игры</Text>
              <Text className='text-lg mb-6 text-muted-foreground text-center'>Осталось времени: {timeLeft}с</Text>
              <TextInput
                  value={themeText}
                  onChangeText={setThemeText}
                  placeholder="Например, выживание при зомби-апокалипсисе"
                  className='w-full border border-border rounded-md p-3 mb-6 text-foreground bg-input'
                  placeholderTextColor={'hsl(var(--muted-foreground))'}
                  editable={!isSubmitting && timeLeft > 0} // Disable if submitting or time's up
              />
              <Button
                  onPress={handleSubmitTheme}
                  disabled={isSubmitting || !isWsConnected || !themeText.trim() || timeLeft <= 0}
                  className='w-full'
              >
                  {isSubmitting ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                      <Text>Отправить тему</Text>
                  )}
              </Button>
              {error && <Text className='text-destructive text-center mt-4'>{error}</Text>}
              {wsError && <Text className='text-destructive text-center mt-2'>Ошибка WS: {wsError instanceof Error ? wsError.message : 'Проблема с соединением'}</Text>}
            </View>
          </View>
        </ScrollView>
    </KeyboardAvoidingView>
  );
}