import fs from "fs";
import path from "path";
import type { Product } from "@/types";
import ProductBrowser from "@/components/ProductBrowser";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const filePath = path.join(process.cwd(), "data", "products.json");
  const products: Product[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));

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
