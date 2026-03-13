"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ClockIcon,
  CheckCircleIcon,
  LockClosedIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import type { StoredOrder } from "@/app/api/orders/route";

const STAFF = ["Rick", "Cecilia", "Corina", "Mingson"];
const REFRESH_INTERVAL = 15_000; // 15 seconds

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPacificDate() {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long", month: "long", day: "numeric",
  });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [staffName, setStaffName] = useState<string>("");
  const [showNamePicker, setShowNamePicker] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Load staff name from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("orders-staff-name");
    if (saved && STAFF.includes(saved)) {
      setStaffName(saved);
    } else {
      setShowNamePicker(true);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders?t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to load orders.");
      const data: StoredOrder[] = await res.json();
      // Sort: new first, then processing, then done; within each group newest first
      data.sort((a, b) => {
        const rank: Record<StoredOrder["status"], number> = { new: 0, processing: 1, done: 2 };
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime();
      });
      setOrders(data);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  function selectStaff(name: string) {
    setStaffName(name);
    localStorage.setItem("orders-staff-name", name);
    setShowNamePicker(false);
  }

  async function handleAction(orderId: string, action: "claim" | "done") {
    setActionLoading(orderId + action);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, staffName }),
      });
      const data = await res.json();
      if (res.status === 409) {
        // Conflict — someone else claimed it; refresh to show current state
        await fetchOrders();
        return;
      }
      if (!res.ok) throw new Error(data.error || "Action failed.");
      // Optimistically update local state
      const updated = data.order as StoredOrder;
      const rank: Record<StoredOrder["status"], number> = { new: 0, processing: 1, done: 2 };
      setOrders((prev) =>
        prev
          .map((o) => (o.id === orderId ? updated : o))
          .sort((a, b) => {
            if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
            return new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime();
          })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/orders/auth", { method: "DELETE" });
    window.location.href = "/orders/login";
  }

  // ── Staff name picker modal ────────────────────────────────────────────────
  if (showNamePicker) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Who are you?</h2>
          <p className="text-sm text-gray-500 mb-4">Select your name to start processing orders.</p>
          <div className="space-y-2">
            {STAFF.map((name) => (
              <button
                key={name}
                onClick={() => selectStaff(name)}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-orange-400 hover:bg-orange-50 font-medium text-gray-900 transition-colors"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const newOrders = orders.filter((o) => o.status === "new");
  const processingOrders = orders.filter((o) => o.status === "processing");
  const doneOrders = orders.filter((o) => o.status === "done");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Order Processing</h1>
          <p className="text-xs text-gray-400">{formatPacificDate()}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <button
              onClick={() => setShowNamePicker(true)}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700"
            >
              {staffName} ▾
            </button>
            {lastRefreshed && (
              <p className="text-[10px] text-gray-400">
                Updated {formatTime(lastRefreshed.toISOString())}
              </p>
            )}
          </div>
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Refresh"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
        )}

        {!loading && orders.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <ClockIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No orders yet today</p>
            <p className="text-sm">Auto-refreshing every 15 seconds</p>
          </div>
        )}

        {/* NEW */}
        {newOrders.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-orange-500 mb-3">
              New — {newOrders.length} order{newOrders.length !== 1 ? "s" : ""}
            </h2>
            <div className="space-y-3">
              {newOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  staffName={staffName}
                  actionLoading={actionLoading}
                  onAction={handleAction}
                />
              ))}
            </div>
          </section>
        )}

        {/* PROCESSING */}
        {processingOrders.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-3">
              Processing — {processingOrders.length} order{processingOrders.length !== 1 ? "s" : ""}
            </h2>
            <div className="space-y-3">
              {processingOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  staffName={staffName}
                  actionLoading={actionLoading}
                  onAction={handleAction}
                />
              ))}
            </div>
          </section>
        )}

        {/* DONE */}
        {doneOrders.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-green-500 mb-3">
              Done — {doneOrders.length} order{doneOrders.length !== 1 ? "s" : ""}
            </h2>
            <div className="space-y-3">
              {doneOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  staffName={staffName}
                  actionLoading={actionLoading}
                  onAction={handleAction}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Order Card ──────────────────────────────────────────────────────────────
function printOrder(order: StoredOrder) {
  const itemRows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:4px 8px 4px 0">${i.product.id}</td><td style="padding:4px 8px">${i.product.name}</td><td style="padding:4px 0 4px 8px;text-align:right">×${i.quantity}</td><td style="padding:4px 0 4px 16px;text-align:right">$${(i.product.price * i.quantity).toFixed(2)}</td></tr>`
    )
    .join("");
  const win = window.open("", "_blank", "width=400,height=600");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Order #${order.pickupNumber}</title>
    <style>body{font-family:monospace;padding:24px;font-size:14px}h2{margin:0 0 4px}p{margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:12px}tfoot td{border-top:1px solid #000;font-weight:bold;padding-top:6px}</style>
    </head><body>
    <h2>Order #${order.pickupNumber}</h2>
    <p>${formatTime(order.orderedAt)}</p>
    <hr style="margin:8px 0"/>
    <p><strong>${order.customer.name}</strong></p>
    <p>${order.customer.phone}</p>
    <table><tbody>${itemRows}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td style="text-align:right">$${order.total.toFixed(2)}</td></tr></tfoot>
    </table>
    <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`);
  win.document.close();
}

function OrderCard({
  order,
  staffName,
  actionLoading,
  onAction,
}: {
  order: StoredOrder;
  staffName: string;
  actionLoading: string | null;
  onAction: (id: string, action: "claim" | "done") => void;
}) {
  const isNew = order.status === "new";
  const isProcessing = order.status === "processing";
  const isDone = order.status === "done";
  const isMine = order.claimedBy === staffName;

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-opacity ${
        isDone ? "opacity-60 border-gray-100" : "border-gray-200"
      }`}
    >
      {/* Card header */}
      <div className={`px-4 py-3 flex items-center justify-between ${
        isNew ? "bg-orange-50" : isProcessing ? "bg-blue-50" : "bg-gray-50"
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-black ${
            isNew ? "text-orange-500" : isProcessing ? "text-blue-600" : "text-gray-400"
          }`}>
            #{order.pickupNumber}
          </span>
          {isDone && <CheckCircleIcon className="w-5 h-5 text-green-500" />}
          {isProcessing && !isMine && <LockClosedIcon className="w-4 h-4 text-blue-400" />}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{formatTime(order.orderedAt)}</span>
          <button
            onClick={() => printOrder(order)}
            className="text-xs text-gray-600 hover:text-gray-900 bg-white border border-gray-300 px-2.5 py-1 rounded-lg transition-colors font-medium"
            title="Print order"
          >
            Print
          </button>
        </div>
      </div>

      {/* Customer info */}
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="font-semibold text-gray-900">{order.customer.name}</p>
        <p className="text-sm text-gray-500">{order.customer.phone}</p>
      </div>

      {/* Items */}
      <div className="px-4 py-3 space-y-1 border-b border-gray-100">
        {order.items.map((item, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-gray-700">
              <span className="font-medium text-gray-400 font-mono text-xs mr-1">{item.product.id}</span>
              {item.product.name}
            </span>
            <span className="text-gray-500 ml-2 whitespace-nowrap">×{item.quantity}</span>
          </div>
        ))}
        <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-gray-100 mt-1">
          <span>Total</span>
          <span>${order.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Status / Action */}
      <div className="px-4 py-3">
        {isNew && (
          <button
            onClick={() => onAction(order.id, "claim")}
            disabled={actionLoading === order.id + "claim"}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            {actionLoading === order.id + "claim" ? "Claiming…" : "Claim — Start Processing"}
          </button>
        )}

        {isProcessing && isMine && (
          <button
            onClick={() => onAction(order.id, "done")}
            disabled={actionLoading === order.id + "done"}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            {actionLoading === order.id + "done" ? "Saving…" : "Mark as Done ✓"}
          </button>
        )}

        {isProcessing && !isMine && (
          <p className="text-sm text-blue-600 font-medium text-center py-1">
            🔒 Processing by {order.claimedBy}
          </p>
        )}

        {isDone && (
          <p className="text-sm text-green-600 font-medium text-center py-1">
            ✓ Completed by {order.claimedBy}
            {order.doneAt && <span className="text-gray-400 font-normal"> at {formatTime(order.doneAt)}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
