"use client";

import { useState, useMemo } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { Product } from "@/types";
import ProductCard from "@/components/ProductCard";

export default function ProductBrowser({ products }: { products: Product[] }) {
  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))),
    [products]
  );

  const [active, setActive] = useState<string>("All");
  const [query, setQuery] = useState("");

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    );
  }, [query, products]);

  const filtered = active === "All" ? searched : searched.filter((p) => p.category === active);

  const grouped = useMemo(() => {
    if (active !== "All") return null;
    return categories
      .map((cat) => ({ category: cat, items: searched.filter((p) => p.category === cat) }))
      .filter(({ items }) => items.length > 0);
  }, [active, searched, categories]);

  return (
    <>
      {/* Search box */}
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by item # or name…"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>

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

      {/* No results */}
      {filtered.length === 0 && (
        <p className="text-center text-gray-400 text-sm py-12">No items match &ldquo;{query}&rdquo;</p>
      )}

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
