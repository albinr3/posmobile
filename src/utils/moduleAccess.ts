type ModuleAccessSubUser = {
  isOwner?: boolean;
  canAccessSales?: boolean;
  canAccessDashboard?: boolean;
  canAccessReturns?: boolean;
  canAccessProducts?: boolean;
  canAccessAccountsReceivable?: boolean;
  canAccessPayments?: boolean;
  canAccessDailyClose?: boolean;
  canAccessReports?: boolean;
  canAccessShippingLabels?: boolean;
  canAccessBilling?: boolean;
  canAccessSettings?: boolean;
} | null | undefined;

export type ModuleAccessKey =
  | 'sales'
  | 'dashboard'
  | 'returns'
  | 'products'
  | 'accountsReceivable'
  | 'payments'
  | 'dailyClose'
  | 'reports'
  | 'shippingLabels'
  | 'billing'
  | 'settings';

const MODULE_ACCESS_FIELD: Record<ModuleAccessKey, keyof NonNullable<ModuleAccessSubUser>> = {
  sales: 'canAccessSales',
  dashboard: 'canAccessDashboard',
  returns: 'canAccessReturns',
  products: 'canAccessProducts',
  accountsReceivable: 'canAccessAccountsReceivable',
  payments: 'canAccessPayments',
  dailyClose: 'canAccessDailyClose',
  reports: 'canAccessReports',
  shippingLabels: 'canAccessShippingLabels',
  billing: 'canAccessBilling',
  settings: 'canAccessSettings',
};

export function canAccessModule(subUser: ModuleAccessSubUser, module: ModuleAccessKey): boolean {
  if (!subUser) return false;
  if (subUser.isOwner) return true;

  const field = MODULE_ACCESS_FIELD[module];
  const value = subUser[field];

  // Sesiones guardadas antes de los permisos canAccess... no tienen estos campos.
  // Se permite acceso temporal hasta que /api/auth/me refresque el subusuario real.
  return value !== false;
}
