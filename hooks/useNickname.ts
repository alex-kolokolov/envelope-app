import { useAsyncStorageState } from './useAsyncStorageState';

const NICKNAME_STORAGE_KEY = 'userNickname';

/**
 * Custom hook to manage the user's nickname stored in AsyncStorage.
 *
 * @returns A tuple containing the current nickname (string | null) and a function to update it.
 */
export function useNickname(): [
  string | null,
  (newNickname: string | null) => Promise<void>
] {
  return useAsyncStorageState<string | null>(NICKNAME_STORAGE_KEY, null);
}