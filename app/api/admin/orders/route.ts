import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import type { StoredOrder } from "@/app/api/orders/route";

export const dynamic = "force-dynamic";

function getTodayKey(): string {
  const pacificStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const d = new Date(pacificStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `orders-${y}-${m}-${day}.json`;
}

async function loadOrders(key: string): Promise<StoredOrder[]> {
  try {
    const { blobs } = await list({ prefix: key });
    const blob = blobs.find((b) => b.pathname === key);
    if (blob) {
      const res = await fetch(blob.downloadUrl, { cache: "no-store" });
      if (res.ok) return await res.json();
    }
  } catch {}
  return [];
}

// GET /api/admin/orders?date=2026-04-03  (date optional, defaults to today)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const key = date ? `orders-${date}.json` : getTodayKey();
  const orders = await loadOrders(key);
  return NextResponse.json(orders);
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

    const key = getTodayKey();
    const orders = await loadOrders(key);

    if (orders.find((o) => o.id === pickupNumber)) {
      return NextResponse.json({ error: `Order #${pickupNumber} already exists.` }, { status: 409 });
    }

    const restored: StoredOrder = {
      id: pickupNumber,
      pickupNumber,
      customer,
      items: note ? [{ product: { id: "—", name: note, price: total, category: "" }, quantity: 1 }] as StoredOrder["items"] : [],
      total,
      orderedAt: new Date().toISOString(),
      status: "new",
    };

    orders.push(restored);
    await put(key, JSON.stringify(orders, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

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

    const key = date ? `orders-${date}.json` : getTodayKey();
    const orders = await loadOrders(key);
    const order = orders.find((o) => o.id === id);
    if (!order) {
      return NextResponse.json({ error: `Order ${id} not found in ${key}.` }, { status: 404 });
    }

    order.status = status;
    if (claimedBy !== undefined) order.claimedBy = claimedBy;
    if (status === "done" && !order.doneAt) order.doneAt = new Date().toISOString();

    await put(key, JSON.stringify(orders, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({ success: true, order });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
