import React, { useState, useCallback } from 'react';
import { View, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { Stack, router } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { useNickname } from '~/hooks/useNickname'; // Import useNickname
import { createGame } from '~/lib/api/client'; // Import createGame API function

export default function CreateGameScreen() {
  const [nickname] = useNickname(); // Get the user's nickname
  const [maxPlayers, setMaxPlayers] = useState('4'); // Default capacity
  const [isLoading, setIsLoading] = useState(false); // Loading state for API call

  const handleCreateGame = useCallback(async () => {
    if (!nickname) {
      Alert.alert('Требуется никнейм', 'Пожалуйста, установите никнейм перед созданием игры. Вы можете установить его на основном экране.');
      // Optionally navigate back or show a modal to set nickname
      // router.back();
      return;
    }

    const parsedMaxPlayers = parseInt(maxPlayers, 10);

    if (isNaN(parsedMaxPlayers) || parsedMaxPlayers < 1 || parsedMaxPlayers > 10) {
      Alert.alert('Некорректный ввод', 'Максимальное количество игроков должно быть числом от 1 до 10.');
      return;
    }

    setIsLoading(true);
    try {
      // Call the API to create the game
      const result = await createGame(nickname, parsedMaxPlayers);

      // Navigate to the lobby of the newly created game
      // Pass necessary info like roomId and userId (which might be needed for WS connection)
      router.replace({ // Use replace to prevent going back to the create screen
        pathname: '/lobby/[gameId]',
        params: {
          gameId: result.roomId,
          userId: result.userId, // Pass userId obtained from creation
          isAdmin: 'true' // Mark this user as admin
         },
      });

    } catch (error) {
      console.error('Failed to create game:', error);
      Alert.alert('Ошибка', `Не удалось создать игру. ${error instanceof Error ? error.message : 'Пожалуйста, попробуйте снова.'}`);
      setIsLoading(false); // Ensure loading is turned off on error
    }
    // No need to set isLoading to false on success because we are navigating away
  }, [nickname, maxPlayers]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className='flex-1 bg-background p-4 justify-center'
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <Stack.Screen options={{ title: 'Создать новую игру' }} />

      <View className='w-full max-w-md mx-auto'>
        <Text className='text-2xl font-bold text-center mb-6 text-foreground'>
          Настройте свою игру
        </Text>

        {/* Removed Game Name input */}

        <View className='mb-6'>
          <Text className='text-base font-medium text-muted-foreground mb-1 native:pb-1'>Максимальное количество игроков (1-10)</Text>
          <TextInput
            placeholder='Например, 4'
            placeholderTextColor={'#999'}
            value={maxPlayers}
            onChangeText={setMaxPlayers}
            className='border border-border rounded p-3 text-foreground bg-input text-base native:py-3' // Adjusted padding
            keyboardType='number-pad'
            editable={!isLoading} // Disable input while loading
          />
        </View>

        {/* Removed Number of Rounds input */}

        <Button onPress={handleCreateGame} size='lg' disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text>Создать игру</Text>
          )}
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}