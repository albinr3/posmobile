import { create } from 'zustand';
import { User } from '../types';
import * as SecureStore from 'expo-secure-store';

interface SubUser {
  id: string;
  name: string;
  username: string;
  role: string;
  isOwner: boolean;
  email?: string | null;
}

interface AuthState {
  user: User | null;
  subUser: SubUser | null;
  subUserToken: string | null;
  accountId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  biometricEnabled: boolean;
  setUser: (user: User | null) => void;
  setSubUser: (subUser: SubUser | null, token: string | null, accountId: string | null) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  logout: () => Promise<void>;
  loadSubUserToken: () => Promise<void>;
}

const SUBUSER_TOKEN_KEY = 'movopos_subuser_token';
const SUBUSER_DATA_KEY = 'movopos_subuser_data';
const ACCOUNT_ID_KEY = 'movopos_account_id';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  subUser: null,
  subUserToken: null,
  accountId: null,
  isAuthenticated: false,
  isLoading: true,
  biometricEnabled: false,

  setUser: (user: User | null) => {
    set({
      user,
      // isAuthenticated se actualiza cuando se establece el subusuario
      // Por ahora, si hay usuario de Clerk, permitimos navegar (aunque falte subusuario)
      // Esto será manejado por la pantalla de selección de subusuario
      isLoading: false,
    });
  },

  setSubUser: async (subUser: SubUser | null, token: string | null, accountId: string | null) => {
    if (subUser && token && accountId) {
      // Guardar en SecureStore
      await SecureStore.setItemAsync(SUBUSER_TOKEN_KEY, token);
      await SecureStore.setItemAsync(SUBUSER_DATA_KEY, JSON.stringify(subUser));
      await SecureStore.setItemAsync(ACCOUNT_ID_KEY, accountId);
    } else {
      // Limpiar
      await SecureStore.deleteItemAsync(SUBUSER_TOKEN_KEY);
      await SecureStore.deleteItemAsync(SUBUSER_DATA_KEY);
      await SecureStore.deleteItemAsync(ACCOUNT_ID_KEY);
    }

    set({
      subUser,
      subUserToken: token,
      accountId,
      isAuthenticated: !!subUser && !!token && !!get().user,
      isLoading: false,
    });
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  setBiometricEnabled: (enabled: boolean) => {
    set({ biometricEnabled: enabled });
  },

  loadSubUserToken: async () => {
    try {
      const token = await SecureStore.getItemAsync(SUBUSER_TOKEN_KEY);
      const subUserData = await SecureStore.getItemAsync(SUBUSER_DATA_KEY);
      const accountId = await SecureStore.getItemAsync(ACCOUNT_ID_KEY);

      if (token && subUserData && accountId) {
        const subUser = JSON.parse(subUserData) as SubUser;
        set({
          subUser,
          subUserToken: token,
          accountId,
          isAuthenticated: !!get().user && !!subUser && !!token,
        });
      }
    } catch (error) {
      console.error('Error cargando token de subusuario:', error);
    }
  },

  logout: async () => {
    // Limpiar SecureStore
    await SecureStore.deleteItemAsync(SUBUSER_TOKEN_KEY);
    await SecureStore.deleteItemAsync(SUBUSER_DATA_KEY);
    await SecureStore.deleteItemAsync(ACCOUNT_ID_KEY);

    set({
      user: null,
      subUser: null,
      subUserToken: null,
      accountId: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },
}));
