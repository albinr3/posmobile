const fs = require("fs");
const path = require("path");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|json|md)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, "utf8");
    if (text.includes("Mi negocio") || text.includes("mi negocio")) {
      console.log(full);
    }
  }
}

walk("src");
