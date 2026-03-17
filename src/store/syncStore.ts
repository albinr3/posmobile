import { create } from 'zustand';

interface SyncState {
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingCount: number;
  isOnline: boolean;
  syncBlockedReason: string | null;
  setIsSyncing: (syncing: boolean) => void;
  setLastSyncTime: (time: number) => void;
  setPendingCount: (count: number) => void;
  setIsOnline: (online: boolean) => void;
  setSyncBlockedReason: (reason: string | null) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isSyncing: false,
  lastSyncTime: null,
  pendingCount: 0,
  isOnline: false,
  syncBlockedReason: null,

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

  setSyncBlockedReason: (reason: string | null) => {
    set({ syncBlockedReason: reason });
  },
}));
