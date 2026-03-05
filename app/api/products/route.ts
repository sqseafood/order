import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { mergeMAS200WithProducts, getMAS200LastUpdated } from "@/lib/mas200";

export const dynamic = "force-dynamic";

async function getBaseProducts() {
  // Try Vercel Blob first, then local file
  try {
    const { blobs } = await list({ prefix: "products.json" });
    const blob = blobs.find((b) => b.pathname === "products.json");
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      return await res.json();
    }
  } catch {
    // fall through
  }
  const filePath = path.join(process.cwd(), "data", "products.json");
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export async function GET() {
  const baseProducts = await getBaseProducts();

  // Merge with MAS 200 live export if available
  const merged = mergeMAS200WithProducts(baseProducts);
  if (merged) {
    return NextResponse.json(merged, {
      headers: {
        "X-Data-Source": "MAS200",
        "X-Last-Updated": getMAS200LastUpdated() ?? "",
      },
    });
  }

  // No MAS 200 export yet — return base products as-is
  return NextResponse.json(baseProducts);
}
