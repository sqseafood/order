import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { mergeMAS200WithProducts, getMAS200LastUpdated } from "@/lib/mas200";
import type { Product } from "@/types";

export const dynamic = "force-dynamic";

async function loadImageOverrides(): Promise<Record<string, string>> {
  try {
    const { blobs } = await list({ prefix: "product-images.json" });
    const blob = blobs.find((b) => b.pathname === "product-images.json");
    if (!blob) return {};
    const res = await fetch(blob.downloadUrl, { cache: "no-store" });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function getBaseProducts() {
  // Try Vercel Blob first, then local file
  let products = null;
  try {
    const { blobs } = await list({ prefix: "products.json" });
    const blob = blobs.find((b) => b.pathname === "products.json");
    if (blob) {
      const res = await fetch(blob.downloadUrl, { cache: "no-store" });
      products = await res.json();
    }
  } catch {
    // fall through
  }
  if (!products) {
    const filePath = path.join(process.cwd(), "data", "products.json");
    products = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
  const imageOverrides = await loadImageOverrides();
  return products.map((p: Product) => ({ ...p, image: imageOverrides[p.id] || p.image }));
}

export async function GET() {
  const baseProducts = await getBaseProducts();

  // Merge with MAS 200 live export if available
  const [merged, lastUpdated] = await Promise.all([
    mergeMAS200WithProducts(baseProducts),
    getMAS200LastUpdated(),
  ]);
  if (merged) {
    return NextResponse.json(merged, {
      headers: {
        "X-Data-Source": "MAS200",
        "X-Last-Updated": lastUpdated ?? "",
      },
    });
  }

  // No MAS 200 export yet — return base products as-is
  return NextResponse.json(baseProducts);
}
