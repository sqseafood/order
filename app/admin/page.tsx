"use client";

import { useRef, useState, useCallback } from "react";
import type { Product } from "@/types";

type ParsedProduct = Product & { image: string };
type Status = { type: "success" | "error"; message: string } | null;

// ── Case-price formula ────────────────────────────────────────────────────────
// packaging examples:
//   "30 X 14 OZ"  → case = N × unitPrice        (price is per bag/pack)
//   "12 X 2 LB"   → case = (N × M) × unitPrice  (price is per lb)
//   "1 X 40 LB"   → case = 40 × unitPrice
//   "20 X 2.5#"   → case = 50 × unitPrice
function calcCasePrice(unitPrice: number, packaging: string): number {
  const m = packaging.match(/(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\s*(oz|lb|lbs|#|pc)/i);
  if (!m) return unitPrice;
  const n = parseFloat(m[1]);
  const qty = parseFloat(m[2]);
  const unit = m[3].toLowerCase();
  if (unit === "oz") return +(n * unitPrice).toFixed(2);          // per-bag pricing
  return +(n * qty * unitPrice).toFixed(2);                       // per-lb pricing
}

// ── SeaQuest TSV parser ───────────────────────────────────────────────────────
// Col:  0=name  1=vietnamese  2=item#  3=unitPrice  4=packaging
//       5=origin  6=method  7=weight  8=pack  9=packType  10=casePrice
const SKIP_SECTIONS = ["NEW JERSEY WAREHOUSE", "NJ WAREHOUSE", "MIAMI WAREHOUSE"];

function toTitleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseSeaQuestTSV(text: string): ParsedProduct[] {
  const lines = text.split(/\r?\n/);
  const products: ParsedProduct[] = [];
  let category = "";
  let skip = false;
  const seen = new Set<string>();

  for (const line of lines) {
    const cols = line.split("\t").map((c) => c.trim());
    const first = cols[0] ?? "";

    // Section header
    if (/^[?▶]/.test(first)) {
      const raw = first.replace(/^[?▶\s]+/, "").trim().toUpperCase();
      if (SKIP_SECTIONS.some((s) => raw.includes(s))) { skip = true; continue; }
      skip = false;
      if (raw && raw !== "FISH - SPECIALTY") category = toTitleCase(raw);
      continue;
    }

    if (skip || !first || first.toLowerCase() === "product description") continue;

    const name      = cols[0] ?? "";
    const viet      = cols[1] ?? "";
    const id        = cols[2] ?? "";
    const rawUnit   = cols[3] ?? "";
    const packaging = cols[4] ?? "";
    const origin    = cols[5] ?? "";
    const method    = cols[6] ?? "";
    const rawWeight = cols[7] ?? "";
    const pack      = cols[8] ?? "";
    const packType  = cols[9] ?? "";
    const rawCase   = cols[10] ?? "";

    if (!id || !/^[A-Za-z]/.test(id)) continue;
    if (!rawUnit || rawUnit === "NJ" || rawUnit.includes("N/A")) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const isOOS = rawUnit === "OOS";
    const weight = parseFloat(rawWeight) || undefined;
    const description = viet && viet !== "0" && viet !== "#N/A" ? viet : name;

    if (isOOS) {
      products.push({
        id, name, description,
        price: 0,
        oos: true,
        packaging: packaging || undefined,
        origin: origin || undefined,
        method: method || undefined,
        weight,
        pack: pack || undefined,
        packType: packType || undefined,
        category: category || "Other",
        image: "",
      });
      continue;
    }

    const unitPrice = parseFloat(rawUnit.replace(/[^0-9.]/g, ""));
    if (isNaN(unitPrice) || unitPrice <= 0) continue;

    // Case price: use column value if valid, else calculate from packaging
    let casePrice: number;
    const rawCaseNum = parseFloat(rawCase.replace(/[^0-9.]/g, ""));
    if (!isNaN(rawCaseNum) && rawCaseNum > 0) {
      casePrice = rawCaseNum;
    } else if (packaging) {
      casePrice = calcCasePrice(unitPrice, packaging);
    } else {
      casePrice = unitPrice;
    }

    products.push({
      id, name, description,
      price: +casePrice.toFixed(2),
      unitPrice,
      packaging: packaging || undefined,
      origin: origin || undefined,
      method: method || undefined,
      weight,
      pack: pack || undefined,
      packType: packType || undefined,
      category: category || "Other",
      image: "",
    });
  }
  return products;
}

// ── Generic CSV parser ────────────────────────────────────────────────────────
const COL_ALIASES: Record<string, string[]> = {
  id:          ["id", "item #", "item#", "item_#", "sku", "code"],
  name:        ["name", "product description", "product_description"],
  price:       ["price", "case price", "case_price"],
  unitPrice:   ["unit price", "unit_price", "unitprice"],
  category:    ["category", "cat", "section"],
  description: ["description", "vietnamese", "desc"],
  packaging:   ["packaging", "pack size", "pack_size"],
  origin:      ["origin", "country", "country of origin"],
  method:      ["method", "catch method"],
  weight:      ["weight", "weight (lbs)", "weight(lbs)", "lbs"],
  pack:        ["pack", "pack#", "pack #"],
  packType:    ["pack type", "pack_type", "packtype"],
};

function findCol(headers: string[], field: string): number {
  return headers.findIndex((h) =>
    COL_ALIASES[field].includes(h.toLowerCase().trim())
  );
}

function parseCSV(text: string): ParsedProduct[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const rawHeaders = lines[0].split(",").map((h) => h.trim());
  const colIdx: Record<string, number> = {};
  for (const f of Object.keys(COL_ALIASES)) colIdx[f] = findCol(rawHeaders, f);
  for (const req of ["id", "name", "price", "category"]) {
    if (colIdx[req] === -1)
      throw new Error(`CSV is missing a "${req}" column. Found: ${rawHeaders.join(", ")}`);
  }
  return lines.slice(1).flatMap((line, i) => {
    const cols: string[] = [];
    let cur = ""; let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    const get = (f: string) => (colIdx[f] >= 0 ? cols[colIdx[f]] ?? "" : "").trim();
    const NON_PRICE = ["", "N/A", "#N/A", "OOS", "NJ", "MIA"];
    const rawUnit = get("unitPrice").toUpperCase();
    const rawCase = get("price").toUpperCase();
    if (rawUnit === "NJ" || rawUnit === "MIA") return [];
    const isOOS = rawUnit === "OOS" || rawCase === "OOS";
    if (!isOOS && NON_PRICE.includes(rawUnit) && NON_PRICE.includes(rawCase)) return [];
    const casePriceNum = parseFloat(rawCase.replace(/[^0-9.]/g, ""));
    const unitPriceNum = parseFloat(rawUnit.replace(/[^0-9.]/g, ""));
    const price = isOOS ? 0 : (!isNaN(casePriceNum) && casePriceNum > 0 ? casePriceNum : unitPriceNum);
    if (!isOOS && isNaN(price)) return [];
    const unitPrice = isOOS ? undefined : (isNaN(unitPriceNum) ? undefined : unitPriceNum);
    const weight = parseFloat(get("weight")) || undefined;
    return [{
      id: get("id"), name: get("name"),
      description: get("description") || get("name"),
      price, unitPrice,
      oos: isOOS || undefined,
      packaging: get("packaging") || undefined,
      origin:    get("origin")    || undefined,
      method:    get("method")    || undefined,
      weight,
      pack:      get("pack")      || undefined,
      packType:  get("packType")  || undefined,
      category:  get("category"), image: "",
    }];
  });
}

// ── JSON parser ───────────────────────────────────────────────────────────────
function parseJSON(text: string): ParsedProduct[] {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON must be an array of products.");
  return data.map((p, i) => {
    if (!p.id || !p.name || p.price === undefined || !p.category)
      throw new Error(`Item ${i + 1} is missing id, name, price, or category.`);
    return { ...p, image: p.image ?? "" };
  });
}

// ── Auto-detect ───────────────────────────────────────────────────────────────
function parseFile(text: string, fileName: string): ParsedProduct[] {
  if (fileName.toLowerCase().endsWith(".json")) return parseJSON(text);
  const first = text.split(/\r?\n/)[0] ?? "";
  const tabs = (first.match(/\t/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  return tabs > commas ? parseSeaQuestTSV(text) : parseCSV(text);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedProduct[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [uploading, setUploading] = useState(false);

  // Image upload state
  const [imgFiles, setImgFiles] = useState<File[]>([]);
  const [imgStatus, setImgStatus] = useState<Status>(null);
  const [imgUploading, setImgUploading] = useState(false);

  function handleFile(file: File) {
    setFileName(file.name);
    setPreview(null);
    setParseError(null);
    setStatus(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const products = parseFile(text, file.name);
        if (products.length === 0) throw new Error("No valid products found in the file.");
        setPreview(products);
      } catch (err) {
        setParseError((err as Error).message);
      }
    };
    reader.readAsText(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleUpload() {
    if (!preview) return;
    setUploading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setStatus({ type: "success", message: `✓ Menu updated — ${data.count} products saved.` });
      setPreview(null);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setStatus({ type: "error", message: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  const onImgChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) { setImgFiles(files); setImgStatus(null); }
  }, []);

  const onImgDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) { setImgFiles(files); setImgStatus(null); }
  }, []);

  async function handleImgUpload() {
    if (!imgFiles.length) return;
    setImgUploading(true);
    setImgStatus(null);
    try {
      const form = new FormData();
      imgFiles.forEach((f) => form.append("images", f));
      const res = await fetch("/api/admin/images", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setImgStatus({
        type: "success",
        message: `✓ ${data.matched} image${data.matched !== 1 ? "s" : ""} matched · ${data.unmatched} unmatched`,
      });
      setImgFiles([]);
      if (imgInputRef.current) imgInputRef.current.value = "";
    } catch (err) {
      setImgStatus({ type: "error", message: (err as Error).message });
    } finally {
      setImgUploading(false);
    }
  }

  const categories = preview ? Array.from(new Set(preview.map((p) => p.category))) : [];

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Product Manager</h1>
      <p className="text-sm text-gray-500 mb-6">
        Upload the SeaQuest price list (.txt/.tsv) or a .csv / .json file.
        OOS, NJ, and warehouse duplicates are skipped automatically.
        <strong className="text-gray-700"> Case price</strong> is used as the display price.
      </p>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 hover:border-orange-400 rounded-2xl p-8 text-center cursor-pointer transition-colors"
      >
        <input ref={inputRef} type="file" accept=".json,.csv,.txt,.tsv"
          className="hidden" onChange={onInputChange} />
        <div className="text-4xl mb-3">📂</div>
        <p className="text-sm font-medium text-gray-700">
          {fileName ?? "Click to browse or drag & drop"}
        </p>
        <p className="text-xs text-gray-400 mt-1">SeaQuest .txt / .tsv · CSV · JSON</p>
      </div>

      {parseError && (
        <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          <strong>Parse error:</strong> {parseError}
        </div>
      )}

      {preview && (
        <div className="mt-5 p-4 rounded-2xl bg-gray-50 border border-gray-200">
          <p className="text-sm font-semibold text-gray-800 mb-2">
            {preview.length} products · {categories.length} categories
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {categories.map((c) => (
              <span key={c} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{c}</span>
            ))}
          </div>
          <p className="text-xs text-gray-500 mb-1">Preview (first 5 items):</p>
          <div className="space-y-1.5">
            {preview.slice(0, 5).map((p) => (
              <div key={p.id} className="text-xs text-gray-700 flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 font-medium text-orange-600">Case ${p.price.toFixed(2)}</span>
              </div>
            ))}
            {preview.length > 5 && <p className="text-xs text-gray-400">…and {preview.length - 5} more</p>}
          </div>
          <button onClick={handleUpload} disabled={uploading}
            className="mt-4 w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors">
            {uploading ? "Saving…" : "Update Menu"}
          </button>
        </div>
      )}

      {status && (
        <div className={`mt-4 p-3 rounded-xl text-sm font-medium ${
          status.type === "success"
            ? "bg-green-50 border border-green-200 text-green-700"
            : "bg-red-50 border border-red-200 text-red-700"}`}>
          {status.message}
        </div>
      )}

      <div className="mt-8 p-4 rounded-2xl bg-blue-50 border border-blue-100 text-xs text-blue-800 space-y-1">
        <p className="font-semibold mb-2">How to export from Excel:</p>
        <p>1. Open your SeaQuest price list in Excel</p>
        <p>2. File → Save As → <strong>Text (Tab delimited) (.txt)</strong></p>
        <p>3. Upload that .txt file here</p>
        <p className="pt-1 text-blue-600">All columns (packaging, origin, method, weight, case price) are imported automatically.</p>
      </div>

      {/* ── Image Upload ── */}
      <div className="mt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Product Images</h2>
        <p className="text-sm text-gray-500 mb-4">
          Name each image file after its item number (e.g. <strong className="text-gray-700">F0296.jpg</strong>).
          Images are matched automatically by item number.
        </p>

        <div
          onDrop={onImgDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => imgInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 hover:border-orange-400 rounded-2xl p-8 text-center cursor-pointer transition-colors"
        >
          <input ref={imgInputRef} type="file" accept="image/*" multiple
            className="hidden" onChange={onImgChange} />
          <div className="text-4xl mb-3">🖼️</div>
          <p className="text-sm font-medium text-gray-700">
            {imgFiles.length > 0 ? `${imgFiles.length} image${imgFiles.length !== 1 ? "s" : ""} selected` : "Click to browse or drag & drop"}
          </p>
          <p className="text-xs text-gray-400 mt-1">JPG · PNG · WebP · any image format</p>
        </div>

        {imgFiles.length > 0 && (
          <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">Selected files:</p>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {imgFiles.map((f) => (
                <div key={f.name} className="text-xs text-gray-700 flex justify-between gap-2">
                  <span className="truncate font-mono">{f.name}</span>
                  <span className="shrink-0 text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                </div>
              ))}
            </div>
            <button onClick={handleImgUpload} disabled={imgUploading}
              className="mt-3 w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors">
              {imgUploading ? "Uploading…" : "Upload Images"}
            </button>
          </div>
        )}

        {imgStatus && (
          <div className={`mt-4 p-3 rounded-xl text-sm font-medium ${
            imgStatus.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"}`}>
            {imgStatus.message}
          </div>
        )}
      </div>
    </div>
  );
}
