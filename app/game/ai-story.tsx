import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Text } from '~/components/ui/text';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button'; // Keep button for manual navigation for now

export default function AiStoryScreen() {
  const { scenario, answerText } = useLocalSearchParams<{ scenario?: string, answerText?: string }>();

  // Placeholder for AI story generation logic
  const aiStory = `Based on your response "${answerText}" to the situation "${scenario}", the AI is crafting the next part of your story... [AI Story Placeholder]`;

  // Simulate loading and navigate automatically after a delay
  // In a real scenario, this would navigate after the AI response is received
  useEffect(() => {
    const timer = setTimeout(() => {
      // Pass necessary data to the thinking screen
      router.push({ pathname: '/game/thinking', params: { scenario, answerText, aiStory } });
    }, 3000); // Simulate 3 seconds delay for AI generation

    return () => clearTimeout(timer); // Cleanup timer on unmount
  }, [scenario, answerText, aiStory]); // Add dependencies

  const handleContinue = () => {
     // Manual navigation in case automatic fails or for testing
     router.push({ pathname: '/game/thinking', params: { scenario, answerText, aiStory } });
  };


  return (
    <View className='flex-1 bg-background p-4 justify-center items-center'>
      <Stack.Screen options={{ title: 'AI Story Unfolds' }} />

      <Card className='w-full max-w-md mb-6 bg-secondary'>
        <CardHeader>
          <CardTitle className='text-secondary-foreground'>The Story Continues...</CardTitle>
        </CardHeader>
        <CardContent>
          <Text className='text-base text-secondary-foreground mb-4'>
            {aiStory}
          </Text>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text className='text-center text-secondary-foreground mt-2'>Generating outcome...</Text>
        </CardContent>
      </Card>

       {/* Keep a manual button for now during development */}
       <Button onPress={handleContinue} className='mt-4'>
         <Text>Continue (Manual)</Text>
       </Button>
    </View>
  );
}