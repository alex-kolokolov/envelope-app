import React from 'react';
import { View, TouchableOpacity, ScrollView } from 'react-native';
import { Card, CardHeader, CardTitle, CardContent } from '~/components/ui/card';
import { Text } from '~/components/ui/text';

// Интерфейсы остаются теми же
interface GameListItemDisplayData {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
}

interface GameListProps {
  data: GameListItemDisplayData[];
  onGamePress: (gameId: string) => void;
  disabledGames?: string[];
}

// Компонент элемента списка (можно вынести отдельно или оставить внутри)
function GameListItem({ item, onGamePress, isDisabled }: {
  item: GameListItemDisplayData;
  onGamePress: (gameId: string) => void;
  isDisabled: boolean;
}) {
  return (
    // Используем обычный View для корректного удаления элементов
    <TouchableOpacity
      onPress={() => onGamePress(item.id)}
      className={`mb-3 ${isDisabled ? 'opacity-50' : ''}`}
      disabled={isDisabled}
    >
      <Card className='w-full'>
        <CardHeader>
          <CardTitle>{item.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <View className='flex-row items-center'>
            <Text>Players: </Text>
            // Removed reanimated animations to prevent overlay artifacts
            <View key={item.playerCount} className='w-6 items-center'>
              <Text className='font-semibold'>{item.playerCount}</Text>
            </View>
            <Text> / {item.maxPlayers}</Text>
          </View>
        </CardContent>
      </Card>
    </TouchableOpacity>
  );
}

// Основной компонент списка
export function GameList({ data, onGamePress, disabledGames = [] }: GameListProps) {

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
      {data.map(item => {
        const isDisabled = disabledGames.includes(item.id);
        return (
          <GameListItem
            key={item.id}
            item={item}
            onGamePress={onGamePress}
            isDisabled={isDisabled}
          />
        );
      })}
    </ScrollView>
  );
}
