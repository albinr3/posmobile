import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';

const SALE_SOUND_ENABLED_KEY = 'sale_sound_enabled';
const SALE_SOUND_ASSET = require('../../../assets/sounds/freesound_community-cash-register-purchase-87313.mp3');

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
    const expoAudio = require('expo-audio');
    const createAudioPlayer = expoAudio?.createAudioPlayer;
    const setAudioModeAsync = expoAudio?.setAudioModeAsync;
    const setIsAudioActiveAsync = expoAudio?.setIsAudioActiveAsync;
    if (!createAudioPlayer) {
      Vibration.vibrate(35);
      return;
    }

    if (typeof setIsAudioActiveAsync === 'function') {
      await setIsAudioActiveAsync(true);
    }

    if (typeof setAudioModeAsync === 'function') {
      await setAudioModeAsync({
        playsInSilentMode: true,
      });
    }

    const player = createAudioPlayer(SALE_SOUND_ASSET, { downloadFirst: true });
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
  } catch (error) {
    console.warn('[saleFeedback] No se pudo reproducir sonido de venta, usando vibracion.', error);
    Vibration.vibrate(35);
  }
};
