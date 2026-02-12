import { create } from 'zustand';

interface SyncState {
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingCount: number;
  isOnline: boolean;
  setIsSyncing: (syncing: boolean) => void;
  setLastSyncTime: (time: number) => void;
  setPendingCount: (count: number) => void;
  setIsOnline: (online: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isSyncing: false,
  lastSyncTime: null,
  pendingCount: 0,
  isOnline: true,

  setIsSyncing: (syncing: boolean) => {
    set({ isSyncing: syncing });
  },

  setLastSyncTime: (time: number) => {
    set({ lastSyncTime: time });
  },

  setPendingCount: (count: number) => {
    set({ pendingCount: count });
  },

  setIsOnline: (online: boolean) => {
    set({ isOnline: online });
  },
}));
