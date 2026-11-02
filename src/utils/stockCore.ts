// El cliente debe usar los mismos consumos y redondeos que resolveSaleLines:
// validar cada línea por separado permitiría gastar dos veces un insumo compartido.
export type StockConsumption = { ingredientId: string; qty: number }
export type StockEntry = { id: string; name: string; stock: number; isActive: boolean; snapshotAt: number }
export type StockProduct = {
  id: string; accountId?: string; name: string; stock: number; stockSnapshotAt?: number
  productKind?: string
  recipeItems?: Array<{ ingredientId: string; ingredientName: string; ingredientStock?: number; ingredientIsActive?: boolean; qty: number }>
}
export type StockLine = {
  productId: string; name: string; qty: number; productKind: string
  recipeItems: NonNullable<StockProduct["recipeItems"]>
  recipeAdjustments: Array<{ ingredientId: string; adjustmentType: "SIN" | "EXTRA" }>
}
export type StockIssue = { kind: "missing" | "inactive" | "insufficient" | "invalid"; name: string; requested?: number; available?: number; message: string }
export const roundStockQty = (value: number) => Math.round(value * 1000) / 1000

export function initialStockQuantity(available: number, measured: boolean, unrestricted: boolean) {
  if (!measured || unrestricted) return 1
  return Math.max(0.01, Math.min(1, Math.floor((available + 1e-9) * 100) / 100))
}

export function aggregateStockConsumptions(consumptions: StockConsumption[]): StockConsumption[] {
  const totals = new Map<string, number>()
  for (const item of consumptions) totals.set(item.ingredientId, roundStockQty((totals.get(item.ingredientId) ?? 0) + item.qty))
  return Array.from(totals, ([ingredientId, qty]) => ({ ingredientId, qty }))
}

export function getStockConsumptions(lines: StockLine[]): { consumptions: StockConsumption[]; issue: StockIssue | null } {
  const consumptions: StockConsumption[] = []
  const invalid = (name: string, message: string) => ({ consumptions: [], issue: { kind: "invalid" as const, name, message } })
  for (const line of lines) {
    if (!Number.isFinite(line.qty) || line.qty <= 0) return invalid(line.name, `Cantidad inválida para "${line.name}".`)
    if (line.productKind !== "RECIPE") {
      consumptions.push({ ingredientId: line.productId, qty: roundStockQty(line.qty) })
      continue
    }
    if (!line.recipeItems.length) return invalid(line.name, `"${line.name}" no tiene una receta configurada. Sincroniza los productos.`)
    const adjustments = new Map<string, "SIN" | "EXTRA">()
    for (const adjustment of line.recipeAdjustments) {
      if (!["SIN", "EXTRA"].includes(adjustment.adjustmentType) || adjustments.has(adjustment.ingredientId) || !line.recipeItems.some(item => item.ingredientId === adjustment.ingredientId)) return invalid(line.name, `Ajuste de receta inválido en "${line.name}".`)
      adjustments.set(adjustment.ingredientId, adjustment.adjustmentType)
    }
    let consumed = false
    for (const ingredient of line.recipeItems) {
      if (!Number.isFinite(ingredient.qty) || ingredient.qty <= 0) return invalid(line.name, `Receta incompleta para "${line.name}". Sincroniza los productos.`)
      const adjustment = adjustments.get(ingredient.ingredientId)
      const base = roundStockQty(ingredient.qty * line.qty)
      const qty = adjustment === "SIN" ? 0 : adjustment === "EXTRA" ? roundStockQty(base * 2) : base
      if (qty > 0) { consumptions.push({ ingredientId: ingredient.ingredientId, qty }); consumed = true }
    }
    if (!consumed) return invalid(line.name, `Los ajustes dejan "${line.name}" sin insumos que descontar.`)
  }
  return { consumptions: aggregateStockConsumptions(consumptions), issue: null }
}

export function buildStockInventory(products: StockProduct[], accountId: string, entries: StockEntry[] = []) {
  const inventory = new Map<string, StockEntry>()
  const put = (entry: StockEntry) => {
    if (!Number.isFinite(entry.stock)) return
    if ((inventory.get(entry.id)?.snapshotAt ?? -1) <= entry.snapshotAt) inventory.set(entry.id, entry)
  }
  for (const product of products) {
    if (product.accountId !== accountId) continue
    const snapshotAt = product.stockSnapshotAt ?? 0
    put({ id: product.id, name: product.name, stock: product.stock, isActive: true, snapshotAt })
    for (const ingredient of product.recipeItems ?? []) {
      if (typeof ingredient.ingredientStock !== "number" || typeof ingredient.ingredientIsActive !== "boolean") continue
      put({ id: ingredient.ingredientId, name: ingredient.ingredientName, stock: ingredient.ingredientStock, isActive: ingredient.ingredientIsActive, snapshotAt })
    }
  }
  entries.forEach(put)
  return inventory
}

export function validateStockConsumptions(consumptions: StockConsumption[], inventory: Map<string, StockEntry>, reserved: StockConsumption[] = []): StockIssue | null {
  const reservations = new Map(aggregateStockConsumptions(reserved).map(item => [item.ingredientId, item.qty]))
  for (const item of aggregateStockConsumptions(consumptions)) {
    const product = inventory.get(item.ingredientId)
    if (!product) return { kind: "missing", name: item.ingredientId, message: "Faltan existencias para validar el pedido. Conéctate y sincroniza los productos." }
    if (!product.isActive) return { kind: "inactive", name: product.name, message: `El producto o insumo "${product.name}" está inactivo.` }
    const available = roundStockQty(product.stock - (reservations.get(item.ingredientId) ?? 0))
    if (item.qty > available) return { kind: "insufficient", name: product.name, requested: item.qty, available, message: `Existencia insuficiente para "${product.name}". Solicitado: ${item.qty}; disponible: ${Math.max(0, available)}.` }
  }
  return null
}

export function stockConsumptionDoesNotIncrease(previous: StockLine[], next: StockLine[]) {
  const before = getStockConsumptions(previous), after = getStockConsumptions(next)
  if (before.issue || after.issue) return false
  const totals = new Map(before.consumptions.map(item => [item.ingredientId, item.qty]))
  return after.consumptions.every(item => item.qty <= (totals.get(item.ingredientId) ?? 0))
}
