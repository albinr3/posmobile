import { TreasuryAccount } from '../types';
import { canUseAccountForPaymentMethod } from '../services/treasury/treasuryService';

export const TREASURY_CREATE_ACCOUNT_SENTINEL = '__CREATE_TREASURY_ACCOUNT__';

export function filterTreasuryAccountsByMethod(
  accounts: TreasuryAccount[],
  paymentMethod: string
): TreasuryAccount[] {
  return accounts.filter((account) => canUseAccountForPaymentMethod(account, paymentMethod));
}

export function findTreasuryAccountById(
  accounts: TreasuryAccount[],
  value: string | null | undefined
): TreasuryAccount | null {
  const lookup = String(value || '').trim();
  if (!lookup) return null;
  return (
    accounts.find((account) => account.localId === lookup || (account.serverId && account.serverId === lookup)) ||
    null
  );
}

