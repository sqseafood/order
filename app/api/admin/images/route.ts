import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import path from "path";
import fs from "fs";

async function loadProducts() {
  // Try Blob first
  try {
    const { blobs } = await list({ prefix: "products.json" });
    const blob = blobs.find((b) => b.pathname === "products.json");
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      return await res.json();
    }
  } catch {
    // fall through to local
  }
  // Local fallback
  const filePath = path.join(process.cwd(), "data", "products.json");
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("images") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "No images provided." }, { status: 400 });
    }

    const products = await loadProducts();

    let matched = 0;
    let unmatched = 0;

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const fileName = file.name;
      const ext = path.extname(fileName).toLowerCase();
      const id = path.basename(fileName, ext).toUpperCase();

      const { url } = await put(`products/${fileName}`, buffer, {
        access: "public",
        contentType: file.type || "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      const product = products.find((p: { id: string }) => p.id.toUpperCase() === id);
      if (product) {
        product.image = url;
        matched++;
      } else {
        unmatched++;
      }
    }

    await put("products.json", JSON.stringify(products, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({ success: true, matched, unmatched });
  } catch (err) {
    console.error("Image upload error:", err);
    return NextResponse.json({ error: "Server error uploading images." }, { status: 500 });
  }
}
