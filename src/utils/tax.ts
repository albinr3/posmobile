export type TaxLineTotals = {
  subtotalCents: number;
  itbisCents: number;
  totalCents: number;
};

export function calcLineTotalsByTaxMode(params: {
  unitPriceCents: number;
  quantity: number;
  itbisRateBp?: number | null;
  salePricesIncludeItbis?: boolean;
}): TaxLineTotals {
  const unitPriceCents = Math.max(0, Math.round(Number(params.unitPriceCents || 0)));
  const quantity = Math.max(0, Number(params.quantity || 0));
  const itbisRateBp = Math.max(0, Math.round(Number(params.itbisRateBp ?? 1800)));
  const salePricesIncludeItbis = params.salePricesIncludeItbis !== false;
  const lineBaseCents = Math.max(0, Math.round(unitPriceCents * quantity));

  if (itbisRateBp <= 0) {
    return {
      subtotalCents: lineBaseCents,
      itbisCents: 0,
      totalCents: lineBaseCents,
    };
  }

  const rate = itbisRateBp / 10000;
  if (salePricesIncludeItbis) {
    const subtotalCents = Math.round(lineBaseCents / (1 + rate));
    const itbisCents = Math.max(0, lineBaseCents - subtotalCents);
    return {
      subtotalCents,
      itbisCents,
      totalCents: lineBaseCents,
    };
  }

  const itbisCents = Math.round(lineBaseCents * rate);
  return {
    subtotalCents: lineBaseCents,
    itbisCents,
    totalCents: lineBaseCents + itbisCents,
  };
}

export function calcDocumentTotalsByTaxMode(params: {
  items: Array<{
    quantity?: number;
    qty?: number;
    priceCents?: number;
    unitPriceCents?: number;
    itbisRateBp?: number | null;
  }>;
  shippingCents?: number;
  salePricesIncludeItbis?: boolean;
}) {
  const shippingCents = Math.max(0, Math.round(Number(params.shippingCents || 0)));
  const salePricesIncludeItbis = params.salePricesIncludeItbis !== false;

  let subtotalCents = 0;
  let itbisCents = 0;
  let itemsTotalCents = 0;

  for (const item of params.items || []) {
    const quantity = Number(item?.quantity ?? item?.qty ?? 0);
    const unitPriceCents = Number(item?.priceCents ?? item?.unitPriceCents ?? 0);
    const line = calcLineTotalsByTaxMode({
      unitPriceCents,
      quantity,
      itbisRateBp: item?.itbisRateBp ?? 1800,
      salePricesIncludeItbis,
    });
    subtotalCents += line.subtotalCents;
    itbisCents += line.itbisCents;
    itemsTotalCents += line.totalCents;
  }

  return {
    subtotalCents,
    itbisCents,
    itemsTotalCents,
    totalCents: itemsTotalCents + shippingCents,
  };
}
