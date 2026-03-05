import { NextRequest, NextResponse } from "next/server";

async function verifyToken(token: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("admin-session"));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return token === expected;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page and auth API through
  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth")) {
    return NextResponse.next();
  }

  const token = req.cookies.get("admin-token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  const secret = process.env.ADMIN_SECRET ?? process.env.ADMIN_PASSWORD ?? "";
  const valid = await verifyToken(token, secret);
  if (!valid) {
    const res = NextResponse.redirect(new URL("/admin/login", req.url));
    res.cookies.delete("admin-token");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
