import { create } from 'zustand';

type TreasuryUIState = {
  openCreateAccountModal: boolean;
  preferredAccountType: 'CAJA' | 'BANCO' | null;
  lastCreatedAccountId: string | null;
  requestCreateAccountModal: (preferredType?: 'CAJA' | 'BANCO' | null) => void;
  consumeCreateAccountModalRequest: () => { open: boolean; preferredType: 'CAJA' | 'BANCO' | null };
  setLastCreatedAccountId: (accountId: string | null) => void;
  consumeLastCreatedAccountId: () => string | null;
};

export const useTreasuryUIStore = create<TreasuryUIState>((set, get) => ({
  openCreateAccountModal: false,
  preferredAccountType: null,
  lastCreatedAccountId: null,

  requestCreateAccountModal: (preferredType = null) => {
    set({
      openCreateAccountModal: true,
      preferredAccountType: preferredType === 'BANCO' ? 'BANCO' : preferredType === 'CAJA' ? 'CAJA' : null,
    });
  },

  consumeCreateAccountModalRequest: () => {
    const state = get();
    set({ openCreateAccountModal: false, preferredAccountType: null });
    return {
      open: state.openCreateAccountModal,
      preferredType: state.preferredAccountType,
    };
  },

  setLastCreatedAccountId: (accountId) => {
    set({ lastCreatedAccountId: accountId ? String(accountId) : null });
  },

  consumeLastCreatedAccountId: () => {
    const current = get().lastCreatedAccountId;
    set({ lastCreatedAccountId: null });
    return current;
  },
}));

