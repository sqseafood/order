import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import nodemailer from "nodemailer";
import { readWaitlist, writeWaitlist } from "@/app/api/notify-me/route";
import type { Product } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const { products } = await req.json();

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ error: "Expected a non-empty products array." }, { status: 400 });
    }

    for (const p of products) {
      if (!p.id || !p.name || typeof p.price !== "number" || !p.category) {
        return NextResponse.json(
          { error: `Invalid product entry: ${JSON.stringify(p)}` },
          { status: 400 }
        );
      }
    }

    // Detect which products just came back in stock
    let oldProducts: Product[] = [];
    try {
      const { blobs } = await list({ prefix: "products.json" });
      const existingBlob = blobs.find((b) => b.pathname === "products.json");
      if (existingBlob) {
        const res = await fetch(`${existingBlob.url}?t=${Date.now()}`, { cache: "no-store" });
        if (res.ok) oldProducts = await res.json();
      }
    } catch {}

    await put("products.json", JSON.stringify(products, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Send restock notifications for products that were OOS and are now available
    const restockedIds = new Set(
      products
        .filter((p: Product) => !p.oos && oldProducts.find((op) => op.id === p.id)?.oos === true)
        .map((p: Product) => p.id)
    );

    if (restockedIds.size > 0) {
      const waitlist = await readWaitlist();
      const toNotify = waitlist.filter((e) => restockedIds.has(e.productId));
      const remaining = waitlist.filter((e) => !restockedIds.has(e.productId));

      if (toNotify.length > 0) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });

        await Promise.all(
          toNotify.map((entry) =>
            transporter.sendMail({
              from: `"SeaQuest" <${process.env.SMTP_USER}>`,
              to: entry.email,
              subject: `${entry.productName} is back in stock!`,
              text: `Good news! ${entry.productName} (Item# ${entry.productId}) is now available again.\n\nVisit our order page to place your order.\n\n— SeaQuest`,
            })
          )
        );

        await writeWaitlist(remaining);
      }
    }

    return NextResponse.json({ success: true, count: products.length });
  } catch (err) {
    console.error("Products write error:", err);
    return NextResponse.json({ error: "Server error writing products." }, { status: 500 });
  }
}
