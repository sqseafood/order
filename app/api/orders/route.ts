import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { put, list } from "@vercel/blob";
import type { CartItem } from "@/types";

interface CustomerRecord {
  name: string;
  phone: string;
  email: string;
  firstOrderAt: string;
  lastOrderAt: string;
  orderCount: number;
}

async function nextPickupNumber(): Promise<string> {
  const { blobs } = await list({ prefix: "pickup-counter.json" });
  const blob = blobs.find((b) => b.pathname === "pickup-counter.json");
  let counter = 10001;
  if (blob) {
    const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      counter = (data.counter ?? 10000) + 1;
    }
  }
  await put("pickup-counter.json", JSON.stringify({ counter }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return counter.toString();
}

async function saveCustomer(customer: { name: string; phone: string; email: string }) {
  try {
    let records: CustomerRecord[] = [];
    const { blobs } = await list({ prefix: "customers.json" });
    const blob = blobs.find((b) => b.pathname === "customers.json");
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
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

    const pickupNumber = await nextPickupNumber();

    const itemRows = items.map((i) =>
      `  Item# ${i.product.id} • ${i.product.name}  Qty: ${i.quantity}  =  $${(i.product.price * i.quantity).toFixed(2)}`
    ).join("\n");

    const dateStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

    const body = `
New Order — ${dateStr}
Pickup #: ${pickupNumber}

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

    await transporter.sendMail({
      from: `"SeaQuest Orders" <${process.env.SMTP_USER}>`,
      to: "seaquestwarehouse@gmail.com",
      cc: "seaquestcecilia@yahoo.com, seaquestcorina@yahoo.com, seaquestmingson@yahoo.com",
      subject: `New Order from ${customer.name}`,
      text: body,
    });

    await transporter.sendMail({
      from: `"SeaQuest" <${process.env.SMTP_USER}>`,
      to: customer.email,
      subject: `Your SeaQuest Order Confirmation — Pickup #${pickupNumber}`,
      text: `Thank you, ${customer.name}! Your order has been received.\n\nYour pickup number is: ${pickupNumber}\n\n${body}\n\nWe will be in touch shortly.`,
    });

    // Save customer to database (non-blocking)
    saveCustomer(customer);

    return NextResponse.json({ success: true, pickupNumber });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Order error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
