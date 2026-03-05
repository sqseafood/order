import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import type { StoredOrder } from "../route";

function getTodayKey(): string {
  const pacificStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const d = new Date(pacificStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `orders-${y}-${m}-${day}.json`;
}

async function loadTodayOrders(): Promise<StoredOrder[]> {
  try {
    const key = getTodayKey();
    const { blobs } = await list({ prefix: key });
    const blob = blobs.find((b) => b.pathname === key);
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) return await res.json();
    }
  } catch {}
  return [];
}

async function saveTodayOrders(orders: StoredOrder[]): Promise<void> {
  await put(getTodayKey(), JSON.stringify(orders, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { action, staffName } = await req.json() as {
      action: "claim" | "done";
      staffName: string;
    };

    const orders = await loadTodayOrders();
    const order = orders.find((o) => o.id === id);
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === "claim") {
      if (order.status !== "new") {
        // Already claimed — return current state so UI can update
        return NextResponse.json({ conflict: true, order }, { status: 409 });
      }
      order.status = "processing";
      order.claimedBy = staffName;
      order.claimedAt = now;
    } else if (action === "done") {
      if (order.claimedBy !== staffName) {
        return NextResponse.json({ error: "Only the person who claimed this order can mark it done." }, { status: 403 });
      }
      order.status = "done";
      order.doneAt = now;
    }

    await saveTodayOrders(orders);
    return NextResponse.json({ success: true, order });
  } catch (err) {
    console.error("Order PATCH error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
