import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "products.json");
  const products = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return NextResponse.json(products);
}
