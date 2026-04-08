import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import type { StoredOrder } from "../route";
import { loadTodayOrders, saveOrder } from "../route";

function getTodayPrefix(): string {
  const pacificStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const d = new Date(pacificStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `order-${y}-${m}-${day}-`;
}

// Load a single order by ID — fast path that avoids fetching all orders.
// Falls back to loading all today's orders (handles legacy daily-file format).
async function loadOneOrder(id: string): Promise<StoredOrder | null> {
  const key = `${getTodayPrefix()}${id}.json`;
  try {
    const { blobs } = await list({ prefix: key });
    const blob = blobs.find((b) => b.pathname === key);
    if (blob) {
      const res = await fetch(blob.downloadUrl, { cache: "no-store" });
      if (res.ok) return await res.json();
    }
  } catch {}

  // Not found as individual file — check legacy daily file
  const all = await loadTodayOrders();
  return all.find((o) => o.id === id) ?? null;
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

    const order = await loadOneOrder(id);
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === "claim") {
      if (order.status !== "new") {
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

    await saveOrder(order);
    return NextResponse.json({ success: true, order });
  } catch (err) {
    console.error("Order PATCH error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
