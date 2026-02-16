import React from 'react';
import { StyleSheet } from 'react-native';
import { FAB } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBottomSafeInset } from '../utils/safeArea';

type SafeFabProps = React.ComponentProps<typeof FAB> & {
  bottomOffset?: number;
  rightOffset?: number;
  leftOffset?: number;
};

export function SafeFab({ style, bottomOffset = 12, rightOffset = 16, leftOffset, ...rest }: SafeFabProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = getBottomSafeInset(insets.bottom) + bottomOffset;
  const horizontalPosition = typeof leftOffset === 'number' ? { left: leftOffset } : { right: rightOffset };

  return <FAB {...rest} style={[styles.base, horizontalPosition, { bottom: safeBottom }, style]} />;
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
  },
});
