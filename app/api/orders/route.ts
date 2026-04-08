import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { put, list } from "@vercel/blob";
import type { CartItem } from "@/types";

export interface StoredOrder {
  id: string;
  pickupNumber: string;
  customer: { name: string; phone: string; email: string };
  items: CartItem[];
  total: number;
  orderedAt: string;
  status: "new" | "processing" | "done";
  claimedBy?: string;
  claimedAt?: string;
  doneAt?: string;
}

// Each order is stored as its own blob: order-YYYY-MM-DD-{pickupNumber}.json
// This eliminates the read-modify-write race condition that could silently drop orders.
function getTodayPrefix(): string {
  const pacificStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const d = new Date(pacificStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `order-${y}-${m}-${day}-`;
}

// Legacy key for the old daily-aggregate format (read-only, for migration)
function getLegacyKey(): string {
  const pacificStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const d = new Date(pacificStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `orders-${y}-${m}-${day}.json`;
}

export async function loadTodayOrders(): Promise<StoredOrder[]> {
  try {
    const prefix = getTodayPrefix();
    const legacyKey = getLegacyKey();

    // Load both new per-order files and legacy daily file in parallel
    const [{ blobs: newBlobs }, { blobs: legacyBlobs }] = await Promise.all([
      list({ prefix }),
      list({ prefix: legacyKey }),
    ]);

    const fetches: Promise<StoredOrder | null>[] = [];

    // New per-order files
    for (const b of newBlobs.filter((b) => b.pathname.endsWith(".json"))) {
      fetches.push(
        fetch(b.downloadUrl, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<StoredOrder>) : null))
          .catch(() => null)
      );
    }

    // Legacy daily file
    const legacyBlob = legacyBlobs.find((b) => b.pathname === legacyKey);
    let legacyOrders: StoredOrder[] = [];
    if (legacyBlob) {
      try {
        const res = await fetch(legacyBlob.downloadUrl, { cache: "no-store" });
        if (res.ok) legacyOrders = await res.json();
      } catch {}
    }

    const newOrders = (await Promise.all(fetches)).filter(Boolean) as StoredOrder[];

    // Merge: new-format files take precedence; legacy fills in anything missing
    const byId = new Map<string, StoredOrder>();
    for (const o of legacyOrders) byId.set(o.id, o);
    for (const o of newOrders) byId.set(o.id, o); // overwrites legacy if same ID
    return Array.from(byId.values());
  } catch {}
  return [];
}

export async function saveOrder(order: StoredOrder, prefix?: string): Promise<void> {
  const key = `${prefix ?? getTodayPrefix()}${order.pickupNumber}.json`;
  const opts = {
    access: "public" as const,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await put(key, JSON.stringify(order, null, 2), opts);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
}

interface CustomerRecord {
  name: string;
  phone: string;
  email: string;
  firstOrderAt: string;
  lastOrderAt: string;
  orderCount: number;
}

// Calculate the next pickup number without writing the counter yet.
// Uses blob filenames to compute maxUsed — no need to fetch order data.
async function calcNextPickupNumber(): Promise<number> {
  const prefix = getTodayPrefix();
  const [counterResult, ordersResult] = await Promise.all([
    list({ prefix: "pickup-counter.json" }),
    list({ prefix }),
  ]);

  let counter = 10001;
  const counterBlob = counterResult.blobs.find((b) => b.pathname === "pickup-counter.json");
  if (counterBlob) {
    const res = await fetch(counterBlob.downloadUrl, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      counter = (data.counter ?? 10000) + 1;
    }
  }

  // Guard against counter/blob desync by checking existing order filenames
  const maxUsed = ordersResult.blobs.reduce((max, b) => {
    const match = b.pathname.match(/(\d+)\.json$/);
    const n = match ? parseInt(match[1]) : 0;
    return Math.max(max, n);
  }, 10000);

  return Math.max(counter, maxUsed + 1);
}

async function saveCounter(counter: number): Promise<void> {
  await put("pickup-counter.json", JSON.stringify({ counter }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function saveCustomer(customer: { name: string; phone: string; email: string }) {
  try {
    let records: CustomerRecord[] = [];
    const { blobs } = await list({ prefix: "customers.json" });
    const blob = blobs.find((b) => b.pathname === "customers.json");
    if (blob) {
      const res = await fetch(blob.downloadUrl, { cache: "no-store" });
      if (res.ok) records = await res.json();
    }
    const now = new Date().toISOString();
    const existing = records.find((r) => r.email.toLowerCase() === customer.email.toLowerCase());
    if (existing) {
      existing.lastOrderAt = now;
      existing.orderCount += 1;
      existing.name = customer.name;
      existing.phone = customer.phone;
    } else {
      records.push({ ...customer, firstOrderAt: now, lastOrderAt: now, orderCount: 1 });
    }
    await put("customers.json", JSON.stringify(records, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error("Failed to save customer:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { customer, items, total } = await req.json() as {
      customer: { name: string; phone: string; email: string };
      items: CartItem[];
      total: number;
    };

    if (!customer.name || !customer.phone || !customer.email) {
      return NextResponse.json({ error: "Missing customer info." }, { status: 400 });
    }

    // Reject orders after 4:00 PM Pacific time
    const pacificHour = parseInt(
      new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false })
    );
    if (pacificHour >= 16) {
      return NextResponse.json(
        { error: "Ordering is closed for today. Pickup hours are 12:00 PM – 4:00 PM Pacific. Please come back tomorrow." },
        { status: 400 }
      );
    }

    const pickupNum = await calcNextPickupNumber();
    const pickupNumber = pickupNum.toString();

    const order: StoredOrder = {
      id: pickupNumber,
      pickupNumber,
      customer,
      items,
      total,
      orderedAt: new Date().toISOString(),
      status: "new",
    };

    // Each order is its own file — no read needed, no race condition possible.
    await saveOrder(order);

    // Advance the counter (non-blocking — maxUsed guard self-heals if this fails)
    saveCounter(pickupNum);

    // Save customer to database (non-blocking)
    saveCustomer(customer);

    // Send emails after the order is safely persisted.
    const itemRows = items.map((i) =>
      `  Item# ${i.product.id} • ${i.product.name}  Qty: ${i.quantity}  =  $${(i.product.price * i.quantity).toFixed(2)}`
    ).join("\n");

    const dateStr = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
    const pickupDate = new Date().toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric",
    });

    const body = `
New Order — ${dateStr}
Pickup #: ${pickupNumber}
Pickup Date: ${pickupDate} (TODAY, by 4:00 PM)

Customer
--------
Name:  ${customer.name}
Phone: ${customer.phone}
Email: ${customer.email}

Items
-----
${itemRows}

Order Total: $${total.toFixed(2)}
`.trim();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await Promise.allSettled([
      transporter.sendMail({
        from: `"SeaQuest Orders" <${process.env.SMTP_USER}>`,
        to: "seaquestwarehouse@gmail.com",
        subject: `New Order from ${customer.name}`,
        text: body,
      }),
      transporter.sendMail({
        from: `"SeaQuest" <${process.env.SMTP_USER}>`,
        to: customer.email,
        subject: `Your SeaQuest Order Confirmation — Pickup #${pickupNumber}`,
        text: `Thank you, ${customer.name}! Your order has been received.\n\nYour pickup number is: ${pickupNumber}`,
      }),
    ]);

    return NextResponse.json({ success: true, pickupNumber });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Order error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const orders = await loadTodayOrders();
  return NextResponse.json(orders);
}
