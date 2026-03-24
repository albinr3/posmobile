import { db } from '../../database/Database';

type QueueStatus = 'pending' | 'syncing' | 'synced' | 'error';

type QueueByStatus = Record<QueueStatus, number>;

type Phase0SyncBaselineSnapshot = {
  label: string;
  capturedAt: number;
  queue: {
    total: number;
    byStatus: QueueByStatus;
    byEntity: Array<{
      entityType: string;
      pending: number;
      syncing: number;
      error: number;
      total: number;
    }>;
  };
  localCounts: {
    products: number;
    customers: number;
    categories: number;
    suppliers: number;
    sales: number;
    quotes: number;
    purchases: number;
    payments: number;
    returns: number;
    operatingExpenses: number;
    accountsReceivable: number;
  };
};

async function countTableRows(table: string): Promise<number> {
  const row = await db.queryFirst<{ count?: number }>(`SELECT COUNT(*) as count FROM ${table}`);
  return Number(row?.count || 0);
}

export async function capturePhase0SyncBaselineSnapshot(label: string = 'manual'): Promise<Phase0SyncBaselineSnapshot> {
  const capturedAt = Date.now();

  const queueRows = await db.query<{
    status?: string;
    count?: number;
  }>(
    `SELECT status, COUNT(*) as count
     FROM sync_queue
     GROUP BY status`
  );

  const byStatus: QueueByStatus = {
    pending: 0,
    syncing: 0,
    synced: 0,
    error: 0,
  };

  for (const row of queueRows) {
    const status = String(row?.status || '').toLowerCase();
    if (status === 'pending' || status === 'syncing' || status === 'synced' || status === 'error') {
      byStatus[status] = Number(row?.count || 0);
    }
  }

  const queueByEntity = await db.query<{
    entity_type?: string;
    pending?: number;
    syncing?: number;
    error?: number;
    total?: number;
  }>(
    `SELECT
       entity_type,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
       SUM(CASE WHEN status = 'syncing' THEN 1 ELSE 0 END) as syncing,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
       COUNT(*) as total
     FROM sync_queue
     GROUP BY entity_type
     ORDER BY entity_type ASC`
  );

  const snapshot: Phase0SyncBaselineSnapshot = {
    label,
    capturedAt,
    queue: {
      total: byStatus.pending + byStatus.syncing + byStatus.synced + byStatus.error,
      byStatus,
      byEntity: queueByEntity.map((row) => ({
        entityType: String(row?.entity_type || ''),
        pending: Number(row?.pending || 0),
        syncing: Number(row?.syncing || 0),
        error: Number(row?.error || 0),
        total: Number(row?.total || 0),
      })),
    },
    localCounts: {
      products: await countTableRows('products'),
      customers: await countTableRows('customers'),
      categories: await countTableRows('categories'),
      suppliers: await countTableRows('suppliers'),
      sales: await countTableRows('sales'),
      quotes: await countTableRows('quotes'),
      purchases: await countTableRows('purchases'),
      payments: await countTableRows('payments'),
      returns: await countTableRows('returns'),
      operatingExpenses: await countTableRows('operating_expenses'),
      accountsReceivable: await countTableRows('accounts_receivable'),
    },
  };

  await db.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
     VALUES (?, ?, ?)`,
    ['phase0_baseline_snapshot', JSON.stringify(snapshot), capturedAt]
  );

  return snapshot;
}

