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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { name, email } = body;

    if (!sessionId || !name || !email) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const uploadsDir = path.join(process.cwd(), "uploads", sessionId);
    await fs.mkdir(uploadsDir, { recursive: true });

    // In a real implementation, the recording would be saved by the SFU server
    // For now, we'll just acknowledge the finalization
    // The actual video file would be saved by the recording service in the SFU server

    return NextResponse.json({
      success: true,
      message: "Recording finalized",
      sessionId,
    });
  } catch (error) {
    console.error("Error finalizing recording:", error);
    return NextResponse.json(
      { error: "Failed to finalize recording" },
      { status: 500 }
    );
  }
}
