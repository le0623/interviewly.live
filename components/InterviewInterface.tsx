"use client";

import { useState, useEffect, useRef } from "react";
import MediaControls from "./MediaControls";
import ThankYouModal from "./ThankYouModal";
import VolumeMeter from "./VolumeMeter";

interface InterviewInterfaceProps {
  sessionId: string;
  candidateInfo: { name: string; email: string };
  interviewConfig: {
    description: string;
    questions: string[];
    totalDurationSeconds: number;
  };
}

export default function InterviewInterface({
  sessionId,
  candidateInfo,
  interviewConfig,
}: InterviewInterfaceProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState<number | null>(
    null
  );
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [selectedMicrophoneId, setSelectedMicrophoneId] =
    useState<string>("");
  const [audioLevel, setAudioLevel] = useState(0);
  const audioLevelRef = useRef(0);
  const [showThankYouModal, setShowThankYouModal] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Initialize media devices
  useEffect(() => {
    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setMediaStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Set up audio analysis for waveform
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        audioContextRef.current = audioContext;

        // Get default devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(
          (d) => d.kind === "videoinput"
        );
        const audioDevices = devices.filter(
          (d) => d.kind === "audioinput"
        );
        if (videoDevices.length > 0) {
          setSelectedCameraId(videoDevices[0].deviceId);
        }
        if (audioDevices.length > 0) {
          setSelectedMicrophoneId(audioDevices[0].deviceId);
        }
      } catch (err) {
        console.error("Error accessing media devices:", err);
        alert(
          "Unable to access camera/microphone. Please check your permissions."
        );
      }
    };

    initializeMedia();

    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Update audio level for volume meter
  useEffect(() => {
    if (!analyserRef.current || !mediaStream) return;

    let isActive = true;

    const updateAudioLevel = () => {
      if (!analyserRef.current || !isActive) return;

      // Use frequency data for audio level detection
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);

      // Calculate RMS (Root Mean Square) for more accurate audio level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        sum += value * value; // Square for RMS
      }
      
      // Calculate RMS and normalize
      const rms = Math.sqrt(sum / bufferLength);
      const normalizedLevel = Math.min(1.0, (rms / 255) * 1.3); // Scale up for better visibility
      
      // Apply threshold to filter out background noise
      // Below 0.01 (1%) is considered silence
      const threshold = 0.01;
      const filteredLevel = normalizedLevel < threshold ? 0 : normalizedLevel;
      
      // Apply Exponential Moving Average (EMA) smoothing
      // This prevents jittery movements and creates smooth transitions
      const alpha = 0.3; // Smoothing factor (30% new, 70% previous)
      // When level is very low, use faster decay to reach zero
      const smoothingAlpha = filteredLevel < 0.05 ? 0.5 : alpha;
      const smoothedLevel = audioLevelRef.current * (1 - smoothingAlpha) + filteredLevel * smoothingAlpha;
      audioLevelRef.current = smoothedLevel;
      setAudioLevel(smoothedLevel);

      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    };

    updateAudioLevel();

    return () => {
      isActive = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [mediaStream]);

  // Timer for total duration
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      setElapsedTime((prev) => {
        const newTime = prev + 1;
        if (newTime >= interviewConfig.totalDurationSeconds) {
          handleStopRecording();
          return interviewConfig.totalDurationSeconds;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, interviewConfig.totalDurationSeconds]);

  const handleStartRecording = async () => {
    if (!mediaStream) return;

    try {
      const mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: "video/webm;codecs=vp8,opus",
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          // Upload chunk in real-time
          await uploadChunk(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Upload final chunk if any
        if (chunksRef.current.length > 0) {
          await finalizeUpload();
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setElapsedTime(0);
      setQuestionStartTime(Date.now());
    } catch (err) {
      console.error("Error starting recording:", err);
      alert("Failed to start recording. Please try again.");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const uploadChunk = async (chunk: Blob) => {
    try {
      const formData = new FormData();
      formData.append("chunk", chunk);
      formData.append("sessionId", sessionId);
      formData.append("name", candidateInfo.name);
      formData.append("email", candidateInfo.email);
      formData.append("isFinal", "false");

      await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      console.error("Error uploading chunk:", err);
    }
  };

  const finalizeUpload = async () => {
    try {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("name", candidateInfo.name);
      formData.append("email", candidateInfo.email);
      formData.append("isFinal", "true");

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        // Show thank you modal after successful upload
        setShowThankYouModal(true);
      } else {
        console.error("Error finalizing upload: Server returned error");
        alert("There was an error uploading your video. Please try again.");
      }
    } catch (err) {
      console.error("Error finalizing upload:", err);
      alert("There was an error uploading your video. Please try again.");
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < interviewConfig.questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setQuestionStartTime(Date.now());
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
      setQuestionStartTime(Date.now());
    }
  };

  const handleDeviceChange = async (
    deviceId: string,
    type: "camera" | "microphone"
  ) => {
    if (!mediaStream) return;

    // Update selected device ID first
    if (type === "camera") {
      setSelectedCameraId(deviceId);
    } else {
      setSelectedMicrophoneId(deviceId);
    }

    // Get current tracks
    const oldVideoTracks = mediaStream.getVideoTracks();
    const oldAudioTracks = mediaStream.getAudioTracks();

    try {
      if (type === "camera") {
        // Only change camera, keep audio tracks
        const constraints: MediaStreamConstraints = {
          video: { deviceId: { exact: deviceId } },
          audio: false, // Don't request audio
        };

        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        const newVideoTrack = newStream.getVideoTracks()[0];

        if (newVideoTrack) {
          // Remove old video tracks
          oldVideoTracks.forEach((track) => {
            mediaStream.removeTrack(track);
            track.stop();
          });

          // Add new video track
          mediaStream.addTrack(newVideoTrack);

          // Update video element
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }

          // Stop unused tracks from new stream
          newStream.getTracks().forEach((track) => {
            if (track !== newVideoTrack) {
              track.stop();
            }
          });
        }
      } else {
        // Only change microphone, keep video tracks
        const constraints: MediaStreamConstraints = {
          video: false, // Don't request video
          audio: { deviceId: { exact: deviceId } },
        };

        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        const newAudioTrack = newStream.getAudioTracks()[0];

        if (newAudioTrack) {
          // Remove old audio tracks
          oldAudioTracks.forEach((track) => {
            mediaStream.removeTrack(track);
            track.stop();
          });

          // Add new audio track
          mediaStream.addTrack(newAudioTrack);

          // Update audio analysis for microphone changes
          if (audioContextRef.current) {
            // Disconnect old analyser if exists
            if (analyserRef.current) {
              analyserRef.current.disconnect();
            }

            // Create new analyser with updated stream
            const analyser = audioContextRef.current.createAnalyser();
            const source = audioContextRef.current.createMediaStreamSource(mediaStream);
            source.connect(analyser);
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            
            // Reset audio level when switching devices
            audioLevelRef.current = 0;
            setAudioLevel(0);
          }

          // Stop unused tracks from new stream
          newStream.getTracks().forEach((track) => {
            if (track !== newAudioTrack) {
              track.stop();
            }
          });
        }
      }
    } catch (err) {
      console.error("Error changing device:", err);
      alert("Failed to change device. Please try again.");
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const questionElapsedTime = questionStartTime
    ? Math.floor((Date.now() - questionStartTime) / 1000)
    : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 rounded-lg bg-white p-4 shadow dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Interview Session
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {candidateInfo.name} ({candidateInfo.email})
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Total Time
              </div>
              <div
                className={`text-2xl font-bold ${
                  elapsedTime >= interviewConfig.totalDurationSeconds
                    ? "text-red-600"
                    : "text-gray-900 dark:text-white"
                }`}
              >
                {formatTime(elapsedTime)} /{" "}
                {formatTime(interviewConfig.totalDurationSeconds)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Video Preview */}
          <div className="space-y-4">
            <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                Camera Preview
              </h2>
              <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
                {isRecording && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-red-600 px-3 py-1">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-white"></div>
                    <span className="text-sm font-semibold text-white">
                      REC
                    </span>
                  </div>
                )}
                {/* Volume Meter - Bottom Right */}
                <VolumeMeter audioLevel={audioLevel} />
              </div>

              {/* Media Controls */}
              <div className="mt-4">
                <MediaControls
                  selectedCameraId={selectedCameraId}
                  selectedMicrophoneId={selectedMicrophoneId}
                  isRecording={isRecording}
                  onDeviceChange={handleDeviceChange}
                />
              </div>
            </div>
          </div>

          {/* Right: Interview Content */}
          <div className="space-y-4">
            {/* Description */}
            <div className="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
              <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                Interview Description
              </h2>
              <p className="text-gray-700 dark:text-gray-300">
                {interviewConfig.description}
              </p>
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                Total Questions: {interviewConfig.questions.length}
              </div>
            </div>

            {/* Current Question - Only shown when recording */}
            {isRecording ? (
              <div className="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Question {currentQuestionIndex + 1} of{" "}
                    {interviewConfig.questions.length}
                  </h2>
                  {questionStartTime && (
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Time on question: {formatTime(questionElapsedTime)}
                    </div>
                  )}
                </div>
                <div className="mb-6 rounded-md bg-gray-50 p-4 dark:bg-gray-700">
                  <p className="whitespace-pre-line text-gray-800 dark:text-gray-200">
                    {interviewConfig.questions[currentQuestionIndex]}
                  </p>
                </div>

                {/* Question Navigation */}
                <div className="mb-6 flex gap-2">
                  <button
                    onClick={handlePreviousQuestion}
                    disabled={currentQuestionIndex === 0}
                    className="flex-1 rounded-md bg-gray-200 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    Previous
                  </button>
                  <button
                    onClick={handleNextQuestion}
                    disabled={
                      currentQuestionIndex ===
                      interviewConfig.questions.length - 1
                    }
                    className="flex-1 rounded-md bg-gray-200 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    Next
                  </button>
                </div>

                {/* Stop Recording Button */}
                <div className="flex gap-4">
                  <button
                    onClick={handleStopRecording}
                    className="flex-1 rounded-md bg-red-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
                  >
                    Stop Recording
                  </button>
                </div>
              </div>
            ) : (
              /* Recording Controls - Shown before recording starts */
              <div className="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
                <div className="mb-6 text-center">
                  <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                    Ready to Start?
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    Once you start recording, the questions will appear here.
                    Make sure your camera and microphone are working properly.
                  </p>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={handleStartRecording}
                    className="flex-1 rounded-md bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                  >
                    Start Recording
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Thank You Modal */}
      <ThankYouModal
        isOpen={showThankYouModal}
        candidateName={candidateInfo.name}
      />
    </div>
  );
}
