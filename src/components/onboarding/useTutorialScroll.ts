import { useCallback, useRef } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
export function useTutorialScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const offset = useRef(0);
  const reduced = useReducedMotion();
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; }, []);
  const reveal = useCallback((target: View) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.getNativeScrollRef()?.measureInWindow((_x, scrollY) => target.measureInWindow((_tx, targetY) => {
      scroll.scrollTo({ y: Math.max(0, offset.current + targetY - scrollY - 20), animated: !reduced });
    }));
  }, [reduced]);
  return { scrollRef, onScroll, reveal };
}
