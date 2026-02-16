import React from 'react';
import { View, ViewProps, ViewStyle, StyleProp, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBottomSafeInset, ANDROID_MIN_BOTTOM_INSET } from '../utils/safeArea';

interface BottomDockProps extends ViewProps {
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  minBottomInset?: number;
  maxBottomInset?: number;
  children?: React.ReactNode;
}

export function BottomDock({
  containerStyle,
  style,
  minBottomInset = ANDROID_MIN_BOTTOM_INSET,
  maxBottomInset,
  children,
  ...rest
}: BottomDockProps) {
  const insets = useSafeAreaInsets();
  // Never allow Android to render dock content under the OS navigation bar.
  const enforcedMinBottomInset =
    Platform.OS === 'android' ? Math.max(minBottomInset, ANDROID_MIN_BOTTOM_INSET) : minBottomInset;
  const safeBottomInset = getBottomSafeInset(insets.bottom, enforcedMinBottomInset);
  const cappedBottomInset =
    typeof maxBottomInset === 'number' ? Math.min(safeBottomInset, Math.max(maxBottomInset, 0)) : safeBottomInset;
  const dockBottomInset =
    Platform.OS === 'android' ? Math.max(cappedBottomInset, enforcedMinBottomInset) : cappedBottomInset;

  return (
    <View style={[styles.base, { paddingBottom: dockBottomInset }, containerStyle]} {...rest}>
      <View style={style}>{children}</View>
      {dockBottomInset > 0 ? (
        <View pointerEvents="none" style={[styles.safeInsetFill, { height: dockBottomInset }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
  },
  safeInsetFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
  },
});
