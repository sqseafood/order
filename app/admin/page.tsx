"use client";

import { useRef, useState, useCallback, Fragment } from "react";
import type { Product } from "@/types";
import type { StoredOrder } from "@/app/api/orders/route";

type ParsedProduct = Product & { image: string };
type Status = { type: "success" | "error"; message: string } | null;

interface CustomerRecord {
  name: string;
  phone: string;
  email: string;
  firstOrderAt: string;
  lastOrderAt: string;
  orderCount: number;
}

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

  // PRN upload state
  const prnInputRef = useRef<HTMLInputElement>(null);
  const [prnFile, setPrnFile] = useState<File | null>(null);
  const [prnUploading, setPrnUploading] = useState(false);
  const [prnStatus, setPrnStatus] = useState<Status>(null);

  async function handlePrnUpload() {
    if (!prnFile) return;
    setPrnUploading(true);
    setPrnStatus(null);
    try {
      const form = new FormData();
      form.append("file", prnFile);
      const res = await fetch("/api/admin/pricelist", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setPrnStatus({ type: "success", message: `✓ Price list updated — ${data.count} products loaded.` });
      setPrnFile(null);
      if (prnInputRef.current) prnInputRef.current.value = "";
    } catch (err) {
      setPrnStatus({ type: "error", message: (err as Error).message });
    } finally {
      setPrnUploading(false);
    }
  }

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

  const [tab, setTab] = useState<"products" | "catalog" | "items" | "customers" | "notifications" | "orders">("products");

  // ── Orders tab state ───────────────────────────────────────────────────────
  const [ordersData, setOrdersData] = useState<StoredOrder[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [ordersActionId, setOrdersActionId] = useState<string | null>(null);
  const [showRestoreForm, setShowRestoreForm] = useState(false);
  const [restorePickup, setRestorePickup] = useState("");
  const [restoreName, setRestoreName] = useState("");
  const [restorePhone, setRestorePhone] = useState("");
  const [restoreEmail, setRestoreEmail] = useState("");
  const [restoreTotal, setRestoreTotal] = useState("");
  const [restoreNote, setRestoreNote] = useState("");
  const [restoreSaving, setRestoreSaving] = useState(false);

  async function loadAdminOrders() {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const res = await fetch(`/api/admin/orders?t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to load orders.");
      const data: StoredOrder[] = await res.json();
      data.sort((a, b) => {
        const rank: Record<StoredOrder["status"], number> = { new: 0, processing: 1, done: 2 };
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime();
      });
      setOrdersData(data);
    } catch (err) {
      setOrdersError((err as Error).message);
    } finally {
      setOrdersLoading(false);
    }
  }

  async function restoreOrder() {
    if (!restorePickup.trim() || !restoreName.trim()) return;
    setRestoreSaving(true);
    setOrdersError(null);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupNumber: restorePickup.trim(),
          customer: { name: restoreName.trim(), phone: restorePhone.trim(), email: restoreEmail.trim() },
          total: parseFloat(restoreTotal) || 0,
          note: restoreNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restore order.");
      setShowRestoreForm(false);
      setRestorePickup(""); setRestoreName(""); setRestorePhone("");
      setRestoreEmail(""); setRestoreTotal(""); setRestoreNote("");
      await loadAdminOrders();
    } catch (err) {
      setOrdersError((err as Error).message);
    } finally {
      setRestoreSaving(false);
    }
  }

  async function forceOrderStatus(id: string, status: StoredOrder["status"]) {
    setOrdersActionId(id);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update order.");
      const updated = data.order as StoredOrder;
      setOrdersData((prev) => {
        if (!prev) return prev;
        const next = prev.map((o) => (o.id === id ? updated : o));
        next.sort((a, b) => {
          const rank: Record<StoredOrder["status"], number> = { new: 0, processing: 1, done: 2 };
          if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
          return new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime();
        });
        return next;
      });
    } catch (err) {
      setOrdersError((err as Error).message);
    } finally {
      setOrdersActionId(null);
    }
  }

  // ── Catalog tab state ──────────────────────────────────────────────────────
  const [catalogItems, setCatalogItems] = useState<Product[] | null>(null);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [categoryEdits, setCategoryEdits] = useState<Record<string, string>>({});
  const [packEdits, setPackEdits] = useState<Record<string, string>>({});
  const [packTypeEdits, setPackTypeEdits] = useState<Record<string, string>>({});
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState<Status>(null);

  async function loadCatalog() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(`/api/products?t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to load products.");
      const all: Product[] = await res.json();
      const newItems = all.filter((p) => p.category === "SEAFOOD");
      const cats = Array.from(
        new Set(all.filter((p) => p.category !== "SEAFOOD").map((p) => p.category))
      ).sort();
      setCatalogItems(newItems);
      setAllCategories(cats);
      const edits: Record<string, string> = {};
      const packs: Record<string, string> = {};
      const packTypes: Record<string, string> = {};
      for (const p of newItems) { edits[p.id] = ""; packs[p.id] = ""; packTypes[p.id] = ""; }
      setCategoryEdits(edits);
      setPackEdits(packs);
      setPackTypeEdits(packTypes);
    } catch (err) {
      setCatalogError((err as Error).message);
    } finally {
      setCatalogLoading(false);
    }
  }

  async function saveCategoryEdits() {
    const updates = Object.entries(categoryEdits)
      .filter(([, cat]) => cat.trim() !== "")
      .map(([id, category]) => ({
        id,
        category: category.trim().toUpperCase(),
        pack: (packEdits[id] ?? "").trim(),
        packType: (packTypeEdits[id] ?? "").trim(),
      }));
    if (!updates.length) {
      setCatalogStatus({ type: "error", message: "Select at least one category before saving." });
      return;
    }
    setCatalogSaving(true);
    setCatalogStatus(null);
    try {
      const res = await fetch("/api/admin/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      setCatalogStatus({
        type: "success",
        message: `✓ ${data.updated} item${data.updated !== 1 ? "s" : ""} categorized.`,
      });
      await loadCatalog();
    } catch (err) {
      setCatalogStatus({ type: "error", message: (err as Error).message });
    } finally {
      setCatalogSaving(false);
    }
  }

  // ── Items tab state ────────────────────────────────────────────────────────
  const [allItems, setAllItems] = useState<Product[] | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsSearch, setItemsSearch] = useState("");
const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPack, setEditPack] = useState("");
  const [editPackType, setEditPackType] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function loadItems() {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const res = await fetch(`/api/products?t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to load.");
      setAllItems(await res.json());
    } catch (err) {
      setItemsError((err as Error).message);
    } finally {
      setItemsLoading(false);
    }
  }

  async function deleteItem(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch("/api/admin/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed.");
      }
      setAllItems((prev) => prev ? prev.filter((p) => p.id !== id) : prev);
    } catch (err) {
      setItemsError((err as Error).message);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  function downloadProducts() {
    if (!allItems) return;
    const blob = new Blob([JSON.stringify(allItems, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveItemEdit(id: string) {
    setEditSaving(true);
    try {
      const res = await fetch("/api/admin/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: [{ id, category: editCategory, pack: editPack, packType: editPackType }] }),
      });
      if (!res.ok) throw new Error("Save failed.");
      setAllItems((prev) =>
        prev ? prev.map((p) =>
          p.id === id ? { ...p, category: editCategory || p.category, pack: editPack, packType: editPackType } : p
        ) : prev
      );
      setEditingId(null);
    } catch (err) {
      setItemsError((err as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  const [customers, setCustomers] = useState<CustomerRecord[] | null>(null);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);

  interface WaitlistEntry { productId: string; productName: string; email: string; signedUpAt: string; }
  const [waitlist, setWaitlist] = useState<WaitlistEntry[] | null>(null);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  async function loadWaitlist() {
    setWaitlistLoading(true);
    setWaitlistError(null);
    try {
      const res = await fetch("/api/notify-me");
      if (!res.ok) throw new Error("Failed to load.");
      setWaitlist(await res.json());
    } catch (err) {
      setWaitlistError((err as Error).message);
    } finally {
      setWaitlistLoading(false);
    }
  }

  async function loadCustomers() {
    setCustomersLoading(true);
    setCustomersError(null);
    try {
      const res = await fetch("/api/admin/customers");
      if (!res.ok) throw new Error("Failed to load.");
      setCustomers(await res.json());
    } catch (err) {
      setCustomersError((err as Error).message);
    } finally {
      setCustomersLoading(false);
    }
  }

  function exportCSV() {
    if (!customers?.length) return;
    const header = "Name,Phone,Email,Orders,First Order,Last Order";
    const rows = customers.map((c) =>
      [c.name, c.phone, c.email, c.orderCount,
        new Date(c.firstOrderAt).toLocaleDateString("en-US"),
        new Date(c.lastOrderAt).toLocaleDateString("en-US"),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seaquest-customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    window.location.href = "/admin/login";
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 flex-wrap">
        {(["products", "catalog", "items", "customers", "notifications", "orders"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "customers" && !customers) loadCustomers();
              if (t === "notifications" && !waitlist) loadWaitlist();
              if (t === "catalog" && !catalogItems) loadCatalog();
              if (t === "items" && !allItems) loadItems();
              if (t === "orders") loadAdminOrders();
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "products" ? "Upload"
              : t === "catalog" ? (
                <span className="relative">
                  Catalog
                  {catalogItems && catalogItems.length > 0 && (
                    <span className="ml-1 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {catalogItems.length}
                    </span>
                  )}
                </span>
              )
              : t === "items" ? "Items"
              : t === "customers" ? "Customers"
              : t === "notifications" ? "Notify"
              : "Orders"}
          </button>
        ))}
      </div>

      {tab === "products" && <>
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

      {/* ── MAS 200 PRN Upload ── */}
      <div className="mt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-1">MAS 200 Inventory</h2>
        <p className="text-sm text-gray-500 mb-4">
          Upload the <strong className="text-gray-700">mas200.prn</strong> file exported from MAS 200 to update prices and stock status instantly.
        </p>
        <div
          onClick={() => prnInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 hover:border-orange-400 rounded-2xl p-8 text-center cursor-pointer transition-colors"
        >
          <input ref={prnInputRef} type="file" accept=".prn,.txt"
            className="hidden" onChange={(e) => setPrnFile(e.target.files?.[0] ?? null)} />
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm font-medium text-gray-700">
            {prnFile ? prnFile.name : "Click to browse for mas200.prn"}
          </p>
          <p className="text-xs text-gray-400 mt-1">.prn or .txt</p>
        </div>
        {prnFile && (
          <button onClick={handlePrnUpload} disabled={prnUploading}
            className="mt-3 w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors">
            {prnUploading ? "Uploading…" : "Update Inventory"}
          </button>
        )}
        {prnStatus && (
          <div className={`mt-4 p-3 rounded-xl text-sm font-medium ${
            prnStatus.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"}`}>
            {prnStatus.message}
          </div>
        )}
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
      </>}

      {/* Catalog tab — assign categories to new MAS 200 items */}
      {tab === "catalog" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              New items from MAS 200 that need a category assigned.
            </p>
            <button
              onClick={loadCatalog}
              disabled={catalogLoading}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {catalogLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {catalogError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
              {catalogError}
            </div>
          )}

          {catalogLoading && (
            <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
          )}

          {!catalogLoading && catalogItems && catalogItems.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              All products have categories assigned.
            </div>
          )}

          {!catalogLoading && catalogItems && catalogItems.length > 0 && (
            <div>
              {/* Search */}
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Search by name or item#…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 mb-3 focus:outline-none focus:border-orange-400"
              />

              <div className="rounded-2xl border border-gray-200 overflow-hidden mb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-3 py-2.5">Item#</th>
                        <th className="text-left px-3 py-2.5">Name</th>
                        <th className="text-left px-3 py-2.5 w-36">Category</th>
                        <th className="text-left px-3 py-2.5 w-24">Pack</th>
                        <th className="text-left px-3 py-2.5 w-24">Pack Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {catalogItems
                        .filter((p) => {
                          const q = catalogSearch.toLowerCase();
                          return !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
                        })
                        .map((p) => (
                          <tr key={p.id} className="bg-white hover:bg-gray-50">
                            <td className="px-3 py-2.5 font-mono text-gray-500 whitespace-nowrap">{p.id}</td>
                            <td className="px-3 py-2.5 font-medium text-gray-900">{p.name}</td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                list={`cat-${p.id}`}
                                value={categoryEdits[p.id] ?? ""}
                                onChange={(e) =>
                                  setCategoryEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                placeholder="Pick or type…"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-400"
                              />
                              <datalist id={`cat-${p.id}`}>
                                {allCategories.map((c) => (
                                  <option key={c} value={c} />
                                ))}
                              </datalist>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={packEdits[p.id] ?? ""}
                                onChange={(e) =>
                                  setPackEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                placeholder="e.g. VP"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-400"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                list="packtype-list"
                                value={packTypeEdits[p.id] ?? ""}
                                onChange={(e) =>
                                  setPackTypeEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                placeholder="e.g. Retail"
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-400"
                              />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <datalist id="packtype-list">
                    {["Retail", "Bulk", "VP", "IWP", "IVP", "Box", "Tray"].map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </div>
                <div className="bg-gray-50 px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                  {catalogItems.length} item{catalogItems.length !== 1 ? "s" : ""} need categorizing
                  {" · "}
                  {Object.values(categoryEdits).filter((v) => v.trim()).length} assigned
                </div>
              </div>

              <button
                onClick={saveCategoryEdits}
                disabled={catalogSaving}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                {catalogSaving
                  ? "Saving…"
                  : `Save Categories (${Object.values(categoryEdits).filter((v) => v.trim()).length} assigned)`}
              </button>

              {catalogStatus && (
                <div
                  className={`mt-4 p-3 rounded-xl text-sm font-medium ${
                    catalogStatus.type === "success"
                      ? "bg-green-50 border border-green-200 text-green-700"
                      : "bg-red-50 border border-red-200 text-red-700"
                  }`}
                >
                  {catalogStatus.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Items tab — search, edit, and remove products */}
      {tab === "items" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">All products. Edit pack/type or remove discontinued items.</p>
            <div className="flex gap-2">
              <button
                onClick={loadItems}
                disabled={itemsLoading}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {itemsLoading ? "Loading…" : "Refresh"}
              </button>
              {allItems && (
                <button
                  onClick={downloadProducts}
                  className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  Download
                </button>
              )}
            </div>
          </div>

          {itemsError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
              {itemsError}
            </div>
          )}

          {itemsLoading && <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>}

          {!itemsLoading && allItems && (
            <div>
              <input
                type="text"
                value={itemsSearch}
                onChange={(e) => { setItemsSearch(e.target.value); setConfirmDeleteId(null); setEditingId(null); }}
                placeholder="Search by name or item#…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 mb-3 focus:outline-none focus:border-orange-400"
              />

              {(() => {
                const q = itemsSearch.toLowerCase();
                const visible = allItems.filter((p) =>
                  !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
                );
                const itemCategories = Array.from(new Set(allItems.map((p) => p.category))).sort();

                if (visible.length === 0) {
                  return <div className="text-center py-12 text-gray-400 text-sm">No items found.</div>;
                }

                return (
                  <div className="rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                          <tr>
                            <th className="text-left px-3 py-2.5">Item#</th>
                            <th className="text-left px-3 py-2.5">Name</th>
                            <th className="text-left px-3 py-2.5">Category</th>
                            <th className="px-3 py-2.5"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {visible.map((p) => (
                            <Fragment key={p.id}>
                              <tr className="bg-white hover:bg-gray-50">
                                <td className="px-3 py-2.5 font-mono text-gray-500 whitespace-nowrap">{p.id}</td>
                                <td className="px-3 py-2.5 text-gray-900">
                                  <div className="font-medium">{p.name}</div>
                                  <div className="flex gap-1 mt-0.5 flex-wrap">
                                    {p.oos && (
                                      <span className="text-[10px] bg-red-100 text-red-600 font-semibold px-1.5 py-0.5 rounded-full">OOS</span>
                                    )}
                                    {p.pack && (
                                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{p.pack}</span>
                                    )}
                                    {p.packType && (
                                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{p.packType}</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-gray-500">{p.category}</td>
                                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                  <div className="flex gap-1 justify-end">
                                    <button
                                      onClick={() => {
                                        if (editingId === p.id) { setEditingId(null); return; }
                                        setEditingId(p.id);
                                        setEditCategory(p.category);
                                        setEditPack(p.pack ?? "");
                                        setEditPackType(p.packType ?? "");
                                        setConfirmDeleteId(null);
                                      }}
                                      className="text-[11px] text-blue-400 hover:text-blue-600 border border-blue-200 hover:border-blue-400 px-2 py-1 rounded-lg transition-colors"
                                    >
                                      {editingId === p.id ? "Cancel" : "Edit"}
                                    </button>
                                    {p.oos && (confirmDeleteId === p.id ? (
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => deleteItem(p.id)}
                                          disabled={deletingId === p.id}
                                          className="text-[11px] bg-red-500 hover:bg-red-600 text-white font-semibold px-2 py-1 rounded-lg disabled:opacity-50"
                                        >
                                          {deletingId === p.id ? "…" : "Confirm"}
                                        </button>
                                        <button
                                          onClick={() => setConfirmDeleteId(null)}
                                          className="text-[11px] text-gray-400 hover:text-gray-600 border border-gray-200 px-2 py-1 rounded-lg"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setConfirmDeleteId(p.id)}
                                        className="text-[11px] text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-1 rounded-lg transition-colors"
                                      >
                                        Remove
                                      </button>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                              {editingId === p.id && (
                                <tr className="bg-blue-50">
                                  <td colSpan={4} className="px-3 py-3">
                                    <div className="flex gap-2 flex-wrap">
                                      <div className="flex-1 min-w-[130px]">
                                        <label className="text-[10px] text-gray-500 uppercase font-semibold mb-1 block">Category</label>
                                        <input
                                          type="text"
                                          list="edit-cat-list"
                                          value={editCategory}
                                          onChange={(e) => setEditCategory(e.target.value)}
                                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-400"
                                        />
                                        <datalist id="edit-cat-list">
                                          {itemCategories.map((c) => <option key={c} value={c} />)}
                                        </datalist>
                                      </div>
                                      <div className="w-20">
                                        <label className="text-[10px] text-gray-500 uppercase font-semibold mb-1 block">Pack</label>
                                        <input
                                          type="text"
                                          value={editPack}
                                          onChange={(e) => setEditPack(e.target.value)}
                                          placeholder="e.g. VP"
                                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-400"
                                        />
                                      </div>
                                      <div className="w-24">
                                        <label className="text-[10px] text-gray-500 uppercase font-semibold mb-1 block">Pack Type</label>
                                        <input
                                          type="text"
                                          list="edit-packtype-list"
                                          value={editPackType}
                                          onChange={(e) => setEditPackType(e.target.value)}
                                          placeholder="e.g. Retail"
                                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-orange-400"
                                        />
                                        <datalist id="edit-packtype-list">
                                          {["Retail", "Bulk", "VP", "IWP", "IVP", "Box", "Tray"].map((v) => <option key={v} value={v} />)}
                                        </datalist>
                                      </div>
                                      <div className="flex items-end">
                                        <button
                                          onClick={() => saveItemEdit(p.id)}
                                          disabled={editSaving}
                                          className="text-[11px] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                                        >
                                          {editSaving ? "Saving…" : "Save"}
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="bg-gray-50 px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                      {allItems.filter((p) => p.oos).length} OOS · {allItems.length} total
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Customers tab */}
      {tab === "customers" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              All customers who have placed an order.
            </p>
            <div className="flex gap-2">
              <button
                onClick={loadCustomers}
                disabled={customersLoading}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {customersLoading ? "Loading…" : "Refresh"}
              </button>
              {customers && customers.length > 0 && (
                <button
                  onClick={exportCSV}
                  className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  Export CSV
                </button>
              )}
            </div>
          </div>

          {customersError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {customersError}
            </div>
          )}

          {customersLoading && (
            <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
          )}

          {!customersLoading && customers && customers.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">No customers yet.</div>
          )}

          {!customersLoading && customers && customers.length > 0 && (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2.5">Name</th>
                      <th className="text-left px-3 py-2.5">Phone</th>
                      <th className="text-left px-3 py-2.5">Email</th>
                      <th className="text-center px-3 py-2.5">Orders</th>
                      <th className="text-left px-3 py-2.5">Last Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customers.map((c, i) => (
                      <tr key={i} className="bg-white hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2.5 font-medium text-gray-900">{c.name}</td>
                        <td className="px-3 py-2.5 text-gray-600">{c.phone}</td>
                        <td className="px-3 py-2.5 text-gray-600">{c.email}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">
                            {c.orderCount}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500">
                          {new Date(c.lastOrderAt).toLocaleDateString("en-US")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-gray-50 px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                {customers.length} customer{customers.length !== 1 ? "s" : ""} total
              </div>
            </div>
          )}
        </div>
      )}
      {/* Orders tab — view and fix stuck orders */}
      {tab === "orders" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">Today's orders. Force-reset any stuck order.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRestoreForm((v) => !v)}
                className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                + Restore Order
              </button>
              <button
                onClick={loadAdminOrders}
                disabled={ordersLoading}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {ordersLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {showRestoreForm && (
            <div className="mb-4 p-4 rounded-2xl border border-orange-200 bg-orange-50 space-y-3">
              <p className="text-sm font-semibold text-gray-800">Restore Missing Order</p>
              <p className="text-xs text-gray-500">Enter the details from the confirmation email.</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-semibold text-gray-500 mb-1 block">Pickup # *</label>
                  <input
                    type="text"
                    value={restorePickup}
                    onChange={(e) => setRestorePickup(e.target.value)}
                    placeholder="e.g. 10023"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-semibold text-gray-500 mb-1 block">Order Total</label>
                  <input
                    type="number"
                    value={restoreTotal}
                    onChange={(e) => setRestoreTotal(e.target.value)}
                    placeholder="0.00"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-orange-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase font-semibold text-gray-500 mb-1 block">Customer Name *</label>
                <input
                  type="text"
                  value={restoreName}
                  onChange={(e) => setRestoreName(e.target.value)}
                  placeholder="Full name"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-orange-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-semibold text-gray-500 mb-1 block">Phone</label>
                  <input
                    type="text"
                    value={restorePhone}
                    onChange={(e) => setRestorePhone(e.target.value)}
                    placeholder="Phone number"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-semibold text-gray-500 mb-1 block">Email</label>
                  <input
                    type="email"
                    value={restoreEmail}
                    onChange={(e) => setRestoreEmail(e.target.value)}
                    placeholder="Email address"
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-orange-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase font-semibold text-gray-500 mb-1 block">Items (from email)</label>
                <textarea
                  value={restoreNote}
                  onChange={(e) => setRestoreNote(e.target.value)}
                  placeholder="Paste item list from the email here…"
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-orange-400 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={restoreOrder}
                  disabled={restoreSaving || !restorePickup.trim() || !restoreName.trim()}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  {restoreSaving ? "Restoring…" : "Restore Order"}
                </button>
                <button
                  onClick={() => setShowRestoreForm(false)}
                  className="px-4 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {ordersError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
              {ordersError}
            </div>
          )}

          {ordersLoading && <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>}

          {!ordersLoading && ordersData && ordersData.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">No orders today.</div>
          )}

          {!ordersLoading && ordersData && ordersData.length > 0 && (
            <div className="space-y-2">
              {ordersData.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-2xl border p-4 ${
                    order.status === "new"
                      ? "border-orange-200 bg-orange-50"
                      : order.status === "processing"
                      ? "border-blue-200 bg-blue-50"
                      : "border-gray-100 bg-white opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-lg font-black ${
                          order.status === "new" ? "text-orange-500"
                          : order.status === "processing" ? "text-blue-600"
                          : "text-gray-400"
                        }`}>
                          #{order.pickupNumber}
                        </span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          order.status === "new" ? "bg-orange-200 text-orange-700"
                          : order.status === "processing" ? "bg-blue-200 text-blue-700"
                          : "bg-green-100 text-green-700"
                        }`}>
                          {order.status}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{order.customer.name}</p>
                      <p className="text-xs text-gray-500">{order.customer.phone}</p>
                      {order.claimedBy && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {order.status === "done" ? "Completed" : "Claimed"} by {order.claimedBy}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">
                        {new Date(order.orderedAt).toLocaleTimeString("en-US", {
                          timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit"
                        })}
                        {" · "}${order.total.toFixed(2)}
                        {" · "}{order.items.length} item{order.items.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {order.status !== "new" && (
                        <button
                          onClick={() => forceOrderStatus(order.id, "new")}
                          disabled={ordersActionId === order.id}
                          className="text-[11px] text-orange-600 hover:text-orange-800 border border-orange-300 hover:border-orange-500 bg-white px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors font-medium"
                        >
                          {ordersActionId === order.id ? "…" : "Reset → New"}
                        </button>
                      )}
                      {order.status !== "processing" && (
                        <button
                          onClick={() => forceOrderStatus(order.id, "processing")}
                          disabled={ordersActionId === order.id}
                          className="text-[11px] text-blue-600 hover:text-blue-800 border border-blue-300 hover:border-blue-500 bg-white px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors font-medium"
                        >
                          {ordersActionId === order.id ? "…" : "Set → Processing"}
                        </button>
                      )}
                      {order.status !== "done" && (
                        <button
                          onClick={() => forceOrderStatus(order.id, "done")}
                          disabled={ordersActionId === order.id}
                          className="text-[11px] text-green-600 hover:text-green-800 border border-green-300 hover:border-green-500 bg-white px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors font-medium"
                        >
                          {ordersActionId === order.id ? "…" : "Mark → Done"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-center text-gray-400 pt-1">
                {ordersData.length} order{ordersData.length !== 1 ? "s" : ""} today
              </p>
            </div>
          )}
        </div>
      )}

      {/* Notifications tab */}
      {tab === "notifications" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">Customers waiting for OOS items to restock.</p>
            <button
              onClick={loadWaitlist}
              disabled={waitlistLoading}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {waitlistLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {waitlistError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {waitlistError}
            </div>
          )}

          {waitlistLoading && (
            <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
          )}

          {!waitlistLoading && waitlist && waitlist.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">No notifications signed up yet.</div>
          )}

          {!waitlistLoading && waitlist && waitlist.length > 0 && (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2.5">Product</th>
                      <th className="text-left px-3 py-2.5">Email</th>
                      <th className="text-left px-3 py-2.5">Signed Up</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {waitlist.map((w, i) => (
                      <tr key={i} className="bg-white hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-gray-900 truncate max-w-[160px]">{w.productName}</div>
                          <div className="text-gray-400 font-mono">{w.productId}</div>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{w.email}</td>
                        <td className="px-3 py-2.5 text-gray-500">
                          {new Date(w.signedUpAt).toLocaleDateString("en-US")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-gray-50 px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                {waitlist.length} notification{waitlist.length !== 1 ? "s" : ""} total
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
