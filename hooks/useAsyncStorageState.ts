import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A custom hook to manage state that persists in AsyncStorage.
 * It automatically retrieves the stored value on mount and saves updates.
 * Handles JSON serialization/deserialization.
 *
 * @param key The key under which the value is stored in AsyncStorage.
 * @param defaultValue The default value to use if nothing is stored yet.
 * @returns A state tuple [value, setValue] similar to useState.
 */
export function useAsyncStorageState<T>(
  key: string,
  defaultValue: T
): [T, (newValue: T) => Promise<void>] {
  const [state, setState] = useState<T>(defaultValue);

  // Effect to load the initial value from AsyncStorage
  useEffect(() => {
    let isActive = true;
    AsyncStorage.getItem(key)
      .then((storedValue) => {
        if (isActive && storedValue !== null) {
          try {
            setState(JSON.parse(storedValue));
          } catch (error) {
            console.error(`Error parsing AsyncStorage value for key "${key}":`, error);
            // Fallback to default value if parsing fails
            setState(defaultValue);
          }
        } else if (isActive) {
          // If no value is stored, initialize with default value
          setState(defaultValue);
        }
      })
      .catch((error) => {
        console.error(`Error reading AsyncStorage key "${key}":`, error);
        if (isActive) {
          setState(defaultValue); // Fallback to default on error
        }
      });

    return () => {
      isActive = false; // Prevent state update on unmounted component
    };
  }, [key, defaultValue]); // Rerun if key or defaultValue changes (though key changing is unusual)

  // Function to update the state and persist to AsyncStorage
  const updateState = useCallback(
    async (newValue: T) => {
      setState(newValue);
      try {
        const serializedValue = JSON.stringify(newValue);
        await AsyncStorage.setItem(key, serializedValue);
      } catch (error) {
        console.error(`Error setting AsyncStorage key "${key}":`, error);
      }
    },
    [key]
  );

  return [state, updateState];
}