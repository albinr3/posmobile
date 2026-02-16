import { Platform } from 'react-native';

export const ANDROID_MIN_BOTTOM_INSET = 24;

export function getBottomSafeInset(rawBottomInset: number, minBottomInset: number = ANDROID_MIN_BOTTOM_INSET) {
  if (Platform.OS !== 'android') return rawBottomInset;
  return Math.max(rawBottomInset, minBottomInset);
}

