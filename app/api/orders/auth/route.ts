import { NextRequest, NextResponse } from "next/server";

async function generateToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("orders-session"));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const ordersPassword = process.env.ORDERS_PASSWORD;
  if (!ordersPassword) {
    return NextResponse.json({ error: "ORDERS_PASSWORD not configured." }, { status: 500 });
  }
  if (password !== ordersPassword) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }
  const secret = process.env.ORDERS_SECRET ?? ordersPassword;
  const token = await generateToken(secret);
  const res = NextResponse.json({ success: true });
  res.cookies.set("orders-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete("orders-token");
  return res;
}
