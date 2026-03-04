import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("images") as File[];

    if (!files.length) {
      return NextResponse.json({ error: "No images provided." }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "public", "products");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const productsPath = path.join(process.cwd(), "data", "products.json");
    const products = JSON.parse(fs.readFileSync(productsPath, "utf-8"));

    let matched = 0;
    let unmatched = 0;

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const fileName = file.name;
      const ext = path.extname(fileName).toLowerCase();
      const id = path.basename(fileName, ext).toUpperCase();

      fs.writeFileSync(path.join(uploadDir, fileName), buffer);

      const product = products.find((p: { id: string }) => p.id.toUpperCase() === id);
      if (product) {
        product.image = `/products/${fileName}`;
        matched++;
      } else {
        unmatched++;
      }
    }

    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2), "utf-8");

    return NextResponse.json({ success: true, matched, unmatched });
  } catch {
    return NextResponse.json({ error: "Server error uploading images." }, { status: 500 });
  }
}
