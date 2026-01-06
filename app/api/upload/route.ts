import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// Sanitize filename to remove unsafe characters
function sanitizeFilename(str: string): string {
  return str
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const sessionId = formData.get("sessionId") as string;
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const isFinal = formData.get("isFinal") === "true";
    const chunk = formData.get("chunk") as File | null;

    if (!sessionId || !name || !email) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const uploadsDir = path.join(process.cwd(), "uploads", sessionId);
    await fs.mkdir(uploadsDir, { recursive: true });

    const sanitizedName = sanitizeFilename(name);
    const sanitizedEmail = sanitizeFilename(email);
    const filename = `${sanitizedName}-${sanitizedEmail}.webm`;
    const filePath = path.join(uploadsDir, filename);

    if (chunk && chunk.size > 0) {
      // Append chunk to file
      const buffer = Buffer.from(await chunk.arrayBuffer());
      await fs.appendFile(filePath, buffer);
    }

    if (isFinal) {
      // Finalize the upload
      // In a real application, you might want to process the video here
      // or trigger additional processing
      return NextResponse.json({
        success: true,
        message: "Upload completed",
        filename,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Chunk uploaded",
    });
  } catch (error) {
    console.error("Error uploading video:", error);
    return NextResponse.json(
      { error: "Failed to upload video" },
      { status: 500 }
    );
  }
}
