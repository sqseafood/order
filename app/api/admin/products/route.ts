import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(req: NextRequest) {
  try {
    const { products } = await req.json();

    if (!Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ error: "Expected a non-empty products array." }, { status: 400 });
    }

    for (const p of products) {
      if (!p.id || !p.name || typeof p.price !== "number" || !p.category) {
        return NextResponse.json(
          { error: `Invalid product entry: ${JSON.stringify(p)}` },
          { status: 400 }
        );
      }
    }

    await put("products.json", JSON.stringify(products, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({ success: true, count: products.length });
  } catch (err) {
    console.error("Products write error:", err);
    return NextResponse.json({ error: "Server error writing products." }, { status: 500 });
  }
}
