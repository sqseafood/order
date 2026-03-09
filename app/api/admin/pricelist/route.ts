import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

    const content = await file.text();

    // Validate — count parseable product lines
    let count = 0;
    for (const line of content.split(/\r?\n/)) {
      const code = line.length > 47 ? line.substring(31, 47).trim() : "";
      const hasPrices = /([\d]+\.[\d]{2})\s+([\d]+\.[\d]{2})\s*$/.test(line);
      if (/^[A-Z][A-Z0-9]{2,7}$/.test(code) && hasPrices) count++;
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
