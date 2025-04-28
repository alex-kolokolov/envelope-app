import React from 'react';
import { Modal, View, TextInput, Alert, Text as RNText } from 'react-native';
import { Text } from '~/components/ui/text';
import { Button } from '~/components/ui/button';

interface NicknameModalProps {
  isVisible: boolean;
  onClose: () => void;
  onSave: () => void;
  tempNickname: string;
  setTempNickname: (text: string) => void;
  isEditing?: boolean;
}

export function NicknameModal({
  isVisible,
  onClose,
  onSave,
  tempNickname,
  setTempNickname,
  isEditing = false,
}: NicknameModalProps) {
  // Handle text change with character limit
  const handleTextChange = (text: string) => {
    // Limit the nickname to 16 characters
    if (text.length <= 16) {
      setTempNickname(text);
    }
  };

  return (
    <Modal
      animationType='slide'
      transparent={true}
      visible={isVisible}
      onRequestClose={onClose}
    >
      <View className='flex-1 justify-center items-center bg-black/50 p-5'>
        <View className='w-full max-w-sm bg-card rounded-lg p-6 shadow-lg'>
          <Text className='text-lg font-semibold mb-4 text-card-foreground'>
            {isEditing ? 'Редактировать никнейм' : 'Введите свой никнейм'}
          </Text>
          <TextInput
            placeholder='Никнейм'
            placeholderTextColor={'#999'} // Use a specific color that works in both themes
            value={tempNickname}
            onChangeText={handleTextChange}
            className='border border-border rounded p-2 mb-1 text-card-foreground bg-background' // Ensure input is visible
            autoCapitalize='none'
            maxLength={16} // Additional restriction
          />
          <RNText className='text-xs text-muted-foreground mb-4 text-right'>{tempNickname.length}/16</RNText>
          <View className='flex-row justify-end gap-2'>
            <Button
              variant='outline'
              onPress={onClose}
            >
              <Text>Отмена</Text>
            </Button>
            <Button onPress={onSave}>
              <Text>{isEditing ? 'Сохранить' : 'Сохранить и присоединиться'}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}