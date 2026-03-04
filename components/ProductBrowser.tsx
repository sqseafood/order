"use client";

import { useState, useMemo } from "react";
import type { Product } from "@/types";
import ProductCard from "@/components/ProductCard";

export default function ProductBrowser({ products }: { products: Product[] }) {
  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))),
    [products]
  );

  const [active, setActive] = useState<string>("All");

  const filtered = active === "All" ? products : products.filter((p) => p.category === active);

  const grouped = useMemo(() => {
    if (active !== "All") return null;
    return categories.map((cat) => ({
      category: cat,
      items: products.filter((p) => p.category === cat),
    }));
  }, [active, categories, products]);

  return (
    <>
      {/* Sticky category pill bar */}
      <div className="sticky top-14 z-10 -mx-4 px-4 py-2 bg-white/90 backdrop-blur-sm border-b border-gray-100 mb-5">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
          {["All", ...categories].map((cat) => (
            <button
              key={cat}
              onClick={() => setActive(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                active === cat
                  ? "bg-orange-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product grid */}
      {grouped ? (
        grouped.map(({ category, items }) => (
          <section key={category} className="mb-7">
            <h2 className="text-base font-semibold text-gray-700 mb-3">{category}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <section className="mb-7">
          <h2 className="text-base font-semibold text-gray-700 mb-3">{active}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {filtered.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
