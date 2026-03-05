import fs from "fs";
import path from "path";

export interface MAS200Item {
  id: string;
  name: string;
  description: string;
  price: number;
  unitPrice: number;
  packaging: string;
  origin: string;
  method: string;
  weight: number;
  pack: string;
  packType: string;
  category: string;
  image: string;
}

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

export function loadMAS200Products(): MAS200Item[] | null {
  const csvPath = path.join(process.cwd(), "data", "mas200.csv");
  if (!fs.existsSync(csvPath)) return null;

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  // Build header index map (case-insensitive)
  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));

  const idx = (names: string[]): number => {
    for (const n of names) {
      const i = headers.indexOf(n.toLowerCase().replace(/\s+/g, ""));
      if (i !== -1) return i;
    }
    return -1;
  };

  // Map common MAS 200 VI export field names to our fields
  const colItemCode   = idx(["itemcode", "item_code", "itemnumber", "item"]);
  const colDesc       = idx(["itemdescription", "description", "itemdesc", "desc"]);
  const colDesc2      = idx(["itemdescription2", "description2", "extendeddesc"]);
  const colPrice      = idx(["standardprice", "price", "salesprice", "unitprice"]);
  const colCost       = idx(["standardcost", "cost", "averagecost"]);
  const colCategory   = idx(["productline", "category", "productlinecode"]);
  const colQty        = idx(["quantityonhand", "qtyonhand", "onhand", "qty"]);
  const colUOM        = idx(["standardunitofmeasure", "unitofmeasure", "uom"]);

  const products: MAS200Item[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols.length || !cols[0]) continue;

    const itemCode = colItemCode >= 0 ? cols[colItemCode] : "";
    if (!itemCode) continue;

    const price = colPrice >= 0 ? parseFloat(cols[colPrice]) || 0 : 0;
    const cost  = colCost  >= 0 ? parseFloat(cols[colCost])  || 0 : 0;

    products.push({
      id:          itemCode,
      name:        colDesc  >= 0 ? cols[colDesc]  : itemCode,
      description: colDesc2 >= 0 ? cols[colDesc2] : "",
      price:       price,
      unitPrice:   cost > 0 ? cost : price,
      packaging:   colUOM  >= 0 ? cols[colUOM]  : "",
      origin:      "",
      method:      "",
      weight:      0,
      pack:        "",
      packType:    "",
      category:    colCategory >= 0 ? cols[colCategory] : "UNCATEGORIZED",
      image:       "",
    });
  }

  return products.length > 0 ? products : null;
}

export function getMAS200LastUpdated(): string | null {
  const csvPath = path.join(process.cwd(), "data", "mas200.csv");
  if (!fs.existsSync(csvPath)) return null;
  const stat = fs.statSync(csvPath);
  return stat.mtime.toISOString();
}
