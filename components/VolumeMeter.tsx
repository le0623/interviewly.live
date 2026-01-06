"use client";

import { useEffect, useState, useRef } from "react";

interface VolumeMeterProps {
  audioLevel: number; // 0 to 1
}

export default function VolumeMeter({ audioLevel }: VolumeMeterProps) {
  const [smoothedLevel, setSmoothedLevel] = useState(0);
  const previousLevelRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Exponential Moving Average (EMA) for smooth volume meter
    // Higher alpha = more responsive, lower alpha = smoother
    const alpha = 0.2; // Balanced smoothing for natural movement

    const animate = () => {
      const current = previousLevelRef.current;
      
      // Apply EMA smoothing
      // When audio drops, use slower decay for smooth fade
      const smoothingFactor = audioLevel < 0.05 ? 0.1 : alpha;
      const smoothed = smoothingFactor * audioLevel + (1 - smoothingFactor) * current;
      
      previousLevelRef.current = smoothed;
      setSmoothedLevel(smoothed);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioLevel]);

  // Calculate the number of active segments (Google Meet style)
  // Google Meet typically shows 4-5 segments
  const totalSegments = 5;
  // Only show active segments if level is above threshold (to avoid showing 1 bar when silent)
  const threshold = 0.02; // 2% threshold - below this is considered silence
  const activeSegments = smoothedLevel > threshold 
    ? Math.max(1, Math.ceil(smoothedLevel * totalSegments))
    : 0; // Show 0 bars when silent

  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-2">
      {/* Microphone icon with glass effect */}
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur-md border border-white/20">
        <svg
          className="h-4 w-4 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
      </div>

      {/* Volume meter bars - Google Meet style */}
      <div className="flex items-end gap-0.5 rounded-full bg-black/50 backdrop-blur-md border border-white/20 px-2 py-1.5">
        {Array.from({ length: totalSegments }).map((_, index) => {
          const isActive = index < activeSegments;
          // Each segment has different height for visual hierarchy (Google Meet style)
          const heights = [10, 14, 18, 14, 10]; // Middle segments taller

          return (
            <div
              key={index}
              className={`w-1 rounded-full transition-all duration-150 ease-out ${
                isActive
                  ? "bg-green-400" // Green when active (like Google Meet)
                  : "bg-white/20" // Dim when inactive
              }`}
              style={{
                height: `${heights[index]}px`,
                minHeight: "4px",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
