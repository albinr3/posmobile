import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, StyleSheet, View, useWindowDimensions, ScrollView } from 'react-native';
import { Button, IconButton, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import Animated, { FadeInDown, ReduceMotion, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { ui } from '../../theme/ui';
import { onboardingAnchor, type TargetRect } from './OnboardingTarget';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
async function measureAnchor(anchor: NonNullable<ReturnType<typeof onboardingAnchor>>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      anchor.measure(),
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 800); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type GuideStep = {
  target: string;
  title: string;
  description: string;
  index: number;
  total: number;
  onNext?: () => void;
  nextLabel?: string;
  onRecover?: () => void;
  allowScreenInteraction?: boolean;
  placement?: 'above' | 'below';
};

export function OnboardingSpotlight({ step, onPostpone }: { step: GuideStep | null; onPostpone: () => void }) {
  const host = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [keyboardTop, setKeyboardTop] = useState(height);
  const [originY, setOriginY] = useState(0);
  const [cardHeight, setCardHeight] = useState(220);
  const [missingTarget, setMissingTarget] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const reduced = useReducedMotion();
  const x = useSharedValue(0), y = useSharedValue(0), w = useSharedValue(0), h = useSharedValue(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(height));
    return () => { show.remove(); hide.remove(); };
  }, [height]);

  useEffect(() => { setExpanded(true); }, [step?.target]);

  useEffect(() => {
    setRect(null);
    setMissingTarget(false);
    if (!step) return;
    let disposed = false, measuring = false;
    let revealed: ReturnType<typeof onboardingAnchor>;
    let lastFoundAt = Date.now();
    const update = async () => {
      if (disposed || measuring) return;
      const anchor = onboardingAnchor(step.target);
      const missing = () => {
        if (disposed) return;
        setRect(null);
        setMissingTarget(Date.now() - lastFoundAt >= 1800);
      };
      if (!anchor || !host.current) { missing(); return; }
      if (revealed !== anchor) { anchor.reveal(); revealed = anchor; }
      measuring = true;
      try {
        const target = await measureAnchor(anchor);
        if (disposed) return;
        if (!target || !host.current) { missing(); return; }
        host.current.measureInWindow((hostX, hostY) => {
          if (disposed) return;
          setOriginY(hostY);
          const left = Math.max(8, target.x - hostX - 6);
          const right = Math.min(width - 8, target.x - hostX + target.width + 6);
          const next = { x: left, y: target.y - hostY - 6, width: right - left, height: target.height + 12 };
          if (next.width <= 0 || next.y < insets.top - hostY || next.y + next.height > Math.min(height - insets.bottom, keyboardTop) - hostY) {
            missing();
            return;
          }
          lastFoundAt = Date.now();
          setMissingTarget(false);
          setRect(previous => previous && Math.abs(previous.x - next.x) < 1 && Math.abs(previous.y - next.y) < 1 && previous.width === next.width && previous.height === next.height ? previous : next);
        });
      } catch {
        missing();
      } finally {
        measuring = false;
      }
    };
    void update();
    const interval = setInterval(() => { void update(); }, 240);
    return () => { disposed = true; clearInterval(interval); };
  }, [step?.target, retry, width, height, keyboardTop, insets.top, insets.bottom]);

  useEffect(() => {
    if (step) AccessibilityInfo.announceForAccessibility(`${step.index} de ${step.total}. ${step.title}. ${step.description}`);
  }, [step?.target, step?.title, step?.description, step?.index, step?.total]);

  useEffect(() => {
    if (!rect) return;
    const config = { duration: reduced ? 0 : 200 };
    x.value = withTiming(rect.x, config); y.value = withTiming(rect.y, config);
    w.value = withTiming(rect.width, config); h.value = withTiming(rect.height, config);
  }, [rect, reduced]);
  const animated = useAnimatedProps(() => ({ x: x.value, y: y.value, width: w.value, height: h.value }));
  if (!step) return null;

  const safeTop = Math.max(8, insets.top - originY + 8);
  const usableBottom = Math.min(height - insets.bottom, keyboardTop) - originY - 12;
  const aboveSpace = rect ? Math.max(0, rect.y - safeTop - 12) : 0;
  const belowSpace = rect ? Math.max(0, usableBottom - rect.y - rect.height - 12) : 0;
  const placeBelow = step.placement === 'above' && aboveSpace >= 120 ? false
    : step.placement === 'below' && belowSpace >= 120 ? true
    : belowSpace >= cardHeight || belowSpace >= aboveSpace;
  const availableSpace = rect ? (placeBelow ? belowSpace : aboveSpace) : Math.max(120, usableBottom - safeTop);
  // Con poco espacio, el texto se desplaza y el control real sigue recibiendo el toque.
  const maximumCardHeight = Math.min(360, Math.max(64, availableSpace));
  const top = rect
    ? placeBelow ? rect.y + rect.height + 12 : Math.max(safeTop, rect.y - Math.min(cardHeight, maximumCardHeight) - 12)
    : Math.max(safeTop, usableBottom - Math.min(cardHeight, maximumCardHeight));
  const retryTarget = () => {
    Keyboard.dismiss();
    step.onRecover?.();
    onboardingAnchor(step.target)?.reveal();
    setRetry(value => value + 1);
  };

  return <Portal>
    <View ref={host} style={StyleSheet.absoluteFill} pointerEvents="box-none" collapsable={false}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs><Mask id="tutorial-spotlight"><Rect width={width} height={height} fill="white" />{rect && <AnimatedRect animatedProps={animated} rx={18} fill="black" />}</Mask></Defs>
        <Rect width={width} height={height} fill="#160D28" opacity={step.allowScreenInteraction || !rect ? 0.18 : 0.66} mask="url(#tutorial-spotlight)" />
        {rect && <AnimatedRect animatedProps={animated} rx={18} fill="none" stroke="#C9A7FF" strokeWidth={3} />}
      </Svg>
      {!step.allowScreenInteraction && rect && <>
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rect.y }} />
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: rect.y + rect.height, left: 0, right: 0, bottom: 0 }} />
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: rect.y, left: 0, width: rect.x, height: rect.height }} />
        <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', top: rect.y, left: rect.x + rect.width, right: 0, height: rect.height }} />
      </>}
      <Animated.View key={step.target} entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)}
        onLayout={event => setCardHeight(event.nativeEvent.layout.height)}
        style={[styles.card, { top, left: 16, right: 16, maxHeight: maximumCardHeight }]}>
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={styles.top}>
            <Text style={styles.eyebrow}>TUS PRIMEROS PASOS · {step.index}/{step.total}</Text>
            <View style={styles.actions}>
              {step.allowScreenInteraction && <IconButton icon={expanded ? 'chevron-up' : 'chevron-down'} size={20}
                accessibilityLabel={expanded ? 'Reducir indicaciones del tutorial' : 'Mostrar indicaciones del tutorial'}
                accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.close} />}
              <IconButton icon="close" size={18} accessibilityLabel="Posponer tutorial" onPress={onPostpone} style={styles.close} />
            </View>
          </View>
          <Text accessibilityRole="header" style={[styles.title, !expanded && styles.compactTitle]}>{step.title}</Text>
          {(expanded || missingTarget) && <>
            <Text style={styles.body}>{step.description}</Text>
            {missingTarget && <View style={styles.recovery}>
              <Text accessibilityRole="alert" style={styles.recoveryText}>No encontramos este control en la pantalla. Puedes buscarlo o volver a mostrar este paso.</Text>
              <Button compact mode="outlined" onPress={retryTarget}>Volver a mostrar el control</Button>
            </View>}
            <View style={styles.progress}>{Array.from({ length: step.total }, (_, i) => <View key={i} style={[styles.segment, i < step.index && styles.segmentActive]} />)}</View>
            {step.onNext && rect && <Button mode="contained" buttonColor={ui.colors.primary} onPress={step.onNext}>{step.nextLabel ?? 'Continuar'}</Button>}
            <Button compact textColor={ui.colors.textMuted} onPress={onPostpone}>Continuar después</Button>
          </>}
        </ScrollView>
      </Animated.View>
    </View>
  </Portal>;
}

const styles = StyleSheet.create({
  card: { position: 'absolute', backgroundColor: '#fff', borderRadius: 24, padding: 16, elevation: 12, shadowColor: '#160D28', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { color: ui.colors.primary, fontSize: 10, fontWeight: '800', flexShrink: 1, letterSpacing: 1 }, close: { margin: -6 },
  title: { fontSize: 21, fontWeight: '800', color: ui.colors.text, marginTop: 6 }, compactTitle: { fontSize: 17, marginTop: 4 },
  body: { fontSize: 14, lineHeight: 21, color: ui.colors.textMuted, marginTop: 8 },
  recovery: { gap: 10, marginTop: 12 }, recoveryText: { fontSize: 12, lineHeight: 18, color: ui.colors.textMuted },
  progress: { flexDirection: 'row', gap: 4, marginVertical: 16 }, segment: { flex: 1, height: 4, borderRadius: 4, backgroundColor: ui.colors.border }, segmentActive: { backgroundColor: ui.colors.primary },
});
