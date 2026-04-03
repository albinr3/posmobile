export type TaxLineTotals = {
  subtotalCents: number;
  itbisCents: number;
  totalCents: number;
};

const MAX_DISCOUNT_BP = 10000;

export function normalizeDiscountPercentBp(rawDiscountPercentBp: unknown): number {
  const discountPercentBp = Number(rawDiscountPercentBp);
  if (!Number.isFinite(discountPercentBp)) return 0;
  return Math.max(0, Math.min(MAX_DISCOUNT_BP, Math.round(discountPercentBp)));
}

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
  discountPercentBp?: number | null;
}) {
  const shippingCents = Math.max(0, Math.round(Number(params.shippingCents || 0)));
  const salePricesIncludeItbis = params.salePricesIncludeItbis !== false;
  const discountPercentBp = normalizeDiscountPercentBp(params.discountPercentBp ?? 0);

  let subtotalBeforeDiscountCents = 0;
  let discountSubtotalCents = 0;
  let subtotalCents = 0;
  let itbisCents = 0;
  let itemsTotalBeforeDiscountCents = 0;
  let discountTotalCents = 0;
  let itemsTotalCents = 0;

  for (const item of params.items || []) {
    const quantity = Number(item?.quantity ?? item?.qty ?? 0);
    const unitPriceCents = Number(item?.priceCents ?? item?.unitPriceCents ?? 0);
    const lineItbisRateBp = Math.max(0, Math.round(Number(item?.itbisRateBp ?? 1800)));
    const lineRate = lineItbisRateBp / 10000;
    const line = calcLineTotalsByTaxMode({
      unitPriceCents,
      quantity,
      itbisRateBp: lineItbisRateBp,
      salePricesIncludeItbis,
    });

    let lineDiscountSubtotalCents = 0;
    let lineSubtotalAfterDiscountCents = line.subtotalCents;
    let lineItbisAfterDiscountCents = line.itbisCents;
    let lineTotalAfterDiscountCents = line.totalCents;
    let lineDiscountTotalCents = 0;

    if (discountPercentBp > 0) {
      if (salePricesIncludeItbis) {
        // Fórmula base (sin redondeos intermedios):
        // subtotalRaw = total / (1 + itbis)
        // subtotalConDescuentoRaw = subtotalRaw * (1 - descuento)
        // totalConDescuentoRaw = subtotalConDescuentoRaw * (1 + itbis)
        // Solo al final se redondea a centavos.
        const lineSubtotalBeforeRawCents = line.totalCents / (1 + lineRate);
        const lineDiscountSubtotalRawCents = (lineSubtotalBeforeRawCents * discountPercentBp) / 10000;
        const lineSubtotalAfterRawCents = Math.max(0, lineSubtotalBeforeRawCents - lineDiscountSubtotalRawCents);

        lineDiscountSubtotalCents = Math.max(
          0,
          Math.min(line.subtotalCents, Math.round(lineDiscountSubtotalRawCents))
        );
        lineSubtotalAfterDiscountCents = Math.max(0, line.subtotalCents - lineDiscountSubtotalCents);
        lineTotalAfterDiscountCents = Math.max(0, Math.round(lineSubtotalAfterRawCents * (1 + lineRate)));
        lineItbisAfterDiscountCents = Math.max(0, lineTotalAfterDiscountCents - lineSubtotalAfterDiscountCents);
        lineDiscountTotalCents = Math.max(0, line.totalCents - lineTotalAfterDiscountCents);
      } else {
        lineDiscountSubtotalCents = Math.max(
          0,
          Math.min(line.subtotalCents, Math.round((line.subtotalCents * discountPercentBp) / 10000))
        );
        lineSubtotalAfterDiscountCents = Math.max(0, line.subtotalCents - lineDiscountSubtotalCents);
        lineItbisAfterDiscountCents = lineItbisRateBp > 0 ? Math.max(0, Math.round(lineSubtotalAfterDiscountCents * lineRate)) : 0;
        lineTotalAfterDiscountCents = lineSubtotalAfterDiscountCents + lineItbisAfterDiscountCents;
        lineDiscountTotalCents = Math.max(0, line.totalCents - lineTotalAfterDiscountCents);
      }
    }

    subtotalBeforeDiscountCents += line.subtotalCents;
    discountSubtotalCents += lineDiscountSubtotalCents;
    subtotalCents += lineSubtotalAfterDiscountCents;
    itbisCents += lineItbisAfterDiscountCents;
    itemsTotalBeforeDiscountCents += line.totalCents;
    discountTotalCents += lineDiscountTotalCents;
    itemsTotalCents += lineTotalAfterDiscountCents;
  }

  return {
    subtotalBeforeDiscountCents,
    discountSubtotalCents,
    subtotalCents,
    itbisCents,
    itemsTotalBeforeDiscountCents,
    discountTotalCents,
    itemsTotalCents,
    totalCents: itemsTotalCents + shippingCents,
  };
}
