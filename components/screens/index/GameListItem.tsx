import React, { memo } from 'react';
import { View, TouchableOpacity, Platform } from 'react-native';
import Animated, { Layout, FadeIn, FadeOut, LayoutAnimationConfig, FadeInUp, FadeOutDown, Easing } from 'react-native-reanimated';
import { Card, CardHeader, CardTitle, CardContent } from '~/components/ui/card';
import { Text } from '~/components/ui/text';

// Assuming Game type is defined elsewhere or we adapt to RoomCache directly if needed
// For now, keep the structure used in app/index.tsx
interface GameListItemDisplayData {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
}

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

interface GameListItemProps {
  item: GameListItemDisplayData; // Use the mapped data structure
  onPress: (gameId: string) => void;
  disabled?: boolean; // Add optional disabled prop
}

export const GameListItem = memo(function GameListItem({ item, onPress, disabled }: GameListItemProps) {
  return (
    <AnimatedTouchableOpacity
      layout={Layout.easing(Easing.inOut(Easing.quad)).duration(300)}
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      onPress={() => onPress(item.id)}
      className={`mb-3 ${disabled ? 'opacity-50' : ''}`} // Add opacity when disabled
      disabled={disabled} // Pass disabled prop to TouchableOpacity
    >
      <Card className='w-full'>
        <CardHeader>
          <CardTitle>{item.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <View className='flex-row items-center'>
            <Text>Players: </Text>
            {Platform.OS === 'ios' ? (
              // Static version for iOS to avoid artifacts
              <View className='w-6 items-center'>
                <Text className='font-semibold'>{item.playerCount}</Text>
              </View>
            ) : (
              // Animated version for Android
              <LayoutAnimationConfig skipEntering>
                <Animated.View key={item.playerCount} entering={FadeInUp} exiting={FadeOutDown} className='w-6 items-center'>
                  <Text className='font-semibold'>{item.playerCount}</Text>
                </Animated.View>
              </LayoutAnimationConfig>
            )}
            <Text> / {item.maxPlayers}</Text>
          </View>
        </CardContent>
      </Card>
    </AnimatedTouchableOpacity>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent unnecessary rerenders
  return prevProps.item.id === nextProps.item.id &&
         prevProps.item.playerCount === nextProps.item.playerCount &&
         prevProps.item.maxPlayers === nextProps.item.maxPlayers &&
         prevProps.disabled === nextProps.disabled;
});