import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import type { CartItem } from "@/types";

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

    const pickupNumber = Math.floor(100 + Math.random() * 900).toString();

    const itemRows = items.map((i) =>
      `  • ${i.product.name} (${i.product.id})  ×${i.quantity}  =  $${(i.product.price * i.quantity).toFixed(2)}`
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
      to: "seaquestrick@gmail.com",
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

    return NextResponse.json({ success: true, pickupNumber });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Order error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
