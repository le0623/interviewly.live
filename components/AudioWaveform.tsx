"use client";

interface AudioWaveformProps {
  level: number; // 0 to 1
}

export default function AudioWaveform({ level }: AudioWaveformProps) {
  const bars = 20;
  const barHeights = Array.from({ length: bars }, (_, i) => {
    // Create a wave-like pattern based on level
    const baseHeight = level * 100;
    const variation = Math.sin((i / bars) * Math.PI * 2) * 10;
    return Math.max(5, baseHeight + variation);
  });

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Audio Level
      </div>
      <div className="flex h-16 items-end justify-center gap-1">
        {barHeights.map((height, index) => (
          <div
            key={index}
            className="w-2 rounded-t bg-blue-500 transition-all duration-75 dark:bg-blue-400"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}
