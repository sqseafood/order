import { NextRequest, NextResponse } from "next/server";

async function verifyToken(token: string, secret: string, message: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return token === expected;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Admin routes ────────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth")) {
      return NextResponse.next();
    }
    const token = req.cookies.get("admin-token")?.value;
    if (!token) return NextResponse.redirect(new URL("/admin/login", req.url));
    const secret = process.env.ADMIN_SECRET ?? process.env.ADMIN_PASSWORD ?? "";
    if (!await verifyToken(token, secret, "admin-session")) {
      const res = NextResponse.redirect(new URL("/admin/login", req.url));
      res.cookies.delete("admin-token");
      return res;
    }
    return NextResponse.next();
  }

  // ── Orders processing routes ─────────────────────────────────────────────
  if (pathname.startsWith("/orders")) {
    if (pathname === "/orders/login") return NextResponse.next();
    const token = req.cookies.get("orders-token")?.value;
    if (!token) return NextResponse.redirect(new URL("/orders/login", req.url));
    const secret = process.env.ORDERS_SECRET ?? process.env.ORDERS_PASSWORD ?? "";
    if (!await verifyToken(token, secret, "orders-session")) {
      const res = NextResponse.redirect(new URL("/orders/login", req.url));
      res.cookies.delete("orders-token");
      return res;
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/orders/:path*"],
};
