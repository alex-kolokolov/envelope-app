import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Alert, ActivityIndicator, Platform } from 'react-native';
import { router } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { useNickname } from '~/hooks/useNickname';
import { useGamesList } from '~/hooks/useGamesList';
// Import connectToOpenedGame, RoomCache, and getRoomsSummary
import { RoomCache, connectToOpenedGame, getRoomsSummary, RoomSummary } from '~/lib/api/client';
import { Header } from '~/components/screens/index/Header';
import { GameListItem } from '~/components/screens/index/GameListItem';
import { NicknameModal } from '~/components/screens/index/NicknameModal';
// @ts-ignore: no type declarations for flash-list
import { FlashList } from '@shopify/flash-list';

export default function AvailableGamesScreen() {
  const [nickname, setNickname] = useNickname();
  const [isNicknameModalVisible, setNicknameModalVisible] = useState(false);
  const { games, isLoading: isLoadingList, error: listError, refreshGames } = useGamesList(); // Renamed isLoading
  const [tempNickname, setTempNickname] = useState('');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false); // Loading state for connecting
  const [isEditingNickname, setIsEditingNickname] = useState(false); // New state for editing mode
  const [roomSummaries, setRoomSummaries] = useState<Record<string, RoomSummary>>({});
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false);

  const handleGamePress = useCallback(async (gameId: string) => {
    if (nickname) {
      setIsConnecting(true); // Start loading indicator for connection attempt
      try {
        // Attempt to connect to the game via API
        const connectResult = await connectToOpenedGame(gameId, nickname);
        setIsConnecting(false); // Stop loading

        // Navigate to lobby on successful connection
        router.push({
          pathname: '/lobby/[gameId]',
          params: {
            gameId: connectResult.roomId,
            userId: connectResult.userId, // Pass userId from connection result
            isAdmin: connectResult.admin.toString() // Pass admin status (likely false)
          },
        });

      } catch (error) {
        setIsConnecting(false); // Stop loading on error
        console.error('Failed to connect to game:', error);
        Alert.alert('Ошибка подключения', `Не удалось подключиться к игре. ${error instanceof Error ? error.message : 'Пожалуйста, попробуйте снова.'}`);
      }
    } else {
      // Prompt for nickname if not set
      setSelectedGameId(gameId);
      setTempNickname('');
      setIsEditingNickname(false);
      setNicknameModalVisible(true);
    }
  }, [nickname]); // Added connectToOpenedGame dependency

  // Handle edit nickname button press
  const handleEditNicknamePress = useCallback(() => {
    setTempNickname(nickname || '');
    setIsEditingNickname(true);
    setNicknameModalVisible(true);
  }, [nickname]);

  // Refresh function that fetches both games and summaries
  const refreshAll = useCallback(async () => {
    await refreshGames();
    try {
      setIsLoadingSummaries(true);
      const summaries = await getRoomsSummary();
      setRoomSummaries(summaries);
    } catch (error) {
      console.error('Failed to refresh room summaries:', error);
    } finally {
      setIsLoadingSummaries(false);
    }
  }, [refreshGames]);

  const handleSaveNickname = useCallback(async () => {
    if (tempNickname.trim().length <= 16) {
      await setNickname(tempNickname.trim());
      setNicknameModalVisible(false);
      
      // Only attempt to connect to game if we're not in editing mode
      if (selectedGameId && !isEditingNickname) {
        // After saving nickname, attempt to connect to the selected game
        await handleGamePress(selectedGameId); // Re-call handleGamePress with the now-set nickname
        setSelectedGameId(null); // Reset selected game
      }
      
      // Reset editing mode
      setIsEditingNickname(false);
    } else {
      Alert.alert('Недопустимое имя', 'Имя должно быть не более 16 символов.');
    }
  }, [tempNickname, setNickname, selectedGameId, handleGamePress, isEditingNickname]); // Added isEditingNickname dependency

  const handleCloseModal = useCallback(() => {
    setNicknameModalVisible(false);
    setSelectedGameId(null);
    setIsEditingNickname(false);
  }, []);

  const handleCreateGamePress = useCallback(() => {
     if (!nickname) {
       Alert.alert("Требуется имя", "Пожалуйста, установите имя перед созданием игры.", [
         { text: "OK", onPress: () => {
             setTempNickname('');
             setIsEditingNickname(false);
             setNicknameModalVisible(true);
           }
         }
       ]);
     } else {
       router.push('/create-game');
     }
  }, [nickname]);

  // Fetch room summaries when games list changes
  useEffect(() => {
    const fetchRoomSummaries = async () => {
      if (games.length === 0) return;
      
      setIsLoadingSummaries(true);
      try {
        const summaries = await getRoomsSummary();
        setRoomSummaries(summaries);
      } catch (error) {
        console.error('Failed to fetch room summaries:', error);
      } finally {
        setIsLoadingSummaries(false);
      }
    };
    
    fetchRoomSummaries();
  }, [games]);

  // Memoize item data preparation to prevent unnecessary object creation on render
  const getItemData = useCallback((item: RoomCache) => {
    // Get admin name from room summaries if available
    const adminName = roomSummaries[item.id]?.admin || null;
    
    return {
      id: item.id,
      name: adminName ? `Комната "${adminName}"` : `Комната ${item.id.substring(0, 6)}...`,
      playerCount: item.players?.length ?? 0,
      maxPlayers: item.capacity,
    };
  }, [roomSummaries]);

  // Optimize renderItem with useCallback to prevent recreation on each render
  const renderGameItem = useCallback(({ item }: { item: RoomCache }) => {
    const gameListItemData = getItemData(item);
    // Disable button while connecting
    return <GameListItem item={gameListItemData} onPress={handleGamePress} disabled={isConnecting} />;
  }, [handleGamePress, isConnecting, getItemData]); // Added isConnecting dependency

  const ListContent = () => {
    // Show list loading indicator OR connection indicator OR summaries loading
    if (isLoadingList || isConnecting || isLoadingSummaries) {
      return <ActivityIndicator size="large" color="#0000ff" className="mt-10" />;
    }
    if (listError) {
      return (
        <View className='items-center mt-10'>
          <Text className='text-destructive mb-4'>Ошибка загрузки игр: {listError.message}</Text>
          <Button onPress={refreshGames} variant='outline'>
            <Text>Повторить</Text>
          </Button>
        </View>
      );
    }
    return (
      <FlashList
        data={games}
        renderItem={renderGameItem}
        keyExtractor={(item) => item.id}
        estimatedItemSize={80}
        contentContainerClassName='pb-4'
        ListEmptyComponent={<Text className='text-center text-muted-foreground mt-10'>Не найдено доступных игр.</Text>}
        refreshing={isLoadingList || isLoadingSummaries}
        onRefresh={refreshAll}
        // Optimize for iOS to prevent rerendering artifacts
        removeClippedSubviews={Platform.OS === 'ios'}
        // Maintain scroll position when data changes
        maintainVisibleContentPosition={{
          minIndexForVisible: 0
        }}
      />
    );
  };


  return (
    <View className='flex-1 bg-background'>
      <Header nickname={nickname} onEditPress={handleEditNicknamePress} />
      <View className='my-4'>
        {/* Disable create button while connecting to another game */}
        <Button onPress={handleCreateGamePress} size='lg' disabled={isConnecting}>
          <Text>Создать новую игру</Text>
        </Button>
      </View>

      <Text className='text-xl font-semibold mb-2 text-foreground'>Доступные игры</Text>

      <ListContent />

      <NicknameModal
        isVisible={isNicknameModalVisible}
        onClose={handleCloseModal}
        onSave={handleSaveNickname}
        tempNickname={tempNickname}
        setTempNickname={setTempNickname}
        isEditing={isEditingNickname}
      />
    </View>
  );
}
