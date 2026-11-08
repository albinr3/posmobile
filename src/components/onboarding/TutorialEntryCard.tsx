import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useAuthStore } from '../../store/authStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { ui } from '../../theme/ui';
export function TutorialEntryCard() {
  const owner = useAuthStore(s => s.subUser?.isOwner === true);
  const s = useOnboardingStore();
  if (!owner || !s.hydrated || (!s.remoteChecked && !s.introSeen) || s.completedAt) return null;
  const pending = s.stage === 'pending';
  return <View style={styles.card}>
    <View style={styles.heading}><Icon source={pending ? 'cloud-sync-outline' : 'school-outline'} size={27} color={ui.colors.primary} /><Text style={styles.title}>{pending ? 'Finalización pendiente' : s.introSeen ? 'Continúa tus primeros pasos' : 'Conoce la app en unos pasos'}</Text></View>
    <Text style={styles.body}>{pending ? 'Tu producto está guardado. Confirmaremos el tutorial en ambas plataformas al sincronizar.' : 'Practica una venta y prepara tu producto con una guía interactiva.'}</Text>
    <Button mode="contained-tonal" textColor={ui.colors.primary} onPress={() => useOnboardingStore.getState().requestOpen()}>{pending ? 'Ver progreso' : s.introSeen ? 'Retomar tutorial' : 'Abrir tutorial'}</Button>
  </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: '#F1E7FD', borderRadius: 22, padding: 20, gap: 12, marginBottom: 18 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, title: { flex: 1, color: ui.colors.text, fontSize: 17, fontWeight: '800' }, body: { color: ui.colors.textMuted, fontSize: 13, lineHeight: 20 } });
