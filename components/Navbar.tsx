"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { ShoppingCartIcon } from "@heroicons/react/24/outline";

export default function Navbar() {
  const { totalItems } = useCart();

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-orange-500 tracking-tight">
          OrderApp
        </Link>
        <Link href="/cart" className="relative p-2 text-gray-700 hover:text-orange-500 transition-colors">
          <ShoppingCartIcon className="w-6 h-6" />
          {totalItems > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-orange-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {totalItems > 99 ? "99+" : totalItems}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
