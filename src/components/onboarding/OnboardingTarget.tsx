import React, { useEffect, useRef, type PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export type TargetRect = { x: number; y: number; width: number; height: number };
type Anchor = { measure: () => Promise<TargetRect | null>; reveal: () => void };
const anchors = new Map<string, Anchor>();
export function onboardingAnchor(id: string) { return anchors.get(id); }
export function OnboardingTarget({ id, children, style, reveal, persistent = false, visible = true }: PropsWithChildren<{
  id: string; style?: StyleProp<ViewStyle>; reveal?: (view: View) => void; persistent?: boolean; visible?: boolean;
}>) {
  const ref = useRef<View>(null);
  const focused = useIsFocused();
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    // Las pestañas siguen siendo pulsables desde otra pantalla; su foco no indica visibilidad.
    if (!visible || (!persistent && !focused)) return;
    const anchor: Anchor = {
      measure: () => new Promise(resolve => {
        if (!ref.current) return resolve(null);
        ref.current.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
      }),
      reveal: () => { if (ref.current) revealRef.current?.(ref.current); },
    };
    anchors.set(id, anchor);
    return () => { if (anchors.get(id) === anchor) anchors.delete(id); };
  }, [focused, id, persistent, visible]);
  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}
