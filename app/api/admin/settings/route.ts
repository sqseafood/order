import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";

export const dynamic = "force-dynamic";

export interface AppSettings {
  orderEmailRecipients: string[];
}

const SETTINGS_KEY = "app-settings.json";

export async function loadSettings(): Promise<AppSettings> {
  try {
    const { blobs } = await list({ prefix: SETTINGS_KEY });
    const blob = blobs.find((b) => b.pathname === SETTINGS_KEY);
    if (!blob) return { orderEmailRecipients: [] };
    const res = await fetch(blob.downloadUrl, { cache: "no-store" });
    if (!res.ok) return { orderEmailRecipients: [] };
    return await res.json();
  } catch {
    return { orderEmailRecipients: [] };
  }
}

export async function GET() {
  try {
    const settings = await loadSettings();
    return NextResponse.json(settings);
  } catch {
    return NextResponse.json({ error: "Failed to load settings." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<AppSettings>;

    // Validate recipients
    const recipients = body.orderEmailRecipients ?? [];
    if (!Array.isArray(recipients)) {
      return NextResponse.json({ error: "Invalid recipients." }, { status: 400 });
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const r of recipients) {
      if (typeof r !== "string" || !emailRe.test(r)) {
        return NextResponse.json({ error: `Invalid email: ${r}` }, { status: 400 });
      }
    }

    // Load current settings and merge
    const current = await loadSettings();
    const updated: AppSettings = { ...current, orderEmailRecipients: recipients };

    await put(SETTINGS_KEY, JSON.stringify(updated, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
