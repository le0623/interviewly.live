import { Server as SocketIOServer, Socket } from "socket.io";
import { SFURouter } from "../sfu/router";
import { RecordingService } from "../recording/recorder";
import * as mediasoup from "mediasoup";

export class SignalingServer {
  private routers: Map<string, SFURouter> = new Map();
  private recorders: Map<string, RecordingService> = new Map();
  private pendingRecordingStarts: Map<
    string,
    { videoProducerId: string; timeout: NodeJS.Timeout }
  > = new Map();
  // Track socket to session mapping for reliable disconnect handling
  private socketToSessions: Map<string, Set<string>> = new Map();
  // Store candidateInfo per session (available when joining)
  private sessionCandidateInfo: Map<string, { name: string; email: string }> = new Map();

  constructor(
    private io: SocketIOServer,
    private worker: mediasoup.types.Worker
  ) {
    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    this.io.on("connection", (socket: Socket) => {
      console.log(`✅ Client connected: ${socket.id}`);

      socket.on("join-session", async (data: { 
        sessionId: string; 
        candidateInfo?: { name: string; email: string } 
      }) => {
        const { sessionId, candidateInfo } = data;
        socket.join(sessionId);
        
        // Track this socket's session for reliable disconnect handling
        if (!this.socketToSessions.has(socket.id)) {
          this.socketToSessions.set(socket.id, new Set());
        }
        this.socketToSessions.get(socket.id)!.add(sessionId);
        
        // Store candidateInfo for this session (available when recording starts)
        if (candidateInfo && candidateInfo.name && candidateInfo.email) {
          this.sessionCandidateInfo.set(sessionId, {
            name: candidateInfo.name,
            email: candidateInfo.email,
          });
          console.log(`📝 Candidate info stored for session ${sessionId}: ${candidateInfo.name} (${candidateInfo.email})`);
        }
        
        console.log(`📹 Client ${socket.id} joined session ${sessionId}`);

        // Get or create router for this session
        // Each session gets its own router, allowing multiple concurrent recordings
        let router = this.routers.get(sessionId);
        if (!router) {
          router = new SFURouter(this.worker);
          await router.createRouter();
          this.routers.set(sessionId, router);
          console.log(`🆕 Created new router for session ${sessionId}`);
        }

        // Send router RTP capabilities to client
        const rtpCapabilities = router.getRouter().rtpCapabilities;
        socket.emit("router-rtp-capabilities", { rtpCapabilities });
      });

      socket.on(
        "create-transport",
        async (data: { sessionId: string; direction: "send" | "recv" }) => {
          const { sessionId, direction } = data;
          const router = this.routers.get(sessionId);

          if (!router) {
            socket.emit("error", { message: "Session not found" });
            return;
          }

          try {
            const transportParams = await router.createWebRtcTransport(
              sessionId
            );
            socket.emit("transport-created", {
              id: transportParams.id,
              iceParameters: transportParams.iceParameters,
              iceCandidates: transportParams.iceCandidates,
              dtlsParameters: transportParams.dtlsParameters,
            });
          } catch (error) {
            console.error("Error creating transport:", error);
            socket.emit("error", { message: "Failed to create transport" });
          }
        }
      );

      socket.on(
        "connect-transport",
        async (data: {
          sessionId: string;
          transportId: string;
          dtlsParameters: mediasoup.types.DtlsParameters;
        }) => {
          const { sessionId, transportId, dtlsParameters } = data;
          const router = this.routers.get(sessionId);

          if (!router) {
            socket.emit("error", { message: "Session not found" });
            return;
          }

          try {
            await router.connectTransport(transportId, dtlsParameters);
            socket.emit("transport-connected", { transportId });
          } catch (error) {
            console.error("Error connecting transport:", error);
            socket.emit("error", { message: "Failed to connect transport" });
          }
        }
      );

      socket.on(
        "produce",
        async (data: {
          sessionId: string;
          transportId: string;
          kind: "audio" | "video";
          rtpParameters: mediasoup.types.RtpParameters;
        }) => {
          const { sessionId, transportId, kind, rtpParameters } = data;
          const router = this.routers.get(sessionId);

          if (!router) {
            socket.emit("error", { message: "Session not found" });
            return;
          }

          try {
            const producer = await router.createProducer(
              transportId,
              rtpParameters,
              kind
            );

            // Recording: ensure we capture BOTH video + audio.
            // Video is typically produced first, audio shortly after.
            // If we start FFmpeg immediately on video, we miss audio permanently (SDP has no audio).
            const tryStartRecording = async (videoProducerId: string) => {
              // Prevent starting multiple recorders for the same session
              if (this.recorders.has(sessionId)) {
                console.log(`⚠️ Recording already exists for session ${sessionId}, skipping`);
                return;
              }

              const videoProducerInstance = router.getProducer(videoProducerId);
              if (!videoProducerInstance) {
                console.log(`⚠️ Video producer ${videoProducerId} not found for session ${sessionId}`);
                return;
              }

              // Check whether audio exists now.
              const audioProducerExists =
                router.getAllProducers().some((p) => p.kind === "audio");

              // If audio doesn't exist yet, we can still start after a short timeout
              // to avoid never recording if audio fails. But prefer starting with audio.
              try {
                // Get candidateInfo for this session (set when joining)
                const candidateInfo = this.sessionCandidateInfo.get(sessionId);
                
                const recorder = new RecordingService(
                  sessionId,
                  router,
                  videoProducerInstance,
                  candidateInfo // Pass candidateInfo when creating RecordingService
                );
                await recorder.start();
                this.recorders.set(sessionId, recorder);
                console.log(
                  `🎬 Recording started for session ${sessionId} (audioPresent=${audioProducerExists}, totalActiveRecordings=${this.recorders.size})`
                );
              } catch (error) {
                console.error(`❌ Failed to start recording for session ${sessionId}:`, error);
                // Clean up on failure
                this.recorders.delete(sessionId);
                throw error;
              }
            };

            if (kind === "video") {
              // Schedule recording start, giving audio a moment to arrive.
              if (!this.recorders.has(sessionId) && !this.pendingRecordingStarts.has(sessionId)) {
                const timeout = setTimeout(() => {
                  const pending = this.pendingRecordingStarts.get(sessionId);
                  this.pendingRecordingStarts.delete(sessionId);
                  if (pending) {
                    tryStartRecording(pending.videoProducerId).catch((e) =>
                      console.error("Error starting recorder (timeout):", e)
                    );
                  }
                }, 1200);

                this.pendingRecordingStarts.set(sessionId, {
                  videoProducerId: producer.id,
                  timeout,
                });
              }
            } else if (kind === "audio") {
              // If video was already produced and we're waiting, start immediately now.
              const pending = this.pendingRecordingStarts.get(sessionId);
              if (pending && !this.recorders.has(sessionId)) {
                clearTimeout(pending.timeout);
                this.pendingRecordingStarts.delete(sessionId);
                await tryStartRecording(pending.videoProducerId);
              }
            }

            socket.emit("produced", {
              id: producer.id,
              kind: producer.kind,
            });
          } catch (error) {
            console.error("Error producing:", error);
            socket.emit("error", { message: "Failed to produce" });
          }
        }
      );

      socket.on(
        "set-candidate-info",
        async (data: {
          sessionId: string;
          name: string;
          email: string;
        }) => {
          const { sessionId, name, email } = data;
          
          // Update stored candidateInfo for this session
          this.sessionCandidateInfo.set(sessionId, { name, email });
          
          // Also update recorder if it exists (fallback for late updates)
          const recorder = this.recorders.get(sessionId);
          if (recorder) {
            recorder.setCandidateInfo({ name, email });
            console.log(
              `📝 Updated candidate info for session ${sessionId}: ${name} (${email})`
            );
          } else {
            console.log(
              `📝 Candidate info stored for session ${sessionId}: ${name} (${email}) (recorder not yet created)`
            );
          }
        }
      );

      socket.on("stop-recording", async (data: { sessionId: string }) => {
        const { sessionId } = data;
        const recorder = this.recorders.get(sessionId);

        if (recorder) {
          await recorder.stop();
          this.recorders.delete(sessionId);
          socket.emit("recording-stopped", { sessionId });
        }
      });

      socket.on("disconnect", async () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
        
        // Get sessions this socket was part of from our tracking map
        const sessions = this.socketToSessions.get(socket.id);
        
        if (!sessions || sessions.size === 0) {
          // Fallback: try to get from socket.rooms
          const rooms = Array.from(socket.rooms);
          console.log(`📋 Socket ${socket.id} was in rooms (fallback):`, rooms);
          
          for (const sessionId of rooms) {
            // Skip the socket's own room (socket.id === room name)
            if (sessionId === socket.id) continue;
            await this.stopRecordingForSession(sessionId, socket.id);
          }
        } else {
          console.log(`📋 Socket ${socket.id} was in sessions:`, Array.from(sessions));
          
          // Stop recording for each session this socket was part of
          for (const sessionId of sessions) {
            await this.stopRecordingForSession(sessionId, socket.id);
          }
        }
        
        // Clean up socket tracking
        this.socketToSessions.delete(socket.id);
      });
    });
  }

  /**
   * Stop recording for a specific session
   * This method is called when a client disconnects to ensure recording stops
   */
  private async stopRecordingForSession(sessionId: string, socketId: string) {
    const recorder = this.recorders.get(sessionId);
    if (recorder) {
      console.log(`🛑 Stopping recording for session ${sessionId} (socket ${socketId} disconnected)`);
      try {
        await recorder.stop();
        this.recorders.delete(sessionId);
        console.log(`✅ Recording stopped and cleaned up for session ${sessionId}`);
      } catch (error) {
        console.error(`❌ Error stopping recording for session ${sessionId}:`, error);
        // Even if stop() fails, remove from map to prevent memory leak
        this.recorders.delete(sessionId);
      }
    } else {
      console.log(`ℹ️ No active recorder found for session ${sessionId}`);
    }
    
    // Clean up pending recording starts
    const pending = this.pendingRecordingStarts.get(sessionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRecordingStarts.delete(sessionId);
      console.log(`🧹 Cleaned up pending recording start for session ${sessionId}`);
    }
    
    // Clean up router if no other sockets are using it
    // Note: In a production system, you might want to keep routers alive longer
    // or have a cleanup mechanism based on inactivity
    const router = this.routers.get(sessionId);
    if (router) {
      // Check if any other sockets are using this session
      let hasOtherSockets = false;
      for (const [otherSocketId, sessions] of this.socketToSessions.entries()) {
        if (otherSocketId !== socketId && sessions.has(sessionId)) {
          hasOtherSockets = true;
          break;
        }
      }
      
      if (!hasOtherSockets) {
        console.log(`🧹 Cleaning up router for session ${sessionId} (no other clients)`);
        router.close();
        this.routers.delete(sessionId);
      }
    }
  }
}
