import React, { useEffect } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Portal, Text } from 'react-native-paper';
import Animated, { Easing, FadeInDown, ReduceMotion, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ui } from '../../theme/ui';

type TutorialCelebrationProps = {
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  completed?: boolean;
  loading?: boolean;
  error?: string | null;
};

const CONFETTI_COLORS = ['#7F13EC', '#1FA464', '#E5AD22', '#A56CFF', '#EF7DA7'];

function ConfettiPiece({ index }: { index: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay((index % 4) * 45, withTiming(1, { duration: 1500 + (index % 3) * 180, easing: Easing.out(Easing.quad) }));
  }, [index, progress]);
  const style = useAnimatedStyle(() => {
    const direction = index % 2 ? 1 : -1;
    const distance = 42 + (index % 8) * 13;
    return {
      opacity: interpolate(progress.value, [0, 0.1, 0.7, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: direction * distance * progress.value },
        { translateY: -Math.sin(progress.value * Math.PI) * (45 + (index % 5) * 15) + progress.value * 80 },
        { rotate: `${direction * progress.value * (180 + index * 22)}deg` },
      ],
    };
  });
  return <Animated.View style={[styles.confetti, { backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length], borderRadius: index % 3 === 0 ? 6 : 1 }, style]} />;
}

export function TutorialCelebration({ title, description, primaryLabel, onPrimary, secondaryLabel, onSecondary, completed = false, loading = false, error }: TutorialCelebrationProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0.7);
  useEffect(() => {
    scale.value = withTiming(1, { duration: reduced ? 0 : 650, easing: Easing.out(Easing.back(1.7)) });
    AccessibilityInfo.announceForAccessibility(`${title}. ${description}`);
  }, [title, description, reduced, scale]);
  const heroStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Portal>
    <View style={[styles.scrim, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
      <Animated.View entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)} style={styles.modal}>
        <ScrollView bounces={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.celebration} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
            <Animated.View style={[styles.hero, heroStyle]}><Icon source="check-bold" size={58} color={ui.colors.success} /></Animated.View>
            {!reduced && Array.from({ length: 20 }, (_, index) => <ConfettiPiece key={index} index={index} />)}
          </View>
          <Text style={styles.eyebrow}>{completed ? 'TUTORIAL COMPLETADO' : 'PRIMERA VENTA COMPLETADA'}</Text>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.body}>{description}</Text>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Button mode="contained" buttonColor={ui.colors.primary} loading={loading} disabled={loading} onPress={onPrimary} contentStyle={styles.buttonContent}>{primaryLabel}</Button>
          {!!secondaryLabel && !!onSecondary && <Button textColor={ui.colors.textMuted} disabled={loading} onPress={onSecondary}>{secondaryLabel}</Button>}
        </ScrollView>
      </Animated.View>
    </View>
  </Portal>;
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(22,13,40,0.68)', paddingHorizontal: 22, justifyContent: 'center' },
  modal: { maxHeight: '100%', backgroundColor: '#fff', borderRadius: 28, overflow: 'hidden', elevation: 16 },
  content: { padding: 26, gap: 16 },
  celebration: { height: 145, alignItems: 'center', justifyContent: 'center' },
  hero: { width: 106, height: 106, borderRadius: 53, backgroundColor: '#E5F7ED', alignItems: 'center', justifyContent: 'center' },
  confetti: { position: 'absolute', left: '50%', top: 64, width: 8, height: 12 },
  eyebrow: { color: ui.colors.primary, textAlign: 'center', fontWeight: '800', fontSize: 10, letterSpacing: 1.5 },
  title: { color: ui.colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  body: { color: ui.colors.textMuted, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  buttonContent: { minHeight: 52 }, error: { color: ui.colors.danger, fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
