import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

    const content = await file.text();

    // Validate — count parseable product lines (new INTERNAL USE INVENTORY REPORT format)
    // Data lines: leading space, item code, 3-digit WHS, then fields, ending with UNIT_PRICE QTY CASE_PRICE
    let count = 0;
    for (const line of content.split(/\r?\n/)) {
      const itemMatch = line.match(/^\s([A-Z][A-Z0-9]{2,7})\s+\d{3}\s+/);
      const hasPrices = /(\d+\.\d{2})\s+(\d+)\s+(\d+\.\d{2})\s*$/.test(line);
      if (itemMatch && hasPrices) count++;
    }
    if (count === 0) {
      return NextResponse.json({ error: "No valid product lines found. Make sure this is a MAS 200 PRN file." }, { status: 400 });
    }

    await put("mas200.prn", content, {
      access: "public",
      contentType: "text/plain",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({ success: true, count });
  } catch (err) {
    console.error("PRN upload error:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
