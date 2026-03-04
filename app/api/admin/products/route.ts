import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

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

    const filePath = path.join(process.cwd(), "data", "products.json");
    fs.writeFileSync(filePath, JSON.stringify(products, null, 2), "utf-8");

    return NextResponse.json({ success: true, count: products.length });
  } catch {
    return NextResponse.json({ error: "Server error writing products." }, { status: 500 });
  }
}
