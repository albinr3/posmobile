import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from 'react-native-paper';
import { useSyncStore } from '../store/syncStore';

export function NetworkToast() {
  const isOnline = useSyncStore((state) => state.isOnline);
  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(-150)).current;
  const insets = useSafeAreaInsets();

  const prevIsOnline = useRef(isOnline);

  useEffect(() => {
    if (!prevIsOnline.current && isOnline) {
      showToast();
    }
    prevIsOnline.current = isOnline;
  }, [isOnline]);

  const showToast = () => {
    setVisible(true);
    
    Animated.spring(translateY, {
      toValue: insets.top > 0 ? insets.top + 10 : 30,
      useNativeDriver: true,
      speed: 12,
      bounciness: 8,
    }).start();

    setTimeout(() => {
      Animated.timing(translateY, {
        toValue: -150,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
      });
    }, 3000);
  };

  if (!visible) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View style={[styles.toastWrapper, { transform: [{ translateY }] }]}>
        <View style={styles.toast}>
          <Icon source="wifi-check" size={20} color="#fff" />
          <Text style={styles.text}>Conectado a internet</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999999,
    alignItems: 'center',
  },
  toastWrapper: {
    position: 'absolute',
    top: 0,
    ...Platform.select({
      android: {
        elevation: 10,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
    }),
  },
  toast: {
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
