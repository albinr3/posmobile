export function getPaymentMethodLabel(method: string | null | undefined): string {
  switch (String(method || '').toUpperCase()) {
    case 'EFECTIVO':
      return 'Efectivo';
    case 'TARJETA':
      return 'Tarjeta';
    case 'TRANSFERENCIA':
      return 'Transferencia';
    case 'DIVIDIR_PAGO':
      return 'Dividir pago';
    case 'CREDITO':
      return 'Crédito';
    default:
      return method || 'N/A';
  }
}

export function formatPaymentWithBank(method: string | null | undefined, transferBankName?: string | null): string {
  const label = getPaymentMethodLabel(method);
  if (String(method || '').toUpperCase() === 'TRANSFERENCIA' && transferBankName) {
    return `${label} - ${transferBankName}`;
  }
  return label;
}
