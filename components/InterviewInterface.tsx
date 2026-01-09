"use client";

import { useState, useEffect, useRef } from "react";
import MediaControls from "./MediaControls";
import ThankYouModal from "./ThankYouModal";
import VolumeMeter from "./VolumeMeter";
import { WebRTCClient } from "../lib/webrtc-client";

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
  const [isRecording, setIsRecording] = useState(false); // Actual background recording state
  const [showRecordingIndicator, setShowRecordingIndicator] = useState(false); // Visual indicator state
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
  const [isFinished, setIsFinished] = useState(false); // Track if user clicked "Stop" (but still recording)
  const [countdown, setCountdown] = useState<number | null>(null); // Countdown: 3, 2, 1, null

  const videoRef = useRef<HTMLVideoElement>(null);
  const webrtcClientRef = useRef<WebRTCClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false); // Use ref to track recording state for cleanup
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Start silent recording in the background
  const startSilentRecording = async (stream: MediaStream) => {
    if (isRecordingRef.current) {
      console.log("Recording already started");
      return;
    }

    try {
      const webrtcClient = new WebRTCClient({
        sessionId,
        candidateInfo,
        onConnected: () => {
          console.log("✅ WebRTC connected and streaming (silent recording started)");
          setIsRecording(true); // Mark as actually recording
          isRecordingRef.current = true;
        },
        onDisconnected: () => {
          console.log("❌ WebRTC disconnected");
          setIsRecording(false);
          isRecordingRef.current = false;
        },
        onError: (error) => {
          console.error("❌ WebRTC error:", error);
          const errorMessage = error?.message || error?.toString() || "Unknown WebRTC error";
          // Don't show alert for silent recording, just log
          console.error(`Silent recording error: ${errorMessage}`);
        },
      });

      await webrtcClient.connect(stream);
      webrtcClientRef.current = webrtcClient;
      setIsRecording(true);
      isRecordingRef.current = true;
      console.log("🎥 Silent recording started automatically");
    } catch (err) {
      console.error("Error starting silent recording:", err);
      // Don't show alert for silent recording failures, just log
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  };

  // Initialize media devices and start silent recording
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

        // Start silent recording automatically once permissions are granted
        // candidateInfo is already available when this component mounts
        await startSilentRecording(stream);
      } catch (err) {
        console.error("Error accessing media devices:", err);
        alert(
          "Unable to access camera/microphone. Please check your permissions."
        );
      }
    };

    initializeMedia();

    // Handle tab close - stop recording when tab is closed
    const handleBeforeUnload = () => {
      if (webrtcClientRef.current && isRecordingRef.current) {
        // Stop recording silently on tab close
        // Note: This will cause the socket to disconnect, which will trigger
        // the server-side recording service to stop and finalize the recording
        webrtcClientRef.current.stop().catch(console.error);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      // Cleanup: stop recording on component unmount (tab close or navigation)
      // This is the main place where recording actually stops
      if (webrtcClientRef.current && isRecordingRef.current) {
        console.log("🛑 Stopping recording (tab closing)...");
        webrtcClientRef.current.stop().catch(console.error);
        isRecordingRef.current = false;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []); // Only run once on mount

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

  // Timer for total duration (only when showing recording indicator)
  useEffect(() => {
    if (!showRecordingIndicator) return;

    const interval = setInterval(() => {
      setElapsedTime((prev) => {
        const newTime = prev + 1;
        if (newTime >= interviewConfig.totalDurationSeconds) {
          // Time limit reached - hide indicator but keep recording
          setShowRecordingIndicator(false);
          setIsFinished(true);
          setShowThankYouModal(true);
          return interviewConfig.totalDurationSeconds;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showRecordingIndicator, interviewConfig.totalDurationSeconds]);

  const handleStartRecording = () => {
    // Start countdown animation
    if (countdown !== null) return; // Prevent starting if countdown is already running
    
    // Ensure recording is started in background first
    if (!isRecordingRef.current) {
      if (mediaStream) {
        startSilentRecording(mediaStream).then(() => {
          // Recording started, now start countdown
          startCountdown();
        }).catch((err) => {
          console.error("Error starting recording:", err);
          alert(`Failed to start recording. Please check your connection and try again.`);
        });
      }
    } else {
      // Recording already started, just start countdown
      startCountdown();
    }
  };

  const startCountdown = () => {
    // Clear any existing countdown
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    // Start with 3
    setCountdown(3);

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) {
          return null;
        }
        
        if (prev <= 1) {
          // Countdown finished - clear interval
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          
          // Show recording indicator after countdown
          setShowRecordingIndicator(true);
          setElapsedTime(0);
          setQuestionStartTime(Date.now());
          setIsFinished(false);
          return null;
        }
        
        // Decrement countdown
        return prev - 1;
      });
    }, 1000); // Update every second
  };

  const handleStopRecording = () => {
    // Just hide the recording indicator - keep recording in background
    setShowRecordingIndicator(false);
    setIsFinished(true);
    
    // Show thank you modal (but recording continues in background)
    setShowThankYouModal(true);
    
    // Note: Actual recording will stop when tab is closed (handled in useEffect cleanup)
  };

  const finalizeRecording = async () => {
    try {
      const response = await fetch(`/api/recording/${sessionId}/finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: candidateInfo.name,
          email: candidateInfo.email,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to finalize recording");
      }
    } catch (err) {
      console.error("Error finalizing recording:", err);
      // Don't show alert here as recording might still be saved
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
                {/* Countdown Overlay */}
                {countdown !== null && (
                  <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', backgroundColor: 'rgba(0, 0, 0, 0.1)' }}>
                    <div className="text-center">
                      <div
                        key={countdown}
                        className="countdown-number text-9xl font-bold text-white"
                        style={{ textShadow: '0 0 20px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 0, 0, 0.6)' }}
                      >
                        {countdown}
                      </div>
                    </div>
                  </div>
                )}
                {showRecordingIndicator && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 z-40">
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
                  isRecording={showRecordingIndicator}
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

            {/* Current Question - Only shown when showing recording indicator */}
            {showRecordingIndicator ? (
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
            ) : isFinished ? (
              /* Finished state - but recording continues in background */
              <div className="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
                <div className="mb-6 text-center">
                  <div className="mb-4 flex justify-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                      <svg
                        className="h-8 w-8 text-green-600 dark:text-green-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  </div>
                  <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                    Recording Complete
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    Your interview has been submitted. You can close this tab now.
                  </p>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
                    (Recording continues in background until tab is closed)
                  </p>
                </div>
              </div>
            ) : (
              /* Ready to start - Show recording indicator button */
              <div className="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
                <div className="mb-6 text-center">
                  <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                    Ready to Start?
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    {countdown !== null 
                      ? `Recording will start in ${countdown}...`
                      : "Click the button below to begin recording. The questions will appear here."}
                  </p>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={handleStartRecording}
                    disabled={countdown !== null}
                    className="flex-1 rounded-md bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600 dark:bg-blue-500 dark:hover:bg-blue-600 dark:disabled:hover:bg-blue-500"
                  >
                    {countdown !== null ? `Starting in ${countdown}...` : "Start Recording"}
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
