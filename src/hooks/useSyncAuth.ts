import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useRef } from 'react';
import { syncService } from '../services/sync/SyncService';
import { useAuthStore } from '../store/authStore';

type RunSyncOptions = {
  ignoreCooldown?: boolean;
  isOnline?: boolean;
};

export function useSyncAuth() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const configureSyncAuth = useCallback(() => {
    syncService.setTokenGetter(() => getTokenRef.current());
    syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
  }, []);

  const runFullSyncIfAuthenticated = useCallback(
    async (options?: RunSyncOptions): Promise<boolean> => {
      if (options?.isOnline === false) return false;

      const clerkToken = await getTokenRef.current();
      const subUserToken = useAuthStore.getState().subUserToken;
      if (!clerkToken || !subUserToken) return false;

      configureSyncAuth();
      await syncService.fullSync(clerkToken, { ignoreCooldown: options?.ignoreCooldown });
      return true;
    },
    [configureSyncAuth]
  );

  return {
    configureSyncAuth,
    runFullSyncIfAuthenticated,
  };
}

