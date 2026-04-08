import { list, del } from "@vercel/blob";
import { NextResponse } from "next/server";

// Runs daily via Vercel cron — deletes order files older than today
export async function GET(request: Request) {
  // Verify the request is from Vercel cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pacificStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const today = new Date(pacificStr);
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Collect blobs from both the new per-order format and the legacy daily format
  const [{ blobs: newBlobs }, { blobs: legacyBlobs }] = await Promise.all([
    list({ prefix: "order-" }),   // new: order-YYYY-MM-DD-{num}.json
    list({ prefix: "orders-" }),  // legacy: orders-YYYY-MM-DD.json
  ]);

  const toDelete = [
    ...newBlobs.filter(
      (b) => b.pathname.match(/^order-\d{4}-\d{2}-\d{2}-/) && !b.pathname.startsWith(`order-${dateStr}-`)
    ),
    ...legacyBlobs.filter(
      (b) => b.pathname.match(/^orders-\d{4}-\d{2}-\d{2}\.json$/) && b.pathname !== `orders-${dateStr}.json`
    ),
  ];

  if (toDelete.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  await Promise.all(toDelete.map((b) => del(b.url)));

  return NextResponse.json({ deleted: toDelete.length, files: toDelete.map((b) => b.pathname) });
}
