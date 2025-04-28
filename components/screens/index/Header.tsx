import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';
import { Edit } from '~/lib/icons/Edit';

interface HeaderProps {
  nickname: string | null;
  onEditPress?: () => void;
}

export function Header({ nickname, onEditPress }: HeaderProps) {
  return (
    <View className='flex-row justify-between items-center mb-4 p-2 bg-card rounded-lg shadow'>
      <Text className='text-2xl font-bold text-card-foreground'>Envelope</Text>
      <View className='flex-row items-center'>
        <Text className='text-lg text-muted-foreground mr-2'>{nickname ? `Пользователь: ${nickname}` : 'Пользователь: Гость'}</Text>
        {onEditPress && (
          <TouchableOpacity onPress={onEditPress} className='p-1'>
            <Edit size={18} color="#888" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}