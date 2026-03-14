import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ui } from '../theme/ui';

type OtaUpdateBannerStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface OtaUpdateBannerProps {
  visible: boolean;
  status: OtaUpdateBannerStatus;
  errorMessage?: string | null;
  onCheckNow: () => void;
  onDownloadNow: () => void;
  onReloadNow: () => void;
  onDismiss: () => void;
}

interface BannerCopy {
  title: string;
  message: string;
  primaryLabel: string | null;
  showSpinner: boolean;
}

function ActionButton({ label, onPress, variant = 'solid' }: { label: string; onPress: () => void; variant?: 'solid' | 'ghost' }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === 'solid' ? styles.actionSolid : styles.actionGhost,
        pressed ? styles.actionPressed : null,
      ]}
    >
      <Text style={variant === 'solid' ? styles.actionSolidLabel : styles.actionGhostLabel}>{label}</Text>
    </Pressable>
  );
}

export function OtaUpdateBanner({
  visible,
  status,
  errorMessage,
  onCheckNow,
  onDownloadNow,
  onReloadNow,
  onDismiss,
}: OtaUpdateBannerProps) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: visible ? 220 : 180,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: visible ? 0 : -20,
        speed: 20,
        bounciness: 6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, visible]);

  const copy = useMemo<BannerCopy>(() => {
    if (status === 'checking') {
      return {
        title: 'Buscando actualizaciones',
        message: 'Verificando si hay una nueva version para MOVOPos.',
        primaryLabel: null,
        showSpinner: true,
      };
    }

    if (status === 'available') {
      return {
        title: 'Nueva actualizacion disponible',
        message: 'Hay mejoras listas para instalar en esta app.',
        primaryLabel: 'Actualizar',
        showSpinner: false,
      };
    }

    if (status === 'downloading') {
      return {
        title: 'Descargando actualizacion',
        message: 'Estamos preparando la nueva version. Toma unos segundos.',
        primaryLabel: null,
        showSpinner: true,
      };
    }

    if (status === 'ready') {
      return {
        title: 'Actualizacion lista',
        message: 'La descarga termino. Reinicia para aplicar los cambios.',
        primaryLabel: 'Reiniciar ahora',
        showSpinner: false,
      };
    }

    if (status === 'error') {
      return {
        title: 'No se pudo actualizar',
        message: errorMessage || 'Ocurrio un error al revisar actualizaciones.',
        primaryLabel: 'Reintentar',
        showSpinner: false,
      };
    }

    return {
      title: '',
      message: '',
      primaryLabel: null,
      showSpinner: false,
    };
  }, [errorMessage, status]);

  const handlePrimary = () => {
    if (status === 'available') {
      onDownloadNow();
      return;
    }
    if (status === 'ready') {
      onReloadNow();
      return;
    }
    if (status === 'error') {
      onCheckNow();
    }
  };

  const bannerVisible = visible && status !== 'idle';

  return (
    <Animated.View
      pointerEvents={bannerVisible ? 'auto' : 'none'}
      style={[
        styles.overlay,
        {
          paddingTop: insets.top + 8,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.card}>
        <View style={styles.topRow}>
          <View style={styles.badge} />
          <Text style={styles.title}>{copy.title}</Text>
          {copy.showSpinner ? <ActivityIndicator size={16} color={ui.colors.primary} /> : null}
        </View>
        <Text style={styles.message}>{copy.message}</Text>

        {(status === 'available' || status === 'ready' || status === 'error') && (
          <View style={styles.actions}>
            {copy.primaryLabel ? <ActionButton label={copy.primaryLabel} onPress={handlePrimary} /> : null}
            <ActionButton label="Despues" onPress={onDismiss} variant="ghost" />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 0,
    zIndex: 999,
  },
  card: {
    borderRadius: ui.radius.lg,
    backgroundColor: ui.colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#DCCCF8',
    shadowColor: '#140725',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    width: 9,
    height: 9,
    borderRadius: ui.radius.round,
    backgroundColor: ui.colors.primary,
  },
  title: {
    flex: 1,
    color: ui.colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  message: {
    marginTop: 6,
    color: ui.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionButton: {
    borderRadius: ui.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionSolid: {
    backgroundColor: ui.colors.primary,
  },
  actionGhost: {
    backgroundColor: '#F1E9FF',
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionSolidLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  actionGhostLabel: {
    color: ui.colors.primaryDark,
    fontSize: 12,
    fontWeight: '700',
  },
});
