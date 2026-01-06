import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const uploadsDir = path.join(process.cwd(), "uploads", sessionId);
    const interviewJsonPath = path.join(uploadsDir, "interview.json");

    // Check if interview.json exists
    try {
      const interviewData = await fs.readFile(interviewJsonPath, "utf-8");
      return NextResponse.json(JSON.parse(interviewData));
    } catch (error) {
      // If file doesn't exist, return default configuration
      // In a real app, you might fetch this from a database
      const defaultConfig = {
        description:
          "We are a software development company, and we are looking for a software developer. We have 3 questions. Please start when you are ready.",
        questions: [
          "Please introduce yourself.\nTell us your name, location, current role, years of experience, and what type of opportunities you're looking for.",
          "Briefly describe a challenging situation you faced at work. Explain the problem, the actions you took to resolve it, and the final outcome.",
          "Have you worked remotely or with distributed teams before? Share your experience, including tools used and how you collaborated with teammates.",
        ],
        totalDurationSeconds: 600,
      };

      // Create directory if it doesn't exist
      await fs.mkdir(uploadsDir, { recursive: true });

      // Save default config
      await fs.writeFile(
        interviewJsonPath,
        JSON.stringify(defaultConfig, null, 2)
      );

      return NextResponse.json(defaultConfig);
    }
  } catch (error) {
    console.error("Error fetching interview config:", error);
    return NextResponse.json(
      { error: "Failed to fetch interview configuration" },
      { status: 500 }
    );
  }
}
