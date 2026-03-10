const fs = require('fs');
const file = 'c:\\Users\\Albin Rodríguez\\Videos\\posmobile\\src\\database\\Database.ts';
let data = fs.readFileSync(file, 'utf8');

// Fix quotes table
data = data.replace(
  "        synced INTEGER DEFAULT 0,\r\n        is_available_for_sale INTEGER DEFAULT 1,\r\n        data TEXT NOT NULL\r\n      );\r\n    `);",
  "        synced INTEGER DEFAULT 0,\r\n        data TEXT NOT NULL\r\n      );\r\n    `);"
);

data = data.replace(
  "        synced INTEGER DEFAULT 0,\n        is_available_for_sale INTEGER DEFAULT 1,\n        data TEXT NOT NULL\n      );\n    `);",
  "        synced INTEGER DEFAULT 0,\n        data TEXT NOT NULL\n      );\n    `);"
);

// Add product migration
const migrationTarget1 = "      await this.db.execAsync(`\r\n        ALTER TABLE products ADD COLUMN cost_cents INTEGER DEFAULT 0;\r\n      `);\r\n    }\r\n\r\n    // Tabla de clientes";
const migrationReplacement1 = "      await this.db.execAsync(`\r\n        ALTER TABLE products ADD COLUMN cost_cents INTEGER DEFAULT 0;\r\n      `);\r\n    }\r\n\r\n    const hasIsAvailable = productColumns.some((column) => column.name === 'is_available_for_sale');\r\n    if (!hasIsAvailable) {\r\n      await this.db.execAsync(`\r\n        ALTER TABLE products ADD COLUMN is_available_for_sale INTEGER DEFAULT 1;\r\n      `);\r\n    }\r\n\r\n    // Tabla de clientes";

const migrationTarget2 = "      await this.db.execAsync(`\n        ALTER TABLE products ADD COLUMN cost_cents INTEGER DEFAULT 0;\n      `);\n    }\n\n    // Tabla de clientes";
const migrationReplacement2 = "      await this.db.execAsync(`\n        ALTER TABLE products ADD COLUMN cost_cents INTEGER DEFAULT 0;\n      `);\n    }\n\n    const hasIsAvailable = productColumns.some((column) => column.name === 'is_available_for_sale');\n    if (!hasIsAvailable) {\n      await this.db.execAsync(`\n        ALTER TABLE products ADD COLUMN is_available_for_sale INTEGER DEFAULT 1;\n      `);\n    }\n\n    // Tabla de clientes";

data = data.replace(migrationTarget1, migrationReplacement1).replace(migrationTarget2, migrationReplacement2);

fs.writeFileSync(file, data, 'utf8');
console.log('Database.ts schema patched.');
