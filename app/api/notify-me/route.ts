import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";

export interface WaitlistEntry {
  productId: string;
  productName: string;
  email: string;
  signedUpAt: string;
}

export async function readWaitlist(): Promise<WaitlistEntry[]> {
  try {
    const { blobs } = await list({ prefix: "waitlist.json" });
    const blob = blobs.find((b) => b.pathname === "waitlist.json");
    if (!blob) return [];
    const res = await fetch(blob.downloadUrl, { cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function writeWaitlist(entries: WaitlistEntry[]) {
  await put("waitlist.json", JSON.stringify(entries, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function GET() {
  const waitlist = await readWaitlist();
  return NextResponse.json(waitlist);
}

export async function POST(req: NextRequest) {
  try {
    const { productId, productName, email } = await req.json();
    if (!productId || !email) {
      return NextResponse.json({ error: "Missing fields." }, { status: 400 });
    }

    const waitlist = await readWaitlist();

    // No duplicate: same email + same product
    const alreadySignedUp = waitlist.some(
      (e) => e.productId === productId && e.email.toLowerCase() === email.toLowerCase()
    );
    if (!alreadySignedUp) {
      waitlist.push({ productId, productName, email, signedUpAt: new Date().toISOString() });
      await writeWaitlist(waitlist);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Notify-me error:", err);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
