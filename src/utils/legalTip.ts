export const LEGAL_TIP_PERCENT_BP = 1000;

function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return null;
}

function readFirstBoolean(values: unknown[]): boolean | null {
  for (const value of values) {
    const parsed = parseOptionalBoolean(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function normalizeLegalTipEnabled(raw: any, fallback: boolean = false): boolean {
  const parsed = readFirstBoolean([
    raw?.legalTipEnabled,
    raw?.propinaLegalEnabled,
    raw?.habilitarPropinaLegal,
  ]);
  return parsed ?? fallback;
}

export function normalizeApplyLegalTip(raw: any, fallback: boolean = false): boolean {
  const parsed = readFirstBoolean([
    raw?.applyLegalTip,
    raw?.cobrarPropinaLegal,
    raw?.incluirPropinaLegal,
    raw?.legalTipApplied,
  ]);
  return parsed ?? fallback;
}

export function calculateLegalTipCents(baseCents: unknown, percentBp: unknown = LEGAL_TIP_PERCENT_BP): number {
  const normalizedBaseCents = Number(baseCents);
  const normalizedPercentBp = Number(percentBp);
  const safeBaseCents = Number.isFinite(normalizedBaseCents)
    ? Math.max(0, Math.round(normalizedBaseCents))
    : 0;
  const safePercentBp = Number.isFinite(normalizedPercentBp)
    ? Math.max(0, Math.round(normalizedPercentBp))
    : LEGAL_TIP_PERCENT_BP;
  return Math.max(0, Math.round((safeBaseCents * safePercentBp) / 10000));
}

export function resolveLegalTipSummary(raw: any, fallbackBaseCents: number = 0) {
  const applyLegalTip = normalizeApplyLegalTip(raw, false);
  const legalTipApplied = parseOptionalBoolean(raw?.legalTipApplied) ?? applyLegalTip;
  const legalTipPercentBpRaw = Number(raw?.legalTipPercentBp);
  const legalTipPercentBp = Number.isFinite(legalTipPercentBpRaw)
    ? Math.max(0, Math.round(legalTipPercentBpRaw))
    : LEGAL_TIP_PERCENT_BP;
  const legalTipBaseCentsRaw = Number(raw?.legalTipBaseCents);
  const legalTipBaseCents = Number.isFinite(legalTipBaseCentsRaw)
    ? Math.max(0, Math.round(legalTipBaseCentsRaw))
    : Math.max(0, Math.round(Number(fallbackBaseCents || 0)));
  const legalTipCentsRaw = Number(raw?.legalTipCents);
  const legalTipCents = Number.isFinite(legalTipCentsRaw)
    ? Math.max(0, Math.round(legalTipCentsRaw))
    : legalTipApplied
      ? calculateLegalTipCents(legalTipBaseCents, legalTipPercentBp)
      : 0;

  return {
    applyLegalTip,
    legalTipApplied,
    legalTipPercentBp,
    legalTipBaseCents,
    legalTipCents,
  };
}
