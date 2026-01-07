import { SFURouter } from "../sfu/router";
import * as mediasoup from "mediasoup";
import { types as MediasoupTypes } from "mediasoup";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { spawn, ChildProcess } from "child_process";
import fs from "fs/promises";

// Sanitize filename to remove unsafe filesystem characters but preserve spaces and dashes
function sanitizeFilename(str: string): string {
  return str
    .replace(/[<>:"|?*\x00-\x1f]/g, "") // Remove unsafe filesystem characters
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

export class RecordingService {
  private audioProducer: MediasoupTypes.Producer | null = null;
  private videoProducerInstance: MediasoupTypes.Producer | null = null;
  private audioConsumer: MediasoupTypes.Consumer | null = null;
  private videoConsumer: MediasoupTypes.Consumer | null = null;
  private recordingTransport: MediasoupTypes.PlainTransport | null = null;
  private audioRecordingTransport: MediasoupTypes.PlainTransport | null = null;
  private filePath: string = "";
  private sdpPath: string = "";
  private isRecording: boolean = false;
  private ffmpegProcess: ChildProcess | null = null;
  private candidateInfo: { name: string; email: string } | null = null;
  private ffmpegRtpPorts: { video: number; audio: number | null } = { video: 0, audio: null };

  constructor(
    private sessionId: string,
    private router: SFURouter,
    initialVideoProducer: MediasoupTypes.Producer,
    candidateInfo?: { name: string; email: string }
  ) {
    this.videoProducerInstance = initialVideoProducer;
    this.candidateInfo = candidateInfo || null;
  }

  setCandidateInfo(candidateInfo: { name: string; email: string }) {
    this.candidateInfo = candidateInfo;
  }

  async start() {
    if (this.isRecording) {
      return;
    }

    try {
      const router = this.router.getRouter();

      // Get all producers from the router
      const producers = this.router.getAllProducers();
      const videoProd = producers.find((p) => p.kind === "video");
      const audioProd = producers.find((p) => p.kind === "audio");

      if (!videoProd) {
        throw new Error("Video producer not found");
      }

      this.videoProducerInstance = videoProd;
      this.audioProducer = audioProd || null;

      // Allocate ports for FFmpeg to receive RTP
      // Each session gets unique ports based on sessionId hash
      // This allows multiple concurrent recordings without port conflicts
      // Hash-based allocation ensures same sessionId always gets same ports (useful for reconnection)
      const stableHash =
        [...this.sessionId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0) %
        20000;
      let basePort = 40000 + stableHash;
      if (basePort % 2 === 1) basePort += 1; // Ensure even port for RTP
      if (basePort > 65000) basePort = 65000; // Clamp to valid UDP range
      this.ffmpegRtpPorts.video = basePort;
      this.ffmpegRtpPorts.audio = this.audioProducer ? basePort + 2 : null;
      
      console.log(`🔌 Allocated RTP ports for session ${this.sessionId}: Video=${this.ffmpegRtpPorts.video}, Audio=${this.ffmpegRtpPorts.audio || 'N/A'}`);

      // Get router RTP capabilities for creating consumers
      const rtpCapabilities = router.rtpCapabilities;

      // Create a PlainTransport that will connect to FFmpeg's RTP ports
      // IMPORTANT: comedia must be false here because FFmpeg (receiver) won't send first.
      const recordingTransport = await router.createPlainTransport({
        listenIp: { ip: "127.0.0.1", announcedIp: undefined },
        rtcpMux: false,
        comedia: false,
      });

      this.recordingTransport = recordingTransport;

      // Create consumers FIRST to get RTP parameters for SDP generation
      if (this.videoProducerInstance) {
        const videoConsumer = await recordingTransport.consume({
          producerId: this.videoProducerInstance.id,
          rtpCapabilities,
          paused: true,
        });
        this.videoConsumer = videoConsumer;
      }

      if (this.audioProducer && this.ffmpegRtpPorts.audio) {
        // For audio, create a second transport
        const audioTransport = await router.createPlainTransport({
          listenIp: { ip: "127.0.0.1", announcedIp: undefined },
          rtcpMux: false,
          comedia: false,
        });

        this.audioRecordingTransport = audioTransport;

        const audioConsumer = await audioTransport.consume({
          producerId: this.audioProducer.id,
          rtpCapabilities,
          paused: true,
        });
        this.audioConsumer = audioConsumer;
      }

      // Now start FFmpeg with the RTP parameters we got from consumers
      await this.startFFmpegRecording();

      // Give FFmpeg a moment to bind sockets
      await new Promise((resolve) => setTimeout(resolve, 500));

      // NOW connect the transport to FFmpeg's RTP ports
      // This tells mediasoup where to send RTP packets
      await recordingTransport.connect({
        ip: "127.0.0.1",
        port: this.ffmpegRtpPorts.video,
        rtcpPort: this.ffmpegRtpPorts.video + 1,
      });

      console.log(`✅ Video transport connected, RTP will be sent to port ${this.ffmpegRtpPorts.video}`);

      if (this.audioProducer && this.ffmpegRtpPorts.audio && this.audioRecordingTransport) {
        await this.audioRecordingTransport.connect({
          ip: "127.0.0.1",
          port: this.ffmpegRtpPorts.audio,
          rtcpPort: this.ffmpegRtpPorts.audio + 1,
        });
        console.log(`✅ Audio transport connected, RTP will be sent to port ${this.ffmpegRtpPorts.audio}`);
      }

      // Start media flowing only after transports are connected and FFmpeg is ready.
      if (this.videoConsumer) {
        await this.videoConsumer.resume();
        // Ask for an immediate keyframe so FFmpeg can learn VP8 dimensions quickly.
        // mediasoup Consumer has requestKeyFrame() for video.
        if (typeof (this.videoConsumer as any).requestKeyFrame === "function") {
          (this.videoConsumer as any).requestKeyFrame();
        }
      }
      if (this.audioConsumer) {
        await this.audioConsumer.resume();
      }

      console.log(`🎥 Started recording for session ${this.sessionId}`);
      this.isRecording = true;
    } catch (error) {
      console.error("Error starting recording:", error);
      throw error;
    }
  }

  private async startFFmpegRecording() {
    if (!this.videoConsumer) {
      throw new Error("Video consumer not initialized");
    }

    const videoConsumerRtpParameters = this.videoConsumer?.rtpParameters;
    const audioConsumerRtpParameters = this.audioConsumer?.rtpParameters;

    // Use the ports we allocated for FFmpeg
    const videoRtpPort = this.ffmpegRtpPorts.video;
    const videoRtcpPort = videoRtpPort + 1;
    const audioRtpPort = this.ffmpegRtpPorts.audio;
    const audioRtcpPort = audioRtpPort ? audioRtpPort + 1 : null;

    // Create output directory
    const uploadsDir = join(process.cwd(), "uploads", this.sessionId);
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true });
    }

    // Generate filename with timestamp in format: {username} - {useremail} - {timestamp}.mkv
    // candidateInfo is now passed when creating RecordingService, so no need to wait
    const timestamp = Date.now();
    let filename: string;
    let sdpFilename: string;
    
    const candidateInfo = this.candidateInfo as { name: string; email: string } | null;
    if (candidateInfo && candidateInfo.name && candidateInfo.email) {
      const name = String(candidateInfo.name);
      const email = String(candidateInfo.email);
      const sanitizedName = sanitizeFilename(name);
      const sanitizedEmail = sanitizeFilename(email);
      filename = `${sanitizedName} - ${sanitizedEmail} - ${timestamp}.mkv`;
      sdpFilename = `${sanitizedName} - ${sanitizedEmail} - ${timestamp}.sdp`;
    } else {
      // Fallback: use sessionId if candidateInfo is not available
      console.warn(`⚠️ Using fallback filename format for session ${this.sessionId} (candidateInfo not available)`);
      filename = `${this.sessionId} - ${timestamp}.mkv`;
      sdpFilename = `${this.sessionId} - ${timestamp}.sdp`;
    }
    
    this.filePath = join(uploadsDir, filename);

    // Build FFmpeg SDP file for RTP reception
    // FFmpeg needs an SDP file to properly receive RTP streams because:
    // 1. It needs to know which UDP ports to listen on (RTP and RTCP)
    // 2. It needs codec information (VP8, Opus, payload types, clock rates, etc.)
    // 3. It needs SSRC (Synchronization Source) identifiers
    // 4. SDP (Session Description Protocol) is the standard format for describing RTP streams
    const sdpContent = this.generateSDP(
      videoRtpPort,
      videoRtcpPort,
      videoConsumerRtpParameters || this.videoConsumer!.rtpParameters,
      audioRtpPort,
      audioRtcpPort,
      audioConsumerRtpParameters
    );

    this.sdpPath = join(uploadsDir, sdpFilename);
    await fs.writeFile(this.sdpPath, sdpContent);

    // Build FFmpeg command using SDP file
    // FFmpeg will listen on the specified ports for RTP
    const ffmpegArgs: string[] = [
      "-hide_banner",
      "-loglevel", "info",
      "-protocol_whitelist", "file,udp,rtp",
      "-analyzeduration", "5000000", // 5 seconds - give FFmpeg time to analyze RTP stream
      "-probesize", "5000000", // 5MB - probe size for RTP
      "-fflags", "+genpts",
      "-i", this.sdpPath, // Use SDP file for input
      "-map", "0:v", // Map video stream
      "-c:v", "copy", // Copy video codec (VP8) - no re-encoding needed
      ...(this.audioConsumer && audioRtpPort
        ? [
            "-map", "0:a", // Map audio stream
            "-c:a", "copy", // Copy audio codec (Opus) - no re-encoding needed
          ]
        : []),
      "-f", "matroska", // Use Matroska container (more flexible than WebM for RTP)
      "-fflags", "+genpts+igndts", // Generate timestamps, ignore DTS
      "-avoid_negative_ts", "make_zero", // Handle negative timestamps
      "-y", // Overwrite output file
      this.filePath,
    ];

    console.log(`🎬 Starting FFmpeg recording to: ${this.filePath}`);
    console.log(`📡 RTP ports - Video: ${videoRtpPort}/${videoRtcpPort}, Audio: ${audioRtpPort || "N/A"}`);

    // Spawn FFmpeg process
    this.ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

    this.ffmpegProcess.stdout?.on("data", (data) => {
      // FFmpeg usually doesn't output to stdout
    });

    this.ffmpegProcess.stderr?.on("data", (data) => {
      // FFmpeg outputs to stderr by default
      const message = data.toString();
      // Log all FFmpeg output for debugging
      if (message.trim()) {
        console.log(`FFmpeg: ${message.trim()}`);
      }
    });

    this.ffmpegProcess.on("error", (error) => {
      console.error("FFmpeg process error:", error);
      if ((error as any).code === "ENOENT") {
        console.error(
          "❌ FFmpeg not found! Please install FFmpeg:\n" +
          "  Windows: choco install ffmpeg  OR  Download from https://ffmpeg.org/download.html\n" +
          "  Mac: brew install ffmpeg\n" +
          "  Linux: sudo apt-get install ffmpeg"
        );
      }
    });

    this.ffmpegProcess.on("exit", (code, signal) => {
      // Clean up SDP file
      fs.unlink(this.sdpPath).catch(() => {});
      
      if (code !== 0 && code !== null && code !== 255) {
        // 255 is often FFmpeg's exit code when stopped with 'q'
        console.error(`FFmpeg exited with code ${code}, signal ${signal}`);
      } else {
        console.log(`✅ FFmpeg recording completed: ${this.filePath}`);
      }
    });

    // Wait a bit for FFmpeg to start and bind to ports
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    console.log(`⏳ Waiting for FFmpeg to bind to ports and start receiving RTP...`);
  }

  private generateSDP(
    videoRtpPort: number,
    videoRtcpPort: number,
    videoRtpParams: MediasoupTypes.RtpParameters,
    audioRtpPort: number | null,
    audioRtcpPort: number | null,
    audioRtpParams: MediasoupTypes.RtpParameters | undefined
  ): string {
    // Get codec info from RTP parameters
    const videoCodec = videoRtpParams.codecs.find((c) => c.mimeType.startsWith("video/"));
    const audioCodec = audioRtpParams?.codecs.find((c) => c.mimeType.startsWith("audio/"));

    // Get SSRC from RTP parameters - use the first encoding's SSRC
    const videoSsrc = videoRtpParams.encodings?.[0]?.ssrc || videoRtpParams.rtcp?.cname || 1234567890;
    const audioSsrc = audioRtpParams?.encodings?.[0]?.ssrc || audioRtpParams?.rtcp?.cname || 9876543210;

    console.log(`📋 Generating SDP - Video: port ${videoRtpPort}, codec: ${videoCodec?.mimeType}, SSRC: ${videoSsrc}`);
    if (audioCodec && audioRtpPort) {
      console.log(`📋 Generating SDP - Audio: port ${audioRtpPort}, codec: ${audioCodec.mimeType}, SSRC: ${audioSsrc}`);
    }

    let sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=MediaSoup Recording
t=0 0
`;

    // Video media description
    if (videoCodec) {
      const payloadType = videoCodec.payloadType;
      const codecName = videoCodec.mimeType.split("/")[1].toUpperCase();
      sdp += `m=video ${videoRtpPort} RTP/AVP ${payloadType}
c=IN IP4 127.0.0.1
a=rtcp:${videoRtcpPort}
a=recvonly
a=rtpmap:${payloadType} ${codecName}/${videoCodec.clockRate}
`;
      if (videoCodec.parameters && Object.keys(videoCodec.parameters).length > 0) {
        const fmtp = Object.entries(videoCodec.parameters)
          .map(([k, v]) => `${k}=${v}`)
          .join(";");
        sdp += `a=fmtp:${payloadType} ${fmtp}
`;
      }
      sdp += `a=ssrc:${videoSsrc} cname:stream${videoSsrc}
`;
    }

    // Audio media description
    if (audioCodec && audioRtpPort) {
      const payloadType = audioCodec.payloadType;
      const codecName = audioCodec.mimeType.split("/")[1].toUpperCase();
      sdp += `m=audio ${audioRtpPort} RTP/AVP ${payloadType}
c=IN IP4 127.0.0.1
a=rtcp:${audioRtcpPort || audioRtpPort + 1}
a=recvonly
a=rtpmap:${payloadType} ${codecName}/${audioCodec.clockRate}/${audioCodec.channels || 2}
`;
      if (audioCodec.parameters && Object.keys(audioCodec.parameters).length > 0) {
        const fmtp = Object.entries(audioCodec.parameters)
          .map(([k, v]) => `${k}=${v}`)
          .join(";");
        sdp += `a=fmtp:${payloadType} ${fmtp}
`;
      }
      sdp += `a=ssrc:${audioSsrc} cname:stream${audioSsrc}
`;
    }

    return sdp;
  }

  async stop() {
    if (!this.isRecording) {
      return;
    }

    try {
      console.log("🛑 Stopping recording for session", this.sessionId);
      
      // First, pause consumers to stop media flow immediately
      if (this.videoConsumer) {
        try {
          await this.videoConsumer.pause();
        } catch (e) {
          // Ignore errors if already paused/closed
        }
      }
      if (this.audioConsumer) {
        try {
          await this.audioConsumer.pause();
        } catch (e) {
          // Ignore errors if already paused/closed
        }
      }

      // Close consumers to stop media flow
      if (this.audioConsumer) {
        this.audioConsumer.close();
        this.audioConsumer = null;
      }

      if (this.videoConsumer) {
        this.videoConsumer.close();
        this.videoConsumer = null;
      }

      // Close transports to stop RTP flow
      if (this.audioRecordingTransport) {
        this.audioRecordingTransport.close();
        this.audioRecordingTransport = null;
      }

      if (this.recordingTransport) {
        this.recordingTransport.close();
        this.recordingTransport = null;
      }

      // Note: Producers are managed by the router and will be closed when the client disconnects
      // We just need to stop consuming from them

      // Stop FFmpeg process immediately - don't wait for stream end detection
      // RTP streams don't have a natural end, so FFmpeg will wait forever if we don't kill it
      if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
        console.log("🛑 Stopping FFmpeg process immediately...");
        
        // Try SIGINT first for graceful shutdown (finalizes the file)
        // But give it only 200ms - RTP streams don't respond well to SIGINT
        this.ffmpegProcess.kill("SIGINT");
        
        // Wait for FFmpeg to finish, but with very short timeout
        // If it doesn't exit quickly, force kill it immediately
        await new Promise<void>((resolve) => {
          if (this.ffmpegProcess) {
            let resolved = false;
            const exitHandler = () => {
              if (!resolved) {
                resolved = true;
                console.log("✅ FFmpeg exited gracefully");
                resolve();
              }
            };
            this.ffmpegProcess!.once("exit", exitHandler);
            
            // Force kill after 200ms if it doesn't exit (very aggressive)
            // RTP streams don't respond well to SIGINT, so we need to be very quick
            setTimeout(() => {
              if (!resolved && this.ffmpegProcess && !this.ffmpegProcess.killed) {
                console.log("⚠️ FFmpeg didn't exit in 200ms, forcing kill with SIGKILL...");
                this.ffmpegProcess.kill("SIGKILL");
                // The exit handler will still be called
              } else if (!resolved) {
                resolved = true;
                resolve();
              }
            }, 200);
          } else {
            resolve();
          }
        });
        
        this.ffmpegProcess = null;
      } else if (this.ffmpegProcess) {
        console.log("ℹ️ FFmpeg process already killed");
        this.ffmpegProcess = null;
      }

      this.isRecording = false;
      console.log(`🛑 Stopped recording for session ${this.sessionId}`);
      
      // Verify file exists and is non-empty
      try {
        const stat = await fs.stat(this.filePath);
        if (stat.size === 0) {
          console.error(`❌ Recording file is 0 bytes: ${this.filePath}`);
          console.error(
            "Likely cause: FFmpeg never received RTP (transport not connected / comedia mode / ports blocked)."
          );
        } else {
          console.log(`💾 Recording saved to: ${this.filePath} (${stat.size} bytes)`);
        }
      } catch (e) {
        console.error(`❌ Recording file was not created: ${this.filePath}`);
        console.error(
          "Likely cause: FFmpeg exited before receiving RTP. Check SFU logs for FFmpeg errors and ensure UDP ports are available."
        );
      }
    } catch (error) {
      console.error("Error stopping recording:", error);
      throw error;
    }
  }

  getFilePath() {
    return this.filePath;
  }
}
