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
  const todayKey = `orders-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}.json`;

  const { blobs } = await list({ prefix: "orders-" });

  const toDelete = blobs.filter(
    (b) => b.pathname.match(/^orders-\d{4}-\d{2}-\d{2}\.json$/) && b.pathname !== todayKey
  );

  if (toDelete.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  await Promise.all(toDelete.map((b) => del(b.url)));

  return NextResponse.json({ deleted: toDelete.length, files: toDelete.map((b) => b.pathname) });
}
