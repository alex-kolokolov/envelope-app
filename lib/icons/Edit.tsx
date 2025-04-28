import React from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface EditProps {
  size?: number;
  color?: string;
  className?: string;
}

export function Edit({ size = 24, color = 'gray', className }: EditProps) {
  return (
    <View className={className}>
      <Feather name="edit-2" size={size} color={color} />
    </View>
  );
}
