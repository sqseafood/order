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
      const res = await fetch(blob.downloadUrl, { cache: "no-store" });
      if (res.ok) return await res.json();
    }
  } catch {}
  return [];
}

async function saveTodayOrders(orders: StoredOrder[]): Promise<void> {
  const key = getTodayKey();
  const body = JSON.stringify(orders, null, 2);
  const opts = { access: "public" as const, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await put(key, body, opts);
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

// Calculate the next pickup number WITHOUT writing the counter yet.
// The counter is only persisted after the order blob saves successfully,
// so a failed save never burns a pickup number or causes duplicates.
async function calcNextPickupNumber(existingOrders: StoredOrder[]): Promise<number> {
  const { blobs } = await list({ prefix: "pickup-counter.json" });
  const blob = blobs.find((b) => b.pathname === "pickup-counter.json");
  let counter = 10001;
  if (blob) {
    const res = await fetch(blob.downloadUrl, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      counter = (data.counter ?? 10000) + 1;
    }
  }
  // Skip numbers already used today (guards against counter/blob getting out of sync)
  const maxUsed = existingOrders.reduce((max, o) => {
    const n = parseInt(o.pickupNumber);
    return isNaN(n) ? max : Math.max(max, n);
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

    const todayOrders = await loadTodayOrders();
    const pickupNum = await calcNextPickupNumber(todayOrders);
    const pickupNumber = pickupNum.toString();

    // Commit the order to the blob FIRST.
    // If this fails the customer sees an error and can retry — no email is sent,
    // no pickup number is burned, and the counter stays correct.
    todayOrders.push({
      id: pickupNumber,
      pickupNumber,
      customer,
      items,
      total,
      orderedAt: new Date().toISOString(),
      status: "new",
    });
    await saveTodayOrders(todayOrders);

    // Order is saved. Advance the counter (non-blocking — if this fails the
    // maxUsed guard in calcNextPickupNumber self-heals it on the next order).
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
