import fs from "fs";
import path from "path";
import type { Product } from "@/types";

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// Parse the MAS 200 CSV and return a map of itemCode -> partial Product
function parseMAS200CSV(): Map<string, Partial<Product>> | null {
  const csvPath = path.join(process.cwd(), "data", "mas200.csv");
  if (!fs.existsSync(csvPath)) return null;

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  const headers = parseCSVLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/[\s_]/g, "")
  );

  const idx = (...names: string[]): number => {
    for (const n of names) {
      const i = headers.indexOf(n.toLowerCase().replace(/[\s_]/g, ""));
      if (i !== -1) return i;
    }
    return -1;
  };

  const colItemCode = idx("itemcode", "item_code", "itemnumber", "item");
  const colDesc     = idx("itemdescription", "description", "itemdesc", "desc");
  const colDesc2    = idx("itemdescription2", "description2", "extendeddesc");
  const colPrice    = idx("standardprice", "price", "salesprice", "unitprice");
  const colCost     = idx("standardcost", "cost", "averagecost");
  const colCategory = idx("productline", "category", "productlinecode");
  const colUOM      = idx("standardunitofmeasure", "unitofmeasure", "uom");

  const result = new Map<string, Partial<Product>>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols.length) continue;

    const itemCode = (colItemCode >= 0 ? cols[colItemCode] : "").trim();
    if (!itemCode) continue;

    const price = colPrice >= 0 ? parseFloat(cols[colPrice]) || 0 : 0;
    const cost  = colCost  >= 0 ? parseFloat(cols[colCost])  || 0 : 0;

    result.set(itemCode, {
      id:        itemCode,
      name:      colDesc     >= 0 ? cols[colDesc].trim()     : itemCode,
      description: colDesc2  >= 0 ? cols[colDesc2].trim()    : "",
      price,
      unitPrice: cost > 0 ? cost : price,
      packaging: colUOM      >= 0 ? cols[colUOM].trim()      : "",
      category:  colCategory >= 0 ? cols[colCategory].trim() : "UNCATEGORIZED",
      image:     "",
      oos:       false,
    });
  }

  return result.size > 0 ? result : null;
}

/**
 * Merges MAS 200 live inventory with the existing products list:
 * - Items in MAS 200 export → in stock (add if new, update price if existing)
 * - Items in existing list but NOT in MAS 200 export → marked OOS
 * - Items in MAS 200 export but NOT in existing list → added as new
 */
export function mergeMAS200WithProducts(existing: Product[]): Product[] | null {
  const mas200 = parseMAS200CSV();
  if (!mas200) return null;

  const existingMap = new Map(existing.map((p) => [p.id, p]));
  const merged: Product[] = [];

  // 1. All items currently in MAS 200 → in stock
  for (const [id, mas] of mas200) {
    const known = existingMap.get(id);
    if (known) {
      // Existing item: preserve rich metadata, refresh price from MAS 200
      merged.push({
        ...known,
        price:     mas.price     ?? known.price,
        unitPrice: mas.unitPrice ?? known.unitPrice,
        category:  mas.category  && mas.category !== "UNCATEGORIZED" ? mas.category : known.category,
        oos:       false,
      });
    } else {
      // Brand new item from MAS 200
      merged.push({
        id:          mas.id!,
        name:        mas.name!,
        description: mas.description ?? "",
        price:       mas.price ?? 0,
        unitPrice:   mas.unitPrice,
        packaging:   mas.packaging ?? "",
        origin:      "",
        method:      "",
        weight:      0,
        pack:        "",
        packType:    "",
        category:    mas.category ?? "UNCATEGORIZED",
        image:       "",
        oos:         false,
      });
    }
  }

  // 2. Items in existing list but NOT in MAS 200 → mark OOS
  for (const product of existing) {
    if (!mas200.has(product.id)) {
      merged.push({ ...product, oos: true });
    }
  }

  // Sort: in-stock first, then OOS; within each group sort by category then name
  merged.sort((a, b) => {
    if (a.oos !== b.oos) return a.oos ? 1 : -1;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });

  return merged;
}

export function getMAS200LastUpdated(): string | null {
  const csvPath = path.join(process.cwd(), "data", "mas200.csv");
  if (!fs.existsSync(csvPath)) return null;
  const stat = fs.statSync(csvPath);
  return stat.mtime.toISOString();
}
