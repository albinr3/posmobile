import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';

const SALE_SOUND_ENABLED_KEY = 'sale_sound_enabled';
const SALE_SOUND_ASSET = require('../../../assets/sounds/freesound_community-cash-register-purchase-87313.mp3');

type ExpoAudioPlayer = {
  volume: number;
  isLoaded: boolean;
  play: () => void;
  remove: () => void;
};

type ExpoAudioModule = {
  createAudioPlayer?: (source?: unknown, options?: { downloadFirst?: boolean }) => ExpoAudioPlayer;
  setAudioModeAsync?: (mode: { playsInSilentMode?: boolean }) => Promise<void>;
  setIsAudioActiveAsync?: (active: boolean) => Promise<void>;
};

let canUseExpoAudio = true;

const isArgumentCountMismatchError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return /Received \d+ arguments?, but \d+ (was|were) expected/i.test(error.message);
};

const tryPlayWithExpoAudio = async (): Promise<boolean> => {
  if (!canUseExpoAudio) return false;

  try {
    const expoAudio = require('expo-audio') as ExpoAudioModule;
    if (typeof expoAudio.createAudioPlayer !== 'function') return false;

    if (typeof expoAudio.setIsAudioActiveAsync === 'function') {
      await expoAudio.setIsAudioActiveAsync(true);
    }

    if (typeof expoAudio.setAudioModeAsync === 'function') {
      await expoAudio.setAudioModeAsync({
        playsInSilentMode: true,
      });
    }

    const player = expoAudio.createAudioPlayer(SALE_SOUND_ASSET, { downloadFirst: true });
    player.volume = 1;
    if (!player.isLoaded) {
      let attempts = 0;
      while (!player.isLoaded && attempts < 15) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        attempts += 1;
      }
    }
    player.play();

    setTimeout(() => {
      try {
        player.remove();
      } catch {
        // noop
      }
    }, 3000);

    return true;
  } catch (error) {
    if (isArgumentCountMismatchError(error)) {
      // Mismatch entre JS/native de expo-audio; usar fallback estable para el resto de la sesión.
      canUseExpoAudio = false;
      return false;
    }
    throw error;
  }
};

export const isSaleSoundEnabled = async (): Promise<boolean> => {
  try {
    const stored = await AsyncStorage.getItem(SALE_SOUND_ENABLED_KEY);
    if (stored == null) return true;
    return stored === 'true';
  } catch {
    return true;
  }
};

export const setSaleSoundEnabled = async (value: boolean): Promise<void> => {
  await AsyncStorage.setItem(SALE_SOUND_ENABLED_KEY, value ? 'true' : 'false');
};

export const playSaleSuccessSound = async (): Promise<void> => {
  const enabled = await isSaleSoundEnabled();
  if (!enabled) return;

  try {
    if (await tryPlayWithExpoAudio()) return;
    Vibration.vibrate(35);
  } catch (error) {
    console.warn('[saleFeedback] No se pudo reproducir sonido de venta, usando vibracion.', error);
    Vibration.vibrate(35);
  }
};
