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
  // Сначала берем из URL параметров
  const [isAdmin, setIsAdmin] = useState(params.isAdmin === 'true');
  
  // Состояние для отслеживания полученных системных сообщений
  const [systemInputPrompt, setSystemInputPrompt] = useState('');

  // Отладочная информация при монтировании компонента
  useEffect(() => {
    console.log('[ThinkingScreen] Монтирование с параметрами:', {
      gameId,
      userId,
      isAdmin,
      rawIsAdminParam: params.isAdmin
    });
    
    // При монтировании устанавливаем начальное значение из URL-параметра,
    // но потом это будет переопределено на основе WebSocket сообщений
    if (params.isAdmin === 'true' && !isAdmin) {
      setIsAdmin(true);
      console.log('[ThinkingScreen] Начальное значение isAdmin: true');
    } else if (params.isAdmin === 'false' && isAdmin) {
      setIsAdmin(false);
      console.log('[ThinkingScreen] Начальное значение isAdmin: false');
    }
  }, []);  // Выполняем только при монтировании

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

  // Получаем системные сообщения из сокета для определения роли
  // Это упрощенная реализация - в идеале нужно добавить дополнительные поля в useWebSocketGame
  const wsSystemMessages = React.useMemo(() => {
    if (wsError) {
      const errorMessage = wsError instanceof Error ? wsError.message : String(wsError);
      if (errorMessage.includes('Введите ситуацию')) return ['Введите ситуацию'];
      if (errorMessage.includes('Главный игрок вводит тему')) return ['Главный игрок вводит тему'];
    }
    
    // Здесь мы должны получать эти сообщения из WebSocket прямого потока
    // В реальном решении надо расширить useWebSocketGame, чтобы он возвращал lastSystemMessages
    
    // Временное решение - проверяем статус и возвращаем соответствующие сообщения
    if (gameStatus === 'THEME_INPUT') return ['Главный игрок вводит тему'];
    if (gameStatus === 'MAIN_PLAYER_THINKING' && systemInputPrompt === 'Введите ситуацию') {
      return ['Введите ситуацию'];
    }
    
    // Если нет явных сообщений, используем урл-параметр isAdmin для определения роли
    return params.isAdmin === 'true' ? ['Введите ситуацию'] : ['Главный игрок вводит тему'];
  }, [gameStatus, wsError, params.isAdmin, systemInputPrompt]);

  // Наблюдаем за изменениями статуса и сообщениями для определения роли
  useEffect(() => {
    // Отладочное логирование
    console.log('[ThinkingScreen] Статус игры:', gameStatus, 'Тема:', currentTheme, 'Системные сообщения:', wsSystemMessages);

    // Определяем роль по WebSocket сообщениям - ЭТО ГЛАВНЫЙ ИСТОЧНИК ПРАВДЫ
    // Независимо от URL-параметров и прочих факторов
    const isAdminMessage = wsSystemMessages.includes('Введите ситуацию');
    const isViewerMessage = wsSystemMessages.includes('Главный игрок вводит тему');
    
    console.log('[ThinkingScreen] Проверка сообщений:', { isAdminMessage, isViewerMessage, prev: isAdmin });
    console.log('[ThinkingScreen] Все системные сообщения:', JSON.stringify(wsSystemMessages));
    
    // ВАЖНО! Сообщение "Введите ситуацию" имеет ПРИОРИТЕТ над "Главный игрок вводит тему"
    // Если есть сообщение "Введите ситуацию" - это ВСЕГДА админ, независимо от других сообщений
    if (isAdminMessage) {
      setIsAdmin(true);
      setSystemInputPrompt('Введите ситуацию');
      console.log('[ThinkingScreen] Установлен админ по сообщению "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u0438\u0442\u0443\u0430\u0446\u0438\u044e"');
    } 
    // Только если НЕТ сообщения "Введите ситуацию", но есть "Главный игрок вводит тему" - это не-админ
    else if (isViewerMessage) {
      setIsAdmin(false);
      setSystemInputPrompt('Главный игрок вводит тему');
      console.log('[ThinkingScreen] Установлен не-админ по сообщению "\u0413\u043b\u0430\u0432\u043d\u044b\u0439 \u0438\u0433\u0440\u043e\u043a \u0432\u0432\u043e\u0434\u0438\u0442 \u0442\u0435\u043c\u0443"');
    }
    
    // Получена тема - запомним её для всех игроков
    if (currentTheme && currentTheme.trim() !== '') {
      setThemeText(currentTheme);
    }
  }, [gameStatus, currentTheme, wsSystemMessages, isAdmin]);

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
             // Navigate all users to scenario screen when admin has selected a theme
             router.replace({ 
                 pathname: '/game/scenario', 
                 params: { 
                     gameId, 
                     userId, 
                     isAdmin: isAdmin.toString(), 
                     scenario: themeText  // For admin this will have the theme, for non-admin it will be shown via WebSocket
                 } 
             });
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
            <Stack.Screen options={{ title: isAdmin ? 'Ввод темы' : 'Ожидание ввода темы' }} />

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
                // Интерфейс для не-админа
                <>
                    <ActivityIndicator size='large' color={'hsl(var(--primary))'} />
                    <Text className='mt-4 text-lg text-foreground font-medium'>
                      {systemInputPrompt || 'Ожидаем, пока ведущий выберет тему'}
                    </Text>
                    
                    {/* Показываем тему, если она пришла от сервера */}
                    {currentTheme && currentTheme.trim() !== '' && (
                      <View className='mt-4 p-4 bg-muted/20 rounded-md'>
                        <Text className='text-center font-medium'>Тема:</Text>
                        <Text className='text-center mt-2'>{currentTheme}</Text>
                      </View>
                    )}
                    
                    {wsError && <Text className='text-destructive text-center mt-4'>Ошибка WS: {wsError instanceof Error ? wsError.message : 'Проблема с соединением'}</Text>}
                </>
            )}
        </View>
    </KeyboardAvoidingView>
  );
}