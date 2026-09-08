import { useSyncExternalStore } from 'react';
import { getLanguageSnapshot, getLocale, subscribeLocale } from './locale';

export function useLocale() {
  useSyncExternalStore(subscribeLocale, getLanguageSnapshot);
  return getLocale();
}
