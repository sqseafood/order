import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import type { StoredOrder } from "@/app/api/orders/route";
import { loadTodayOrders, saveOrder } from "@/app/api/orders/route";

export const dynamic = "force-dynamic";

function getTodayPrefix(): string {
  const pacificStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const d = new Date(pacificStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `order-${y}-${m}-${day}-`;
}

function prefixForDate(date: string): string {
  return `order-${date}-`;
}

// Legacy key for old daily-aggregate format (read-only)
function legacyKeyForDate(date: string): string {
  return `orders-${date}.json`;
}

async function loadOrdersForDate(date?: string): Promise<StoredOrder[]> {
  if (!date) return loadTodayOrders();

  try {
    const prefix = prefixForDate(date);
    const { blobs } = await list({ prefix });

    if (blobs.length > 0) {
      const results = await Promise.all(
        blobs
          .filter((b) => b.pathname.endsWith(".json"))
          .map(async (b) => {
            try {
              const res = await fetch(b.downloadUrl, { cache: "no-store" });
              if (res.ok) return (await res.json()) as StoredOrder;
            } catch {}
            return null;
          })
      );
      return results.filter(Boolean) as StoredOrder[];
    }

    // Fall back to legacy daily file
    const legacyKey = legacyKeyForDate(date);
    const { blobs: legacyBlobs } = await list({ prefix: legacyKey });
    const legacyBlob = legacyBlobs.find((b) => b.pathname === legacyKey);
    if (legacyBlob) {
      const res = await fetch(legacyBlob.downloadUrl, { cache: "no-store" });
      if (res.ok) return await res.json();
    }
  } catch {}
  return [];
}

// Load a single order by ID for a given date prefix
async function loadOneOrder(id: string, prefix: string): Promise<StoredOrder | null> {
  const key = `${prefix}${id}.json`;
  try {
    const { blobs } = await list({ prefix: key });
    const blob = blobs.find((b) => b.pathname === key);
    if (blob) {
      const res = await fetch(blob.downloadUrl, { cache: "no-store" });
      if (res.ok) return await res.json();
    }
  } catch {}
  return null;
}

// GET /api/admin/orders?date=2026-04-03  (date optional, defaults to today)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? undefined;
  const orders = await loadOrdersForDate(date);
  return NextResponse.json(orders);
}

// Parse the item list pasted from the confirmation email.
// Email format per line: "  Item# {id} • {name}  Qty: {qty}  =  ${lineTotal}"
function parseItemsFromEmail(note: string): StoredOrder["items"] {
  const items: StoredOrder["items"] = [];
  for (const line of note.split("\n")) {
    const m = line.match(/Item#\s+(\S+)\s+\u2022\s+(.+?)\s+Qty:\s+(\d+)\s+=\s+\$(\d+(?:\.\d+)?)/);
    if (m) {
      const [, id, name, qtyStr, lineTotalStr] = m;
      const quantity = parseInt(qtyStr, 10);
      const lineTotal = parseFloat(lineTotalStr);
      const price = quantity > 0 ? +(lineTotal / quantity).toFixed(2) : 0;
      items.push({ product: { id, name, description: name, price, category: "" }, quantity });
    }
  }
  return items;
}

// POST /api/admin/orders — restore a missing order manually
export async function POST(req: NextRequest) {
  try {
    const { pickupNumber, customer, total, note } = await req.json() as {
      pickupNumber: string;
      customer: { name: string; phone: string; email: string };
      total: number;
      note?: string;
    };

    if (!pickupNumber || !customer.name) {
      return NextResponse.json({ error: "Pickup number and customer name are required." }, { status: 400 });
    }

    const prefix = getTodayPrefix();
    const existing = await loadOneOrder(pickupNumber, prefix);
    if (existing) {
      return NextResponse.json({ error: `Order #${pickupNumber} already exists.` }, { status: 409 });
    }

    // Try to parse structured items from the pasted email text.
    // Fall back to a single note item if nothing parses (e.g. free-form text).
    const parsedItems = note ? parseItemsFromEmail(note) : [];
    const items: StoredOrder["items"] =
      parsedItems.length > 0
        ? parsedItems
        : note
        ? [{ product: { id: "—", name: note, description: note, price: total, category: "" }, quantity: 1 }]
        : [];

    const restored: StoredOrder = {
      id: pickupNumber,
      pickupNumber,
      customer,
      items,
      total,
      orderedAt: new Date().toISOString(),
      status: "new",
    };

    await saveOrder(restored, prefix);
    return NextResponse.json({ success: true, order: restored });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH /api/admin/orders — force-update an order's status
// Body: { id, status, claimedBy?, date? }
export async function PATCH(req: NextRequest) {
  try {
    const { id, status, claimedBy, date } = await req.json() as {
      id: string;
      status: StoredOrder["status"];
      claimedBy?: string;
      date?: string;
    };

    if (!["new", "processing", "done"].includes(status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const prefix = date ? prefixForDate(date) : getTodayPrefix();
    let order = await loadOneOrder(id, prefix);

    // Fall back to loading all orders for the date (handles legacy format)
    if (!order) {
      const all = await loadOrdersForDate(date);
      order = all.find((o) => o.id === id) ?? null;
    }

    if (!order) {
      const key = date ? `order-${date}-*.json` : "today's orders";
      return NextResponse.json({ error: `Order ${id} not found in ${key}.` }, { status: 404 });
    }

    order.status = status;
    if (claimedBy !== undefined) order.claimedBy = claimedBy;
    if (status === "done" && !order.doneAt) order.doneAt = new Date().toISOString();

    await saveOrder(order, prefix);
    return NextResponse.json({ success: true, order });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
