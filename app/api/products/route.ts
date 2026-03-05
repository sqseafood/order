import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { loadMAS200Products, getMAS200LastUpdated } from "@/lib/mas200";

export const dynamic = "force-dynamic";

export async function GET() {
  // 1. Try MAS 200 live export first
  const mas200Products = loadMAS200Products();
  if (mas200Products) {
    return NextResponse.json(mas200Products, {
      headers: {
        "X-Data-Source": "MAS200",
        "X-Last-Updated": getMAS200LastUpdated() ?? "",
      },
    });
  }

  // 2. Try Vercel Blob
  try {
    const { blobs } = await list({ prefix: "products.json" });
    const blob = blobs.find((b) => b.pathname === "products.json");
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      const products = await res.json();
      return NextResponse.json(products);
    }
  } catch {
    // fall through to local
  }

  // 3. Fall back to local products.json
  const filePath = path.join(process.cwd(), "data", "products.json");
  const products = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return NextResponse.json(products);
}
