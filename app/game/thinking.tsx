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
  // Initialize isAdmin from URL params as a fallback, but will update from WebSocket messages
  // This ensures we have a reasonable default until WebSocket determines the true role
  const [isAdmin, setIsAdmin] = useState(params.isAdmin === 'true'); // Initialize from URL param first
  console.log(`[ThinkingScreen] 🔑 Initial isAdmin from URL: ${params.isAdmin}, set to: ${isAdmin}`);
  
  // Состояние для отслеживания полученных системных сообщений
  const [systemInputPrompt, setSystemInputPrompt] = useState('');

  // Отладочная информация при монтировании компонента
  useEffect(() => {
    console.log('[ThinkingScreen] Монтирование с параметрами:', {
      gameId,
      userId,
      isAdmin,
      note: 'isAdmin будет определен через WebSocket сообщения, не через URL'
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
    lastSystemMessage, // Get system messages for role determination
    hasAdminMessage, // Get admin message flag
  } = useWebSocketGame(gameId, userId);

  // Определяем роль на основе последнего системного сообщения от WebSocket
  // Это более надежно, чем URL параметры, особенно при смене ролей после replayability
  const determineRoleFromMessage = React.useCallback((message: string | null) => {
    console.log('[ThinkingScreen] determineRoleFromMessage вызвана с сообщением:', message);
    
    if (!message) {
      console.log('[ThinkingScreen] determineRoleFromMessage: нет сообщения');
      return null;
    }
    
    // Сообщение админу имеет приоритет
    if (message.includes('Введите ситуацию')) {
      console.log('[ThinkingScreen] determineRoleFromMessage: найдено сообщение АДМИНА');
      return { isAdmin: true, prompt: 'Введите ситуацию' };
    }
    
    // Сообщение обычному игроку
    if (message.includes('Главный игрок вводит тему')) {
      console.log('[ThinkingScreen] determineRoleFromMessage: найдено сообщение НЕ-АДМИНА');
      return { isAdmin: false, prompt: 'Главный игрок вводит тему' };
    }
    
    console.log('[ThinkingScreen] determineRoleFromMessage: не найдено известных паттернов');
    return null;
  }, []);

  // Наблюдаем за изменениями lastSystemMessage для определения роли
  useEffect(() => {
    // Детальное отладочное логирование
    console.log('[ThinkingScreen] DEBUG - Статус игры:', gameStatus);
    console.log('[ThinkingScreen] DEBUG - Тема:', currentTheme); 
    console.log('[ThinkingScreen] DEBUG - Последнее системное сообщение:', lastSystemMessage);
    console.log('[ThinkingScreen] DEBUG - Флаг админ сообщения:', hasAdminMessage);
    console.log('[ThinkingScreen] DEBUG - Текущая роль isAdmin:', isAdmin);
    console.log('[ThinkingScreen] DEBUG - isAdmin из URL:', params.isAdmin);

    // Определяем роль на основе флага hasAdminMessage и lastSystemMessage
    let roleInfo = null;
    
    // Check for exact admin message first
    if (lastSystemMessage && lastSystemMessage.includes('Введите ситуацию')) {
      // Если получено сообщение админа, это админ
      roleInfo = { isAdmin: true, prompt: 'Введите ситуацию' };
      console.log('[ThinkingScreen] 🔑 Определена роль АДМИНА из сообщения: "Введите ситуацию"');
    } 
    // Use hasAdminMessage flag as backup admin detection
    else if (hasAdminMessage) {
      roleInfo = { isAdmin: true, prompt: 'Введите ситуацию' };
      console.log('[ThinkingScreen] 🔑 Определена роль АДМИНА из флага hasAdminMessage=true');
    } 
    // Message for regular player
    else if (lastSystemMessage && lastSystemMessage.includes('Главный игрок вводит тему')) {
      roleInfo = { isAdmin: false, prompt: 'Главный игрок вводит тему' };
      console.log('[ThinkingScreen] 🔑 Определена роль НЕ-АДМИНА из сообщения: "Главный игрок вводит тему"');
    }
    // Use URL param as a backup if no messages yet and status is MAIN_PLAYER_THINKING or THEME_INPUT
    else if ((gameStatus === 'MAIN_PLAYER_THINKING' || gameStatus === 'THEME_INPUT') && params.isAdmin === 'true' && !roleInfo) {
      roleInfo = { isAdmin: true, prompt: 'Введите ситуацию' };
      console.log('[ThinkingScreen] 🔑 Определена роль АДМИНА из URL параметра (резервный вариант)');
    }
    
    if (roleInfo) {
      console.log('[ThinkingScreen] DEBUG - Определена роль из сообщения:', roleInfo);
      
      // Обновляем состояние роли только если изменилось
      if (roleInfo.isAdmin !== isAdmin) {
        console.log('[ThinkingScreen] DEBUG - ИЗМЕНЕНИЕ РОЛИ с', isAdmin, 'на', roleInfo.isAdmin);
        setIsAdmin(roleInfo.isAdmin);
      }
      
      // Обновляем системный промпт
      console.log('[ThinkingScreen] DEBUG - Установка промпта:', roleInfo.prompt);
      setSystemInputPrompt(roleInfo.prompt);
    } else {
      console.log('[ThinkingScreen] DEBUG - НЕТ РОЛИ из сообщения. hasAdminMessage:', hasAdminMessage, 'lastSystemMessage:', lastSystemMessage);
      // Если роль не определена из сообщения, сохраняем текущий промпт
      console.log('[ThinkingScreen] DEBUG - Сохраняем текущий промпт:', systemInputPrompt);
    }
    
    // Получена тема - запомним её для всех игроков
    if (currentTheme && currentTheme.trim() !== '') {
      console.log('[ThinkingScreen] DEBUG - Получена тема:', currentTheme);
      setThemeText(currentTheme);
    }
  }, [gameStatus, currentTheme, lastSystemMessage, hasAdminMessage, isAdmin, systemInputPrompt]);

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
    // Log the current state for debugging
    console.log(`[ThinkingScreen] 📊 Navigation check - gameStatus: ${gameStatus}, isAdmin: ${isAdmin}, hasAdminMessage: ${hasAdminMessage}`);
    
    // Special handling for MAIN_PLAYER_THINKING when we're the admin
    if (gameStatus === 'MAIN_PLAYER_THINKING' && isAdmin) {
        console.log(`[ThinkingScreen] ✅ Admin user in MAIN_PLAYER_THINKING state - staying on this screen to input theme`);
        return; // Stay on this screen if admin during MAIN_PLAYER_THINKING
    }
    
    // Navigate away if status is no longer THEME_INPUT or if disconnected
    if (gameStatus !== 'THEME_INPUT' && gameStatus !== 'UNKNOWN') { // Allow UNKNOWN during initial load
        console.log(`ThinkingScreen: Navigating away due to status change: ${gameStatus}`);
        
        // Go back to lobby or appropriate screen if status regresses or advances unexpectedly
        if (gameStatus === 'WAITING_FOR_PLAYERS' || gameStatus === 'CLOSED') {
             router.replace({ pathname: '/lobby/[gameId]', params: { gameId, userId, isAdmin: isAdmin.toString() } });
        } else if (gameStatus === 'WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT') {
             // Navigate all users directly to answer screen when admin has selected a theme
             console.log(`[ThinkingScreen] 🚨 Status changed to WAITING_FOR_PLAYER_MESSAGE_AFTER_PROMPT - navigating DIRECTLY to answer.tsx`);
             console.log(`[ThinkingScreen] 📝 Theme text: "${themeText || currentTheme || 'undefined'}", isAdmin: ${isAdmin}`);
             
             // Use either local themeText (for admin) or currentTheme from WebSocket (for non-admin)
             const scenarioToPass = isAdmin ? themeText : currentTheme;
             
             // Add random query param to prevent stale navigation cache issues
             const randomParam = Date.now().toString();
             
             router.replace({ 
                 pathname: '/game/answer', 
                 params: { 
                     gameId, 
                     userId, 
                     isAdmin: isAdmin.toString(), 
                     scenario: scenarioToPass || '',  // Ensure we pass empty string if undefined
                     _: randomParam // Cache-busting parameter
                 } 
             });
        } 
        // Add other navigation cases if needed
    }
  }, [gameStatus, gameId, userId, isAdmin, themeText, currentTheme, hasAdminMessage]);

  // --- UI Rendering ---
  // Additional debug log right before render to confirm state
  console.log(`[ThinkingScreen] 🎨 Rendering UI with isAdmin=${isAdmin}, gameStatus=${gameStatus}, hasAdminMessage=${hasAdminMessage}`);
  
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