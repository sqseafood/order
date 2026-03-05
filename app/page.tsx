import fs from "fs";
import path from "path";
import { list } from "@vercel/blob";
import type { Product } from "@/types";
import ProductBrowser from "@/components/ProductBrowser";

export const dynamic = "force-dynamic";

async function loadProducts(): Promise<Product[]> {
  try {
    const { blobs } = await list({ prefix: "products.json" });
    const blob = blobs.find((b) => b.pathname === "products.json");
    if (blob) {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      return await res.json();
    }
  } catch {
    // fall through to local file
  }
  const filePath = path.join(process.cwd(), "data", "products.json");
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export default async function HomePage() {
  const products = await loadProducts();

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
      </div>

      {/* Same-day pickup notice */}
      <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 mb-5 text-sm">
        <span className="text-lg">🕐</span>
        <div>
          <span className="font-semibold text-orange-800">Same-day pickup only</span>
          <span className="text-orange-600"> · Pickup 12:00 PM – 4:00 PM · Order must be placed the same day</span>
        </div>
      </div>
      <ProductBrowser products={products} />
    </div>
  );
}
