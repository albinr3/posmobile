import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, StyleSheet, View, useWindowDimensions, ScrollView } from 'react-native';
import { Button, IconButton, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import Animated, { FadeInDown, ReduceMotion, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { ui } from '../../theme/ui';
import { onboardingAnchor, type TargetRect } from './OnboardingTarget';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
export type GuideStep = { target: string; title: string; description: string; index: number; total: number; onNext?: () => void; allowScreenInteraction?: boolean };
export function OnboardingSpotlight({ step, onPostpone }: { step: GuideStep | null; onPostpone: () => void }) {
  const host = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [keyboardTop, setKeyboardTop] = useState(height);
  const [originY, setOriginY] = useState(0);
  const [cardHeight, setCardHeight] = useState(190);
  const reduced = useReducedMotion();
  const x = useSharedValue(0), y = useSharedValue(0), w = useSharedValue(0), h = useSharedValue(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(height));
    return () => { show.remove(); hide.remove(); };
  }, [height]);
  useEffect(() => {
    setRect(null);
    if (!step) return;
    let disposed = false, measuring = false;
    let revealed: ReturnType<typeof onboardingAnchor>;
    const update = async () => {
      if (disposed || measuring) return;
      const anchor = onboardingAnchor(step.target);
      if (!anchor) { setRect(null); return; }
      if (revealed !== anchor) { anchor.reveal(); revealed = anchor; }
      measuring = true;
      const target = await anchor.measure();
      if (!disposed && target && host.current) host.current.measureInWindow((hostX, hostY) => {
        if (disposed) return;
        setOriginY(hostY);
        const next = { x: Math.max(8, target.x - hostX - 6), y: target.y - hostY - 6, width: Math.min(width - 16, target.width + 12), height: target.height + 12 };
        if (next.y < insets.top || next.y + next.height > Math.min(height - insets.bottom, keyboardTop - hostY)) {
          setRect(null);
          if (!step.allowScreenInteraction) revealed = undefined;
          return;
        }
        setRect(previous => previous && Math.abs(previous.x - next.x) < 1 && Math.abs(previous.y - next.y) < 1 && previous.width === next.width && previous.height === next.height ? previous : next);
      });
      else if (!disposed) setRect(null);
      measuring = false;
    };
    void update();
    const interval = setInterval(() => { void update(); }, 120);
    AccessibilityInfo.announceForAccessibility(`${step.index} de ${step.total}. ${step.title}. ${step.description}`);
    return () => { disposed = true; clearInterval(interval); };
  }, [step?.target, width, height, keyboardTop, insets.top, insets.bottom]);
  useEffect(() => {
    if (!rect) return;
    const config = { duration: reduced ? 0 : 250 };
    x.value = withTiming(rect.x, config); y.value = withTiming(rect.y, config);
    w.value = withTiming(rect.width, config); h.value = withTiming(rect.height, config);
  }, [rect, reduced]);
  const animated = useAnimatedProps(() => ({ x: x.value, y: y.value, width: w.value, height: h.value }));
  if (!step) return null;
  const usableBottom = Math.min(height - insets.bottom - 12, keyboardTop - originY - 12);
  const aboveSpace = rect ? Math.max(0, rect.y - insets.top - 20) : 0;
  const belowSpace = rect ? Math.max(0, usableBottom - rect.y - rect.height - 12) : 0;
  const placeBelow = belowSpace >= cardHeight || belowSpace >= aboveSpace;
  // Con teclado abierto, compactar el coach y permitir scroll; nunca cubrir el input.
  const maximumCardHeight = rect ? Math.max(64, placeBelow ? belowSpace : aboveSpace) : Math.max(160, usableBottom - insets.top - 24);
  const top = rect ? (placeBelow ? rect.y + rect.height + 12 : Math.max(insets.top + 8, rect.y - Math.min(cardHeight, maximumCardHeight) - 12)) : Math.max(insets.top + 12, usableBottom - cardHeight - 12);
  return <Portal>
    <View ref={host} style={StyleSheet.absoluteFill} pointerEvents="box-none" collapsable={false}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs><Mask id="tutorial-spotlight"><Rect width={width} height={height} fill="white" />{rect && <AnimatedRect animatedProps={animated} rx={18} fill="black" />}</Mask></Defs>
        <Rect width={width} height={height} fill="#160D28" opacity={step.allowScreenInteraction ? 0.3 : 0.66} mask="url(#tutorial-spotlight)" />
        {rect && <AnimatedRect animatedProps={animated} rx={18} fill="none" stroke="#C9A7FF" strokeWidth={3} />}
      </Svg>
      {!step.allowScreenInteraction && (rect ? <>
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rect.y }} />
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: rect.y + rect.height, left: 0, right: 0, bottom: 0 }} />
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: rect.y, left: 0, width: rect.x, height: rect.height }} />
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: rect.y, left: rect.x + rect.width, right: 0, height: rect.height }} />
      </> : <View onStartShouldSetResponder={() => true} style={StyleSheet.absoluteFill} />)}
      <Animated.View key={step.target} entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)}
        onLayout={event => setCardHeight(event.nativeEvent.layout.height)}
        style={[styles.card, { top, left: 16, right: 16, maxHeight: maximumCardHeight }]}>
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={styles.top}><Text style={styles.eyebrow}>TUS PRIMEROS PASOS · {step.index}/{step.total}</Text><IconButton icon="close" size={18} accessibilityLabel="Posponer tutorial" onPress={onPostpone} style={styles.close} /></View>
          <Text accessibilityRole="header" style={styles.title}>{rect || step.allowScreenInteraction ? step.title : 'Preparando el siguiente paso'}</Text>
          <Text style={styles.body}>{rect || step.allowScreenInteraction ? step.description : 'Estamos ubicando el control en la pantalla. Puedes posponer y continuar más tarde.'}</Text>
          <View style={styles.progress}>{Array.from({ length: step.total }, (_, i) => <View key={i} style={[styles.segment, i < step.index && styles.segmentActive]} />)}</View>
          {step.onNext && rect && <Button mode="contained" buttonColor={ui.colors.primary} onPress={step.onNext}>Continuar</Button>}
          <Button compact textColor={ui.colors.textMuted} onPress={onPostpone}>Continuar después</Button>
        </ScrollView>
      </Animated.View>
    </View>
  </Portal>;
}
const styles = StyleSheet.create({
  card: { position: 'absolute', backgroundColor: '#fff', borderRadius: 24, padding: 20, elevation: 12, shadowColor: '#160D28', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  eyebrow: { color: ui.colors.primary, fontSize: 10, fontWeight: '800', flexShrink: 1, letterSpacing: 1 }, close: { margin: -6 },
  title: { fontSize: 21, fontWeight: '800', color: ui.colors.text, marginTop: 6 },
  body: { fontSize: 14, lineHeight: 21, color: ui.colors.textMuted, marginTop: 8 },
  progress: { flexDirection: 'row', gap: 4, marginVertical: 16 }, segment: { flex: 1, height: 4, borderRadius: 4, backgroundColor: ui.colors.border }, segmentActive: { backgroundColor: ui.colors.primary },
});
