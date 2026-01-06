"use client";

import { useState, useEffect } from "react";

interface MediaControlsProps {
  selectedCameraId: string;
  selectedMicrophoneId: string;
  isRecording: boolean;
  onDeviceChange: (deviceId: string, type: "camera" | "microphone") => void;
}

export default function MediaControls({
  selectedCameraId,
  selectedMicrophoneId,
  isRecording,
  onDeviceChange,
}: MediaControlsProps) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const enumerateDevices = async () => {
      try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === "videoinput"));
        setMicrophones(devices.filter((d) => d.kind === "audioinput"));
      } catch (err) {
        console.error("Error enumerating devices:", err);
      }
    };

    enumerateDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener(
      "devicechange",
      enumerateDevices
    );
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Camera
        </label>
        <select
          value={selectedCameraId}
          onChange={(e) => onDeviceChange(e.target.value, "camera")}
          disabled={isRecording}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {cameras.map((camera) => (
            <option key={camera.deviceId} value={camera.deviceId}>
              {camera.label || `Camera ${cameras.indexOf(camera) + 1}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Microphone
        </label>
        <select
          value={selectedMicrophoneId}
          onChange={(e) => onDeviceChange(e.target.value, "microphone")}
          disabled={isRecording}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {microphones.map((microphone) => (
            <option key={microphone.deviceId} value={microphone.deviceId}>
              {microphone.label || `Microphone ${microphones.indexOf(microphone) + 1}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
