import fs from "fs";
import path from "path";
import { list } from "@vercel/blob";
import type { Product } from "@/types";

// ── PRN parser (fixed-width MAS 200 price list report) ──────────────────────
// Column layout based on "INTERNAL USE INVENTORY REPORT" format:
//   1-5    ITEM NUMBER
//   9-11   WHS (warehouse, always 000)
//   14-39  DESCRIPTION (English)
//   40-60  VIETNAMESE DESCRIPTION (ignored)
//   61-70  ORIGIN COUNTRY
//   72-83  PACKAGING
//   end:   UNIT PRICE  QTY  C.PRICE  (QTY is an integer between the two prices)

function parsePRNLine(line: string): Partial<Product> | null {
  if (!line.trim()) return null;

  // Data lines start with a space then an item code (e.g. " C0029   000  …")
  // followed by a 3-digit warehouse code. Non-data lines (headers, titles) won't match.
  const itemMatch = line.match(/^\s([A-Z][A-Z0-9]{2,7})\s+\d{3}\s+/);
  if (!itemMatch) return null;

  const itemCode = itemMatch[1];

  // Extract UNIT PRICE, QTY (integer), and C.PRICE from end of line
  // e.g. "  5.60      341  224.00"
  const priceMatch = line.match(/(\d+\.\d{2})\s+(\d+)\s+(\d+\.\d{2})\s*$/);
  if (!priceMatch) return null;

  const unitPrice = parseFloat(priceMatch[1]);
  const casePrice = parseFloat(priceMatch[3]);

  // Skip items with $0 case price (non-sellable / placeholder items)
  if (casePrice === 0) return null;

  // Fixed-width column extraction
  const name      = line.substring(14, 40).trim();
  const origin    = line.substring(61, 71).trim();
  const packaging = line.substring(72, 84).trim();

  return {
    id:        itemCode,
    name:      name || itemCode,
    description: "",
    price:     casePrice,
    unitPrice,
    packaging,
    origin,
    method:    undefined,
    weight:    0,
    pack:      "",
    packType:  "",
    category:  "SEAFOOD",
    image:     "",
    oos:       false,
  };
}

function parsePRNContent(content: string): Map<string, Partial<Product>> {
  const result = new Map<string, Partial<Product>>();
  for (const line of content.split(/\r?\n/)) {
    const item = parsePRNLine(line);
    if (item?.id) result.set(item.id, item);
  }
  return result;
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

// ── Blob-aware loader ────────────────────────────────────────────────────────
async function getMAS200Map(): Promise<Map<string, Partial<Product>> | null> {
  // 1. Try Vercel Blob (uploaded via admin)
  try {
    const { blobs } = await list({ prefix: "mas200.prn" });
    const blob = blobs.find((b) => b.pathname === "mas200.prn");
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const map = parsePRNContent(await res.text());
        if (map.size > 0) return map;
      }
    }
  } catch {}

  // 2. Fall back to local PRN file
  const prnPath = path.join(process.cwd(), "data", "mas200.prn");
  if (fs.existsSync(prnPath)) {
    const map = parsePRNContent(fs.readFileSync(prnPath, "utf-8"));
    if (map.size > 0) return map;
  }

  // 3. Fall back to CSV
  return parseMAS200CSV();
}

function applyMAS200Map(existing: Product[], mas200: Map<string, Partial<Product>>): Product[] {
  // Deduplicate by ID, keeping first occurrence
  const seen = new Set<string>();
  const deduped = existing.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  const existingMap = new Map(deduped.map((p) => [p.id, p]));
  const merged: Product[] = [];

  // 1. All items currently in MAS 200 → in stock
  for (const [id, mas] of mas200) {
    const known = existingMap.get(id);
    if (known) {
      merged.push({
        ...known,
        price:     mas.price     ?? known.price,
        unitPrice: mas.unitPrice ?? known.unitPrice,
        oos:       false,
      });
    } else {
      merged.push({
        id:          mas.id!,
        name:        mas.name!,
        description: mas.description ?? "",
        price:       mas.price ?? 0,
        unitPrice:   mas.unitPrice,
        packaging:   mas.packaging ?? "",
        origin:      mas.origin ?? "",
        method:      mas.method ?? "",
        weight:      mas.weight ?? 0,
        pack:        mas.pack ?? "",
        packType:    mas.packType ?? "",
        category:    mas.category ?? "UNCATEGORIZED",
        image:       "",
        oos:         false,
      });
    }
  }

  // 2. Items in existing list but NOT in MAS 200 → mark OOS
  for (const product of deduped) {
    if (!mas200.has(product.id)) {
      merged.push({ ...product, oos: true });
    }
  }

  merged.sort((a, b) => {
    if (a.oos !== b.oos) return a.oos ? 1 : -1;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });

  return merged;
}

/**
 * Merges MAS 200 live inventory with the existing products list.
 * Checks Vercel Blob first (admin-uploaded), falls back to local file.
 */
export async function mergeMAS200WithProducts(existing: Product[]): Promise<Product[] | null> {
  const mas200 = await getMAS200Map();
  if (!mas200) return null;
  return applyMAS200Map(existing, mas200);
}

export async function getMAS200LastUpdated(): Promise<string | null> {
  try {
    const { blobs } = await list({ prefix: "mas200.prn" });
    const blob = blobs.find((b) => b.pathname === "mas200.prn");
    if (blob) return new Date(blob.uploadedAt).toISOString();
  } catch {}
  for (const name of ["mas200.prn", "mas200.csv"]) {
    const p = path.join(process.cwd(), "data", name);
    if (fs.existsSync(p)) return fs.statSync(p).mtime.toISOString();
  }
  return null;
}
