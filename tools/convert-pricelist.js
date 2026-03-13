#!/usr/bin/env node
/**
 * Converts PriceList/PL_updated.xlsx → PriceList/output.csv
 * The output CSV is accepted directly by the ordering-app admin upload page.
 *
 * Usage:  node tools/convert-pricelist.js
 *         node tools/convert-pricelist.js path/to/input.xlsx path/to/output.csv
 */

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const inputPath  = process.argv[2] || path.join(__dirname, "../PriceList/PL_updated.xlsx");
const outputPath = process.argv[3] || path.join(__dirname, "../PriceList/output.csv");

// Read workbook
const wb = XLSX.readFile(inputPath, { cellNF: true });
const ws = wb.Sheets[wb.SheetNames[0]];

// Get raw rows — use raw:false so formatted strings are kept (e.g. "$3.25")
// but we also need raw values for numbers; use raw:true and handle formatting ourselves
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });

if (rows.length < 2) {
  console.error("Error: Excel file appears empty.");
  process.exit(1);
}

function csvCell(value) {
  const str = String(value ?? "").trim();
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Output columns (category is inserted at position 3, between Item # and Unit Price)
const OUTPUT_HEADER = [
  "Product Description",
  "Vietnamese",
  "Item #",
  "Category",
  "Unit Price",
  "Packaging",
  "Origin",
  "Method",
  "Weight (lbs)",
  "Pack",
  "Pack Type",
  "Case price",
];

// Excel column indices (0-based) in the source file
// Row 5 (index 5): Product Description, Vietnamese, Item #, Unit Price, Packaging, Origin, Method, Weight (lbs), Pack, Pack Type, Case price
const SRC_COLS = {
  name:        0,  // Product Description
  description: 1,  // Vietnamese
  id:          2,  // Item #
  unitPrice:   3,  // Unit Price
  packaging:   4,  // Packaging
  origin:      5,  // Origin
  method:      6,  // Method
  weight:      7,  // Weight (lbs)
  pack:        8,  // Pack
  packType:    9,  // Pack Type
  price:       10, // Case price
};

let currentCategory = "";
let headerFound = false;
const outputLines = [OUTPUT_HEADER.map(csvCell).join(",")];
let dataRows = 0;

for (const row of rows) {
  const first = String(row[0] ?? "").trim();

  // Detect category header rows (start with ▶)
  if (first.startsWith("▶")) {
    currentCategory = first.replace(/^▶\s*/, "").trim();
    continue;
  }

  // Detect and skip the column header row
  if (first === "Product Description") {
    headerFound = true;
    continue;
  }

  // Skip non-data rows (company info, blank rows, warehouse sub-headers)
  if (!headerFound) continue;
  if (!first || !currentCategory) continue;

  // Extract values from source columns
  const get = (col) => String(row[col] ?? "").trim();

  const name = get(SRC_COLS.name);
  if (!name) continue; // skip blank rows

  const outRow = [
    name,
    get(SRC_COLS.description),
    get(SRC_COLS.id),
    currentCategory,
    get(SRC_COLS.unitPrice),
    get(SRC_COLS.packaging),
    get(SRC_COLS.origin),
    get(SRC_COLS.method),
    get(SRC_COLS.weight),
    get(SRC_COLS.pack),
    get(SRC_COLS.packType),
    get(SRC_COLS.price),
  ];

  outputLines.push(outRow.map(csvCell).join(","));
  dataRows++;
}

fs.writeFileSync(outputPath, outputLines.join("\n"), "utf-8");

console.log(`✓ Converted ${dataRows} product rows`);
console.log(`✓ Output: ${outputPath}`);
console.log(`\nUpload this CSV at the ordering-app admin page to update the menu.`);
