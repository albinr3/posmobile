import * as SQLite from 'expo-sqlite';

class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;

  private normalizeSqlValue(value: any): any {
    if (value === undefined) return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    if (typeof value === 'object' && value !== null && !(value instanceof Uint8Array)) {
      return JSON.stringify(value);
    }
    return value;
  }

  private normalizeParams(params: any[] = []): any[] {
    return params.map((param) => this.normalizeSqlValue(param));
  }

  async init(): Promise<void> {
    this.db = await SQLite.openDatabaseAsync('movopos.db');
    await this.createTables();
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Tabla de cola de sincronización
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_local_id TEXT NOT NULL,
        action TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        synced_at INTEGER
      );
    `);

    // Metadatos de sincronización
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
    `);

    // Tabla de ventas
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS sales (
        local_id TEXT PRIMARY KEY,
        server_id TEXT UNIQUE,
        invoice_code TEXT NOT NULL,
        customer_id TEXT,
        total_cents INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        data TEXT NOT NULL
      );
    `);

    // Tabla de productos
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS products (
        local_id TEXT PRIMARY KEY,
        server_id TEXT UNIQUE,
        name TEXT NOT NULL,
        sku TEXT,
        price_cents INTEGER NOT NULL,
        stock REAL DEFAULT 0,
        synced INTEGER DEFAULT 0,
        data TEXT NOT NULL
      );
    `);

    // Migracion: agregar columna de costo para bases existentes
    const productColumns = await this.db.getAllAsync<{ name: string }>('PRAGMA table_info(products);');
    const hasCostCents = productColumns.some((column) => column.name === 'cost_cents');
    if (!hasCostCents) {
      await this.db.execAsync(`
        ALTER TABLE products ADD COLUMN cost_cents INTEGER DEFAULT 0;
      `);
    }

    // Tabla de clientes
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS customers (
        local_id TEXT PRIMARY KEY,
        server_id TEXT UNIQUE,
        name TEXT NOT NULL,
        phone TEXT,
        synced INTEGER DEFAULT 0,
        data TEXT NOT NULL
      );
    `);

    // Tabla de pagos
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS payments (
        local_id TEXT PRIMARY KEY,
        server_id TEXT UNIQUE,
        receipt_code TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        ar_id TEXT,
        synced INTEGER DEFAULT 0,
        data TEXT NOT NULL
      );
    `);

    // Tabla de cuentas por cobrar
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS accounts_receivable (
        local_id TEXT PRIMARY KEY,
        server_id TEXT UNIQUE,
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        paid_cents INTEGER DEFAULT 0,
        balance_cents INTEGER NOT NULL,
        status TEXT DEFAULT 'PENDIENTE',
        due_date INTEGER,
        synced INTEGER DEFAULT 0,
        data TEXT NOT NULL
      );
    `);

    // Índices para búsquedas rápidas
    await this.db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_sales_synced ON sales(synced);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    `);
  }

  async insert(table: string, data: Record<string, any>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const keys = Object.keys(data);
    const values = this.normalizeParams(Object.values(data));
    const placeholders = keys.map(() => '?').join(', ');

    try {
      await this.db.runAsync(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
        values
      );
    } catch (error) {
      console.error('SQLite insert error:', { table, keys, values, error });
      throw error;
    }
  }

  async update(table: string, id: string, data: Record<string, any>, idColumn: string = 'local_id'): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const keys = Object.keys(data);
    if (keys.length === 0) return;

    const values = this.normalizeParams(Object.values(data));
    const setClause = keys.map(key => `${key} = ?`).join(', ');

    try {
      await this.db.runAsync(
        `UPDATE ${table} SET ${setClause} WHERE ${idColumn} = ?`,
        [...values, this.normalizeSqlValue(id)]
      );
    } catch (error) {
      console.error('SQLite update error:', { table, idColumn, id, keys, values, error });
      throw error;
    }
  }

  async delete(table: string, id: string, idColumn: string = 'local_id'): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    try {
      await this.db.runAsync(`DELETE FROM ${table} WHERE ${idColumn} = ?`, [this.normalizeSqlValue(id)]);
    } catch (error) {
      console.error('SQLite delete error:', { table, idColumn, id, error });
      throw error;
    }
  }

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    const normalizedParams = this.normalizeParams(params);
    try {
      return await this.db.getAllAsync<T>(sql, normalizedParams);
    } catch (error) {
      console.error('SQLite query error:', { sql, params: normalizedParams, error });
      throw error;
    }
  }

  async queryFirst<T>(sql: string, params: any[] = []): Promise<T | null> {
    if (!this.db) throw new Error('Database not initialized');
    const normalizedParams = this.normalizeParams(params);
    try {
      return await this.db.getFirstAsync<T>(sql, normalizedParams);
    } catch (error) {
      console.error('SQLite queryFirst error:', { sql, params: normalizedParams, error });
      throw error;
    }
  }

  async runAsync(sql: string, params: any[] = []): Promise<SQLite.SQLiteRunResult> {
    if (!this.db) throw new Error('Database not initialized');
    const normalizedParams = this.normalizeParams(params);
    try {
      return await this.db.runAsync(sql, normalizedParams);
    } catch (error) {
      console.error('SQLite runAsync error:', { sql, params: normalizedParams, error });
      throw error;
    }
  }
}

export const db = new DatabaseService();
