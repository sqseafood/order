import fs from "fs";
import path from "path";
import type { Product } from "@/types";

// ── PRN parser (fixed-width MAS 200 price list report) ──────────────────────
// Column layout based on "NEW PRICE LIST" report format:
//   0-30   DESCRIPTION
//   31-46  ITEM#
//   47-57  ORIGIN
//   58-67  MOC (WILD/FARMED)
//   68-88  PACKAGING + WEIGHT  (parsed with regex at end of line)
//   last two decimals: U.PRICE  CASE PRICE

function parsePRNLine(line: string): Partial<Product> | null {
  // Skip header/blank lines
  if (!line.trim()) return null;
  if (/^(Run Date|R\/M Date|DESCRIPTION|Page)/.test(line.trim())) return null;

  // Item code starts at col 31 — must be uppercase letters+digits, len 4-8
  const itemCode = line.substring(31, 47).trim();
  if (!/^[A-Z][A-Z0-9]{2,7}$/.test(itemCode)) return null;

  // Extract the two prices from the end of the line (e.g. "  5.60  224.00")
  const priceMatch = line.match(/([\d]+\.[\d]{2})\s+([\d]+\.[\d]{2})\s*$/);
  if (!priceMatch) return null;

  const unitPrice = parseFloat(priceMatch[1]);
  const casePrice = parseFloat(priceMatch[2]);

  // Skip items with $0 case price (non-sellable / packaging items)
  if (casePrice === 0) return null;

  const name      = line.substring(0, 31).trim();
  const origin    = line.substring(47, 58).trim();
  const method    = line.substring(58, 68).trim();           // WILD / FARMED
  const packaging = line.substring(68, 89).trim()
                        .replace(/\s{2,}.+$/, "")            // strip weight part
                        .trim();
  const weightStr = line.substring(79, 89).trim();
  // Weight col overlaps packaging — grab last standalone number before prices
  const weightMatch = line
    .substring(68, line.length - priceMatch[0].length)
    .match(/\s+(\d+\.?\d*)\s*$/);
  const weight = weightMatch ? parseFloat(weightMatch[1]) : 0;

  // Clean up packaging: it's in cols 68-78 roughly
  const packStr = line.substring(68, 79).trim();

  return {
    id:        itemCode,
    name,
    description: "",
    price:     casePrice,
    unitPrice,
    packaging: packStr || weightStr,
    origin,
    method:    method || undefined,
    weight,
    pack:      "",
    packType:  "",
    category:  "SEAFOOD",
    image:     "",
    oos:       false,
  };
}

function parseMAS200PRN(): Map<string, Partial<Product>> | null {
  const prnPath = path.join(process.cwd(), "data", "mas200.prn");
  if (!fs.existsSync(prnPath)) return null;

  const lines = fs.readFileSync(prnPath, "utf-8").split(/\r?\n/);
  const result = new Map<string, Partial<Product>>();

  for (const line of lines) {
    const item = parsePRNLine(line);
    if (item?.id) result.set(item.id, item);
  }

  return result.size > 0 ? result : null;
}

// ── CSV parser (fallback if someone exports a CSV instead) ──────────────────
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  fields.push(current.trim());
  return fields;
}

function parseMAS200CSV(): Map<string, Partial<Product>> | null {
  const csvPath = path.join(process.cwd(), "data", "mas200.csv");
  if (!fs.existsSync(csvPath)) return null;

  const lines = fs.readFileSync(csvPath, "utf-8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_]/g, ""));
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n.toLowerCase().replace(/[\s_]/g, ""));
      if (i !== -1) return i;
    }
    return -1;
  };

  const colItemCode = idx("itemcode", "item_code", "itemnumber", "item");
  const colDesc     = idx("itemdescription", "description", "itemdesc", "desc");
  const colPrice    = idx("standardprice", "price", "salesprice", "unitprice");
  const colCost     = idx("standardcost", "cost", "averagecost");
  const colCategory = idx("productline", "category", "productlinecode");
  const colUOM      = idx("standardunitofmeasure", "unitofmeasure", "uom");

  const result = new Map<string, Partial<Product>>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const itemCode = (colItemCode >= 0 ? cols[colItemCode] : "").trim();
    if (!itemCode) continue;
    const price = colPrice >= 0 ? parseFloat(cols[colPrice]) || 0 : 0;
    const cost  = colCost  >= 0 ? parseFloat(cols[colCost])  || 0 : 0;
    result.set(itemCode, {
      id: itemCode,
      name: colDesc >= 0 ? cols[colDesc].trim() : itemCode,
      description: "",
      price,
      unitPrice: cost > 0 ? cost : price,
      packaging: colUOM >= 0 ? cols[colUOM].trim() : "",
      category: colCategory >= 0 ? cols[colCategory].trim() : "SEAFOOD",
      image: "", oos: false,
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
  // PRN takes priority, fall back to CSV
  const mas200 = parseMAS200PRN() ?? parseMAS200CSV();
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
  for (const name of ["mas200.prn", "mas200.csv"]) {
    const p = path.join(process.cwd(), "data", name);
    if (fs.existsSync(p)) return fs.statSync(p).mtime.toISOString();
  }
  return null;
}
