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
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
        <p className="text-gray-500 text-sm mt-0.5">Order fresh, delivered fast</p>
      </div>
      <ProductBrowser products={products} />
    </div>
  );
}
