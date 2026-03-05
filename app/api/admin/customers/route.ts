import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "customers.json" });
    const blob = blobs.find((b) => b.pathname === "customers.json");
    if (!blob) return NextResponse.json([]);
    const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json([]);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Failed to load customers." }, { status: 500 });
  }
}
