"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/context/CartContext";
import { ShoppingCartIcon } from "@heroicons/react/24/outline";

export default function CartBar() {
  const { totalItems, totalPrice } = useCart();
  const pathname = usePathname();

  if (totalItems === 0 || pathname === "/cart") return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-transparent pointer-events-none">
      <div className="max-w-lg mx-auto pointer-events-auto">
        <Link
          href="/cart"
          className="flex items-center justify-between bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white font-bold px-5 py-4 rounded-2xl shadow-xl shadow-orange-300/50 transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="bg-white/20 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
              {totalItems > 99 ? "99+" : totalItems}
            </span>
            <span>View Cart</span>
          </div>
          <div className="flex items-center gap-2">
            <span>${totalPrice.toFixed(2)}</span>
            <ShoppingCartIcon className="w-5 h-5" />
          </div>
        </Link>
      </div>
    </div>
  );
}
