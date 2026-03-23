import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { readWaitlist, writeWaitlist } from "@/app/api/notify-me/route";
import { mergeMAS200WithProducts } from "@/lib/mas200";
import type { Product } from "@/types";

async function loadCurrentProducts(): Promise<{ products: Product[]; fromBlob: boolean }> {
  try {
    const { blobs } = await list({ prefix: "products.json" });
    const blob = blobs.find((b) => b.pathname === "products.json");
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) return { products: await res.json(), fromBlob: true };
    }
  } catch {}
  const localPath = path.join(process.cwd(), "data", "products.json");
  if (fs.existsSync(localPath)) {
    return { products: JSON.parse(fs.readFileSync(localPath, "utf-8")), fromBlob: false };
  }
  return { products: [], fromBlob: false };
}

async function saveProducts(products: Product[], useBlob: boolean) {
  const json = JSON.stringify(products, null, 2);
  if (useBlob || process.env.BLOB_READ_WRITE_TOKEN) {
    await put("products.json", json, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } else {
    fs.writeFileSync(path.join(process.cwd(), "data", "products.json"), json, "utf-8");
  }
}

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

    // Preserve existing images so they survive price list re-uploads
    const imageMap = new Map(oldProducts.map((p) => [p.id, p.image]));
    const productsWithImages = products.map((p: Product) => ({
      ...p,
      image: p.image || imageMap.get(p.id) || "",
    }));

    await put("products.json", JSON.stringify(productsWithImages, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Send restock notifications for products that were OOS and are now available
    const restockedIds = new Set(
      productsWithImages
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
              text: `Good news! ${entry.productName} (Item# ${entry.productId}) is now available again.\n\nVisit our order page to place your order. Same-day pickup only — 12:00 PM to 4:00 PM Pacific.\n\n— SeaQuest`,
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

// PATCH /api/admin/products — update categories for specific products
export async function PATCH(req: NextRequest) {
  try {
    const { updates } = await req.json(); // [{ id, category }]
    if (!Array.isArray(updates) || !updates.length) {
      return NextResponse.json({ error: "Expected a non-empty updates array." }, { status: 400 });
    }

    const { products, fromBlob } = await loadCurrentProducts();

    const updateMap = new Map(
      updates.map((u: { id: string; category: string; pack?: string; packType?: string }) => [u.id, u])
    );

    // Update existing products
    const updated = products.map((p: Product) => {
      if (!updateMap.has(p.id)) return p;
      const u = updateMap.get(p.id)!;
      return {
        ...p,
        category: u.category ?? p.category,
        ...(u.pack !== undefined && u.pack !== "" && { pack: u.pack }),
        ...(u.packType !== undefined && u.packType !== "" && { packType: u.packType }),
      };
    });

    // Add new MAS200 items that aren't in products.json yet
    const existingIds = new Set(products.map((p: Product) => p.id));
    const newIds = updates.filter((u: { id: string }) => !existingIds.has(u.id));
    if (newIds.length > 0) {
      const merged = (await mergeMAS200WithProducts(products)) ?? [];
      for (const u of newIds) {
        const mas = merged.find((p) => p.id === u.id);
        if (mas) updated.push({
          ...mas,
          category: u.category,
          oos: false,
          ...(u.pack !== undefined && u.pack !== "" && { pack: u.pack }),
          ...(u.packType !== undefined && u.packType !== "" && { packType: u.packType }),
        });
      }
    }

    await saveProducts(updated, fromBlob);
    return NextResponse.json({ success: true, updated: updates.length });
  } catch (err) {
    console.error("Products PATCH error:", err);
    return NextResponse.json({ error: "Server error updating categories." }, { status: 500 });
  }
}

// DELETE /api/admin/products — remove a single product by id
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Product ID required." }, { status: 400 });

    const { products, fromBlob } = await loadCurrentProducts();
    const filtered = products.filter((p: Product) => p.id !== id);
    if (filtered.length === products.length) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    await saveProducts(filtered, fromBlob);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Products DELETE error:", err);
    return NextResponse.json({ error: "Server error deleting product." }, { status: 500 });
  }
}
