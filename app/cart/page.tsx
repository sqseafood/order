"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/context/CartContext";
import { TrashIcon, MinusIcon, PlusIcon, ShoppingBagIcon, CheckCircleIcon, ClockIcon } from "@heroicons/react/24/outline";

function getPacificInfo() {
  const tz = "America/Los_Angeles";
  const now = new Date();
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }));
  const todayStr = now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  return { hour, todayStr, isOpen: hour < 16 };
}

export default function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, totalItems, totalPrice } = useCart();
  const { hour, todayStr, isOpen } = getPacificInfo();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pickupNumber, setPickupNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <CheckCircleIcon className="w-16 h-16 text-green-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Order Received!</h2>
        {pickupNumber && (
          <div className="mt-4 mb-2">
            <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Your Pickup Number</p>
            <div className="text-6xl font-black text-orange-500 leading-none">{pickupNumber}</div>
          </div>
        )}
        <p className="text-gray-500 text-sm mt-4 mb-6">
          A confirmation has been sent to <strong>{email}</strong>
        </p>
        <Link
          href="/"
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-3 rounded-2xl transition-colors"
        >
          Back to Menu
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ShoppingBagIcon className="w-16 h-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700">Your cart is empty</h2>
        <p className="text-gray-400 text-sm mt-1 mb-6">Add some items from the menu</p>
        <Link
          href="/"
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-3 rounded-2xl transition-colors"
        >
          Browse Menu
        </Link>
      </div>
    );
  }

  async function handlePlaceOrder() {
    if (!name.trim() || !phone.trim() || !email.trim()) {
      setError("Please fill in all contact fields.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: { name, phone, email }, items, total: totalPrice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Order failed.");
      clearCart();
      setPickupNumber(data.pickupNumber ?? null);
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Your Cart</h1>
        <span className="text-sm text-gray-500">{totalItems} item{totalItems !== 1 ? "s" : ""}</span>
      </div>

      {/* Pickup notice */}
      {isOpen ? (
        <div className="flex items-center gap-2.5 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 mb-5">
          <ClockIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Same-day pickup only</p>
            <p className="text-xs text-green-600">
              {todayStr} · Pickup 12:00 PM – 4:00 PM
              {hour < 12 ? " · Order now, pickup starts at noon" : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-5">
          <ClockIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Ordering closed for today</p>
            <p className="text-xs text-red-600">Pickup hours are 12:00 PM – 4:00 PM. Come back tomorrow!</p>
          </div>
        </div>
      )}

      {/* Cart items */}
      <div className="space-y-3 mb-6">
        {items.map(({ product, quantity }) => (
          <div key={product.id} className="bg-white rounded-2xl p-4 flex gap-3 shadow-sm border border-gray-100">
            <div className="relative w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center">
              {product.image ? (
                <Image src={product.image} alt={product.name} fill className="object-cover" sizes="80px" />
              ) : (
                <span className="text-2xl">🐟</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">#{product.id}</p>
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight">{product.name}</h3>
                </div>
                <button onClick={() => removeItem(product.id)} className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
              <p className="text-orange-500 font-semibold text-sm mt-1">${product.price.toFixed(2)}</p>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => updateQuantity(product.id, quantity - 1)}
                  className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 active:scale-95 flex items-center justify-center transition-all"
                >
                  <MinusIcon className="w-3.5 h-3.5 text-gray-600" />
                </button>
                <span className="w-5 text-center font-semibold text-sm text-gray-900">{quantity}</span>
                <button
                  onClick={() => updateQuantity(product.id, quantity + 1)}
                  className="w-7 h-7 rounded-full bg-orange-500 hover:bg-orange-600 active:scale-95 flex items-center justify-center transition-all"
                >
                  <PlusIcon className="w-3.5 h-3.5 text-white" />
                </button>
                <span className="ml-auto text-sm font-semibold text-gray-700">
                  ${(product.price * quantity).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Order total */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Order Summary</h3>
        <div className="flex justify-between font-bold text-gray-900 text-base">
          <span>Total</span>
          <span>${totalPrice.toFixed(2)}</span>
        </div>
      </div>

      {/* Contact info */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Contact Information</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 000-0000"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handlePlaceOrder}
        disabled={submitting || !isOpen}
        className="w-full bg-orange-500 hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-base transition-all shadow-lg shadow-orange-200"
      >
        {submitting ? "Placing Order…" : !isOpen ? "Ordering Closed for Today" : `Place Order — $${totalPrice.toFixed(2)}`}
      </button>

      <button onClick={clearCart} className="w-full mt-3 text-gray-400 hover:text-red-400 text-sm py-2 transition-colors">
        Clear cart
      </button>
    </div>
  );
}
