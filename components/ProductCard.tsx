"use client";

import Image from "next/image";
import { useCart } from "@/context/CartContext";
import type { Product } from "@/types";
import { PlusIcon, MinusIcon } from "@heroicons/react/24/solid";

export default function ProductCard({ product }: { product: Product }) {
  const { items, addItem, updateQuantity } = useCart();
  const cartItem = items.find((i) => i.product.id === product.id);
  const qty = cartItem?.quantity ?? 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100 flex flex-col">
      {/* Image / placeholder */}
      <div className="relative w-full h-36 bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 512px) 100vw, 512px"
          />
        ) : (
          <span className="text-4xl select-none">🐟</span>
        )}
        <span className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm text-xs font-medium text-gray-600 px-2 py-0.5 rounded-full">
          {product.category}
        </span>
        <span className="absolute top-2 right-2 bg-gray-800/70 text-white text-xs px-2 py-0.5 rounded-full font-mono">
          Item# {product.id}
        </span>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col flex-1 gap-1.5">
        {/* Name + Vietnamese */}
        <div>
          <h3 className="font-semibold text-gray-900 text-sm leading-snug">{product.name}</h3>
          {product.description && product.description !== product.name && (
            <p className="text-xs text-gray-400 mt-0.5">{product.description}</p>
          )}
        </div>

        {/* Details row */}
        <div className="flex flex-wrap gap-1">
          {product.packaging && (
            <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
              {product.packaging}
            </span>
          )}
          {product.origin && (
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {product.origin}
            </span>
          )}
          {product.method && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              product.method === "WILD"
                ? "bg-green-50 text-green-700"
                : "bg-yellow-50 text-yellow-700"
            }`}>
              {product.method}
            </span>
          )}
          {product.weight ? (
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {product.weight} lbs
            </span>
          ) : null}
          {product.pack && (
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {product.pack}
            </span>
          )}
          {product.packType && (
            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {product.packType}
            </span>
          )}
        </div>

        {/* Price row */}
        <div className="flex items-end justify-between mt-auto pt-1">
          <div>
            <p className="text-xs text-gray-400 leading-none mb-0.5">Case Price</p>
            {product.oos ? (
              <span className="text-sm font-bold text-red-500">OOS</span>
            ) : (
              <>
                <span className="text-lg font-bold text-gray-900">${product.price.toFixed(2)}</span>
                {product.unitPrice != null && (
                  <span className="text-xs text-gray-400 ml-1">
                    (${product.unitPrice.toFixed(2)}/unit)
                  </span>
                )}
              </>
            )}
          </div>

          {product.oos ? (
            <span className="text-xs text-red-400 font-medium">Out of Stock</span>
          ) : qty === 0 ? (
            <button
              onClick={() => addItem(product)}
              className="bg-orange-500 hover:bg-orange-600 active:scale-95 text-white text-sm font-semibold px-4 py-1.5 rounded-xl transition-all"
            >
              Add
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateQuantity(product.id, qty - 1)}
                className="w-7 h-7 rounded-full bg-orange-100 hover:bg-orange-200 active:scale-95 flex items-center justify-center transition-all"
              >
                <MinusIcon className="w-3.5 h-3.5 text-orange-600" />
              </button>
              <span className="w-5 text-center font-semibold text-gray-900 text-sm">{qty}</span>
              <button
                onClick={() => addItem(product)}
                className="w-7 h-7 rounded-full bg-orange-500 hover:bg-orange-600 active:scale-95 flex items-center justify-center transition-all"
              >
                <PlusIcon className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
