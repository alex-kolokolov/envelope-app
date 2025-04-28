import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { useWebSocketGame, GameStatus } from '~/hooks/useWebSocketGame';
import { closeGame } from '~/lib/api/client'; // Import closeGame API

const THEME_INPUT_DURATION_S = 60; // 60 seconds for admin to input theme

export default function ThinkingScreen() {
  // --- Hooks and State ---
  const params = useLocalSearchParams<{ gameId: string; userId?: string; isAdmin?: string }>();
  const gameId = params.gameId;
  const userId = params.userId ?? null;
  const isAdmin = params.isAdmin === 'true';

  const [themeText, setThemeText] = useState('');
  const [timeLeft, setTimeLeft] = useState(THEME_INPUT_DURATION_S);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // WebSocket connection
  const {
    isConnected: isWsConnected,
    error: wsError,
    readyState: wsReadyState,
    gameStatus,
    sendMessage,
    handleApiError, // Import the handleApiError function
  } = useWebSocketGame(gameId, userId);

  // --- Timer Logic ---
  useEffect(() => {
    const duration = isAdmin ? THEME_INPUT_DURATION_S : THEME_INPUT_DURATION_S + 5;
    setTimeLeft(duration);
    timerRef.current = setInterval(() => {
      setTimeLeft((prevTime) => {
        if (prevTime <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          // Handle timer expiration inline
          if (isAdmin) {
            closeGame(gameId!).catch(err => {
              setError("Failed to automatically close the game. Please go back.");
              handleApiError(err, gameId!, userId, isAdmin);
            });
            Alert.alert("Время истекло!", "Вы не успели ввести тему. Игра будет закрыта.", [{ text: "OK" }]);
          } else {
            Alert.alert("Время истекло!", "Ожидаем ответа от администратора или сервера...", [{ text: "OK" }]);
          }
          return 0;
        }
        return prevTime - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isAdmin, gameId, userId, handleApiError]);

  // --- Game Status Polling for non-admin (handle 500 error) ---
  useEffect(() => {
    if (!isAdmin && gameStatus === 'THEME_INPUT' && gameId) {
      const interval = setInterval(async () => {
        try {
          // Use direct API to check status
          const res = await fetch(`http://localhost:8080/room/${gameId}/status`);
          if (!res.ok) {
            if (res.status === 500) {
              router.replace('/'); // Go to main menu
            }
          }
        } catch (e) {
          // Network error, treat as 500
          router.replace('/');
        }
      }, 3000); // Poll every 3s
      return () => clearInterval(interval);
    }
  }, [isAdmin, gameStatus, gameId]);

  // --- Actions ---
  const handleSubmitTheme = useCallback(() => {
    if (!isAdmin || !themeText.trim() || isSubmitting || !isWsConnected) return;

    setIsSubmitting(true);
    setError(null);
    console.log(`Admin submitting theme: ${themeText}`);

    try {
        // Send the theme text directly as a string message
        sendMessage(themeText.trim());

        // Stop the timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        // Optional: Show feedback like "Theme submitted, waiting..."
        // Navigation will be handled by the status change effect
    } catch (err) {
        console.error("Failed to send theme message:", err);
        setError(err instanceof Error ? err.message : "Failed to submit theme via WebSocket.");
        setIsSubmitting(false); // Allow retry
    } finally {
        // Don't set isSubmitting false here if we expect navigation
        // setIsSubmitting(false);
    }
  }, [isAdmin, themeText, isSubmitting, isWsConnected, sendMessage]);

  // --- Game Status Change Handling (Navigation) ---
  useEffect(() => {
    // Navigate away if status is no longer THEME_INPUT or if disconnected
    if (gameStatus !== 'THEME_INPUT' && gameStatus !== 'UNKNOWN') { // Allow UNKNOWN during initial load
        console.log(`ThinkingScreen: Navigating away due to status change: ${gameStatus}`);
        // Go back to lobby or appropriate screen if status regresses or advances unexpectedly
        if (gameStatus === 'WAITING_FOR_PLAYERS' || gameStatus === 'CLOSED') {
             router.replace({ pathname: '/lobby/[gameId]', params: { gameId, userId, isAdmin: isAdmin.toString() } });
        } else if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
             // Navigate admin directly to answer screen
             router.replace({ pathname: '/game/scenario', params: { gameId, userId, isAdmin: isAdmin.toString(), scenario: themeText } });
        } 
        // Add other navigation cases if needed
    }
  }, [gameStatus, gameId, userId, isAdmin, themeText]);

  // --- UI Rendering ---
  return (
    <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className='flex-1'
    >
        <View className='flex-1 justify-center items-center p-4 bg-background'>
            <Stack.Screen options={{ title: isAdmin ? 'Ввод темы' : 'Ожидание...' }} />

            {isAdmin ? (
                <>
                    <Text className='text-2xl font-bold mb-4 text-foreground'>Введите тему для игры</Text>
                    <Text className='text-lg mb-6 text-muted-foreground'>Осталось времени: {timeLeft}с</Text>
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
                </>
            ) : (
                <>
                    <ActivityIndicator size='large' color={'hsl(var(--primary))'} />
                    <Text className='mt-4 text-lg text-muted-foreground'>Ожидаем, пока админ выберет тему</Text>
                    {wsError && <Text className='text-destructive text-center mt-4'>Ошибка WS: {wsError instanceof Error ? wsError.message : 'Проблема с соединением'}</Text>}
                </>
            )}
        </View>
    </KeyboardAvoidingView>
  );
}