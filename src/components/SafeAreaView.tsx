import React from 'react';
import { View, ViewProps, StyleProp, ViewStyle, Platform, StatusBar } from 'react-native';
import { Edge, useSafeAreaInsets } from 'react-native-safe-area-context';

interface SafeAreaViewProps extends ViewProps {
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const ALL_EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];

export function SafeAreaView({ edges = ALL_EDGES, style, children, ...rest }: SafeAreaViewProps) {
  const insets = useSafeAreaInsets();
  const androidStatusBarHeight = Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
  const topInset = edges.includes('top') ? (insets.top > 0 ? insets.top : androidStatusBarHeight) : 0;
  const bottomInset = edges.includes('bottom')
    ? Platform.OS === 'android'
      ? Math.max(insets.bottom, 12)
      : insets.bottom
    : 0;

  const insetStyle: ViewStyle = {
    paddingTop: topInset,
    paddingRight: edges.includes('right') ? insets.right : 0,
    paddingBottom: bottomInset,
    paddingLeft: edges.includes('left') ? insets.left : 0,
  };

  return (
    <View style={[insetStyle, style]} {...rest}>
      {children}
    </View>
  );
}
