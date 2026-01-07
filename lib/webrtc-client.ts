import { io, Socket } from "socket.io-client";
import mediasoupClient from "mediasoup-client";

export interface WebRTCClientConfig {
  sessionId: string;
  candidateInfo: { name: string; email: string };
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

export class WebRTCClient {
  private socket: Socket | null = null;
  private device: mediasoupClient.types.Device | null = null;
  private sendTransport: mediasoupClient.types.Transport | null = null;
  private videoProducer: mediasoupClient.types.Producer | null = null;
  private audioProducer: mediasoupClient.types.Producer | null = null;
  private videoProducerAcknowledged: boolean = false;
  private audioProducerAcknowledged: boolean = false;
  private mediaStream: MediaStream | null = null;
  private sessionId: string;
  private candidateInfo: { name: string; email: string };

  constructor(private config: WebRTCClientConfig) {
    this.sessionId = config.sessionId;
    this.candidateInfo = config.candidateInfo;
  }

  async connect(mediaStream: MediaStream) {
    this.mediaStream = mediaStream;

    // Get SFU URL - Next.js replaces NEXT_PUBLIC_* vars at build time
    // When using the combined server (server.ts), SFU runs on the same port as Next.js
    // Default to port 3000 (same as Next.js) when using combined server
    const sfuUrl = 
      (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SFU_URL) ||
      "http://localhost:3000";
    
    console.log(`🔌 Connecting to SFU server at: ${sfuUrl}`);
    
    this.socket = io(sfuUrl, {
      transports: ["websocket", "polling"], // Fallback to polling if websocket fails
      reconnection: false, // We'll handle reconnection manually
      timeout: 10000,
      forceNew: true, // Force a new connection
    });

    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Socket not initialized"));
        return;
      }

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!this.socket?.connected) {
          const error = new Error(
            `Failed to connect to SFU server at ${sfuUrl}. Make sure the SFU server is running on port 3001.`
          );
          console.error("❌ Connection timeout:", error.message);
          this.config.onError?.(error);
          this.socket?.disconnect();
          reject(error);
        }
      }, 10000);

      this.socket.on("connect", () => {
        clearTimeout(connectionTimeout);
        console.log("✅ Connected to SFU server");
        this.setupSocketHandlers();
        this.joinSession()
          .then(() => resolve())
          .catch((err) => {
            this.config.onError?.(err);
            reject(err);
          });
      });

      this.socket.on("connect_error", (error: any) => {
        clearTimeout(connectionTimeout);
        
        // Extract meaningful error message
        let errorMessage = `WebSocket connection failed to ${sfuUrl}`;
        
        if (error) {
          if (typeof error === "string") {
            errorMessage = error;
          } else if (error.message) {
            errorMessage = error.message;
          } else if (error.description) {
            errorMessage = error.description;
          } else if (error.toString && error.toString() !== "[object Object]") {
            errorMessage = error.toString();
          }
        }
        
        // Add helpful context
        if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("Failed to fetch")) {
          errorMessage = `Cannot connect to SFU server at ${sfuUrl}. Make sure the SFU server is running. Start it with: npm run dev:sfu`;
        }
        
        const err = error instanceof Error 
          ? new Error(errorMessage)
          : new Error(errorMessage);
        
        console.error("❌ Connection error:", err.message, "\nFull error:", error);
        this.config.onError?.(err);
        reject(err);
      });

      this.socket.on("disconnect", (reason) => {
        console.log("❌ Disconnected from SFU server:", reason);
        this.config.onDisconnected?.();
      });
    });
  }

  private setupSocketHandlers() {
    if (!this.socket) return;

    this.socket.on("router-rtp-capabilities", async (data: any) => {
      try {
        await this.loadDevice(data.rtpCapabilities);
        await this.createSendTransport();
        await this.startProducing();
      } catch (error) {
        console.error("Error setting up WebRTC:", error);
        this.config.onError?.(error as Error);
      }
    });

    this.socket.on("transport-created", (data: any) => {
      // This is handled in createSendTransport
    });

    this.socket.on("transport-connected", () => {
      console.log("✅ Transport connected");
    });

    // Note: "produced" events are now handled in startProducing() 
    // to avoid duplicate handling

    this.socket.on("recording-stopped", () => {
      console.log("✅ Recording stopped");
    });

    this.socket.on("error", (data: any) => {
      console.error("❌ Server error:", data.message);
      this.config.onError?.(new Error(data.message));
    });
  }

  private async joinSession() {
    if (!this.socket) throw new Error("Socket not initialized");

    return new Promise<void>((resolve, reject) => {
      // Send candidateInfo when joining session so it's available when recording starts
      this.socket!.emit("join-session", { 
        sessionId: this.sessionId,
        candidateInfo: this.candidateInfo
      });
      // Wait for router-rtp-capabilities to resolve
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for router capabilities"));
      }, 10000);

      this.socket!.once("router-rtp-capabilities", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async loadDevice(rtpCapabilities: mediasoupClient.types.RtpCapabilities) {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      console.log("✅ Device loaded");
    } catch (error) {
      console.error("Error loading device:", error);
      throw error;
    }
  }

  private async createSendTransport() {
    if (!this.socket || !this.device) {
      throw new Error("Socket or device not initialized");
    }

    return new Promise<void>((resolve, reject) => {
      this.socket!.emit("create-transport", {
        sessionId: this.sessionId,
        direction: "send",
      });

      this.socket!.once("transport-created", async (data: any) => {
        try {
          this.sendTransport = this.device!.createSendTransport({
            id: data.id,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters,
          });

          // Set up "produce" event handler BEFORE calling produce()
          // This is required by mediasoup-client - it will be called when transport.produce() is invoked
          this.sendTransport.on(
            "produce",
            async ({ kind, rtpParameters }, callback, errback) => {
              try {
                console.log(`📤 Producing ${kind} track...`);
                
                // Set up one-time listener for this specific produce request
                const producedHandler = (data: any) => {
                  if (data.kind === kind) {
                    console.log(`✅ Server acknowledged ${kind} producer: ${data.id}`);
                    callback({ id: data.id });
                    this.socket!.off("produced", producedHandler);
                    this.socket!.off("error", errorHandler);
                  }
                };

                const errorHandler = (errorData: any) => {
                  const errorMessage = errorData?.message || "Failed to produce";
                  console.error(`❌ Produce error for ${kind}:`, errorMessage);
                  errback(new Error(errorMessage));
                  this.socket!.off("produced", producedHandler);
                  this.socket!.off("error", errorHandler);
                };

                this.socket!.on("produced", producedHandler);
                this.socket!.on("error", errorHandler);

                // Send produce request to server
                this.socket!.emit("produce", {
                  sessionId: this.sessionId,
                  transportId: this.sendTransport!.id,
                  kind,
                  rtpParameters,
                });
              } catch (error) {
                console.error(`❌ Error in produce handler for ${kind}:`, error);
                errback(error as Error);
              }
            }
          );

          this.sendTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
              try {
                this.socket!.emit("connect-transport", {
                  sessionId: this.sessionId,
                  transportId: this.sendTransport!.id,
                  dtlsParameters,
                });

                this.socket!.once("transport-connected", () => {
                  callback();
                });
              } catch (error) {
                errback(error as Error);
              }
            }
          );

          this.sendTransport.on("connectionstatechange", (state) => {
            console.log(`📡 Transport state: ${state}`);
            if (state === "failed" || state === "disconnected") {
              this.config.onError?.(new Error(`Transport ${state}`));
            }
          });

          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async startProducing() {
    if (!this.sendTransport || !this.mediaStream || !this.device) {
      throw new Error("Transport, media stream, or device not initialized");
    }

    try {
      // Set up listeners for producer acknowledgments
      const producerPromises: Promise<void>[] = [];

      // Produce audio
      const audioTrack = this.mediaStream.getAudioTracks()[0];
      if (audioTrack) {
        console.log("🎤 Starting audio production...");
        const audioPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout waiting for audio producer"));
          }, 10000);

          const handler = (data: any) => {
            if (data.kind === "audio") {
              clearTimeout(timeout);
              this.socket!.off("produced", handler);
              this.audioProducerAcknowledged = true;
              console.log("✅ Audio producer acknowledged by server");
              resolve();
            }
          };

          this.socket!.on("produced", handler);
        });

        // Call produce() - this will trigger the "produce" event handler we set up
        const audioProducer = await this.sendTransport.produce({
          track: audioTrack,
        });

        this.audioProducer = audioProducer;
        console.log(`✅ Audio producer created locally: ${audioProducer.id}`);
        producerPromises.push(audioPromise);
      }

      // Produce video (after audio so server-side recording can include both tracks reliably)
      const videoTrack = this.mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        console.log("🎥 Starting video production...");
        const videoPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout waiting for video producer"));
          }, 10000);

          const handler = (data: any) => {
            if (data.kind === "video") {
              clearTimeout(timeout);
              this.socket!.off("produced", handler);
              this.videoProducerAcknowledged = true;
              console.log("✅ Video producer acknowledged by server");
              resolve();
            }
          };

          this.socket!.on("produced", handler);
        });

        // Call produce() - this will trigger the "produce" event handler we set up
        const videoProducer = await this.sendTransport.produce({
          track: videoTrack,
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
        });

        this.videoProducer = videoProducer;
        console.log(`✅ Video producer created locally: ${videoProducer.id}`);
        producerPromises.push(videoPromise);
      }

      // Wait for all producers to be acknowledged by server
      await Promise.all(producerPromises);

      // Both producers are now created and acknowledged
      console.log("✅ All producers created and acknowledged");
      
      // Note: candidateInfo is already sent when joining the session,
      // so no need to send it again here
      
      this.config.onConnected?.();
    } catch (error) {
      console.error("Error producing tracks:", error);
      throw error;
    }
  }

  async stop() {
    if (this.videoProducer) {
      this.videoProducer.close();
      this.videoProducer = null;
    }

    if (this.audioProducer) {
      this.audioProducer.close();
      this.audioProducer = null;
    }

    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }

    if (this.socket) {
      this.socket.emit("stop-recording", { sessionId: this.sessionId });
      this.socket.disconnect();
      this.socket = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  isConnected(): boolean {
    return (
      this.socket?.connected === true &&
      this.sendTransport?.connectionState === "connected"
    );
  }
}
