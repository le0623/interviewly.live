import { Server as SocketIOServer, Socket } from "socket.io";
import { SFURouter } from "../sfu/router";
import { RecordingService } from "../recording/recorder";
import * as mediasoup from "mediasoup";

export class SignalingServer {
  private routers: Map<string, SFURouter> = new Map();
  // Use composite key (sessionId:producerId) to allow multiple recorders per session
  private recorders: Map<string, RecordingService> = new Map();
  private pendingRecordingStarts: Map<
    string,
    { videoProducerId: string; timeout: NodeJS.Timeout; socketId: string }
  > = new Map();
  // Track socket to session mapping for reliable disconnect handling
  private socketToSessions: Map<string, Set<string>> = new Map();
  // Store candidateInfo per socket (not per session, since multiple candidates can use same sessionId)
  private socketCandidateInfo: Map<string, { name: string; email: string }> = new Map();
  // Track which socket created which producer for proper matching
  private producerToSocket: Map<string, string> = new Map();

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
        
        // Store candidateInfo for this socket (not session, since multiple candidates can use same sessionId)
        if (candidateInfo && candidateInfo.name && candidateInfo.email) {
          this.socketCandidateInfo.set(socket.id, {
            name: candidateInfo.name,
            email: candidateInfo.email,
          });
          console.log(`📝 Candidate info stored for socket ${socket.id}: ${candidateInfo.name} (${candidateInfo.email})`);
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
            
            // Track which socket created this producer
            this.producerToSocket.set(producer.id, socket.id);

            // Recording: ensure we capture BOTH video + audio.
            // Video is typically produced first, audio shortly after.
            // If we start FFmpeg immediately on video, we miss audio permanently (SDP has no audio).
            const tryStartRecording = async (videoProducerId: string, socketId: string) => {
              // Use composite key to allow multiple recorders per session (different candidates)
              const recorderKey = `${sessionId}:${videoProducerId}`;
              
              // Prevent starting multiple recorders for the same producer
              if (this.recorders.has(recorderKey)) {
                console.log(`⚠️ Recording already exists for producer ${videoProducerId} in session ${sessionId}, skipping`);
                return;
              }

              const videoProducerInstance = router.getProducer(videoProducerId);
              if (!videoProducerInstance) {
                console.log(`⚠️ Video producer ${videoProducerId} not found for session ${sessionId}`);
                return;
              }

              // Find audio producer from the same socket/transport
              // CRITICAL: We must match by socket to avoid mixing audio from different candidates
              const socketIdForProducer = this.producerToSocket.get(videoProducerId);
              const allProducers = router.getAllProducers();
              
              // Find audio producer created by the same socket
              let audioProducer: mediasoup.types.Producer | null = null;
              if (socketIdForProducer) {
                // Find all producers from this socket
                const socketProducers = allProducers.filter((p) => 
                  this.producerToSocket.get(p.id) === socketIdForProducer
                );
                audioProducer = socketProducers.find((p) => p.kind === "audio") || null;
                
                if (!audioProducer) {
                  console.log(`ℹ️ No audio producer found yet for socket ${socketIdForProducer} (video producer: ${videoProducerId}). Recording will start without audio and add it when available.`);
                } else {
                  console.log(`✅ Found matching audio producer ${audioProducer.id} for socket ${socketIdForProducer} (video: ${videoProducerId})`);
                }
              } else {
                console.warn(`⚠️ Could not determine socket for video producer ${videoProducerId}. Cannot match audio producer.`);
              }
              
              // DO NOT use fallback to first available audio producer - this causes audio mixing!
              // If we can't match by socket, recording will proceed without audio

              const audioProducerExists = audioProducer !== null;

              // If audio doesn't exist yet, we can still start after a short timeout
              // to avoid never recording if audio fails. But prefer starting with audio.
              try {
                // Get candidateInfo for this socket (not session, since multiple candidates can use same session)
                const candidateInfo = this.socketCandidateInfo.get(socketId);
                
                const recorder = new RecordingService(
                  sessionId,
                  router,
                  videoProducerInstance,
                  candidateInfo // Pass candidateInfo when creating RecordingService
                );
                
                // Set audio producer if we found it (before calling start)
                // This ensures the recorder uses the correct audio producer for this specific candidate
                if (audioProducer) {
                  recorder.setAudioProducer(audioProducer);
                }
                
                await recorder.start();
                this.recorders.set(recorderKey, recorder);
                console.log(
                  `🎬 Recording started for session ${sessionId}, producer ${videoProducerId} (socket: ${socketId}, audioPresent=${audioProducerExists}, totalActiveRecordings=${this.recorders.size})`
                );
              } catch (error) {
                console.error(`❌ Failed to start recording for session ${sessionId}, producer ${videoProducerId}:`, error);
                // Clean up on failure
                this.recorders.delete(recorderKey);
                throw error;
              }
            };

            if (kind === "video") {
              // Use composite key to check for existing recorders
              const recorderKey = `${sessionId}:${producer.id}`;
              // Schedule recording start, giving audio a moment to arrive.
              if (!this.recorders.has(recorderKey) && !this.pendingRecordingStarts.has(sessionId)) {
                const timeout = setTimeout(() => {
                  const pending = this.pendingRecordingStarts.get(sessionId);
                  this.pendingRecordingStarts.delete(sessionId);
                  if (pending) {
                    tryStartRecording(pending.videoProducerId, pending.socketId).catch((e) =>
                      console.error("Error starting recorder (timeout):", e)
                    );
                  }
                }, 1200);

                this.pendingRecordingStarts.set(sessionId, {
                  videoProducerId: producer.id,
                  socketId: socket.id,
                  timeout,
                });
              }
            } else if (kind === "audio") {
              // Audio was just produced - check if there's a pending recording start for this socket
              // Find the pending recording that matches this socket
              const pending = this.pendingRecordingStarts.get(sessionId);
              if (pending && pending.socketId === socket.id) {
                const recorderKey = `${sessionId}:${pending.videoProducerId}`;
                if (!this.recorders.has(recorderKey)) {
                  // Audio is now available, start recording immediately
                  clearTimeout(pending.timeout);
                  this.pendingRecordingStarts.delete(sessionId);
                  console.log(`🎤 Audio producer ${producer.id} created for socket ${socket.id}, starting recording now`);
                  await tryStartRecording(pending.videoProducerId, pending.socketId);
                }
              } else {
                // Audio arrived but no pending recording for this socket, or recording already started
                // Try to find and update the existing recorder
                const audioProducerInstance = router.getProducer(producer.id);
                if (audioProducerInstance) {
                  const socketProducers = Array.from(this.producerToSocket.entries())
                    .filter(([_, sockId]) => sockId === socket.id)
                    .map(([prodId]) => prodId);
                  
                  for (const videoProdId of socketProducers) {
                    const recorderKey = `${sessionId}:${videoProdId}`;
                    const recorder = this.recorders.get(recorderKey);
                    if (recorder && !(recorder as any).audioProducer) {
                      // Recorder exists but doesn't have audio yet - set it now
                      console.log(`🎤 Adding audio producer ${producer.id} to existing recorder for session ${sessionId}, producer ${videoProdId}`);
                      recorder.setAudioProducer(audioProducerInstance);
                    }
                  }
                }
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
          
          // Update stored candidateInfo for this socket (not session, since multiple candidates can use same sessionId)
          this.socketCandidateInfo.set(socket.id, { name, email });
          
          // Also update recorder if it exists (fallback for late updates)
          // Find recorder for this socket
          const socketProducers = Array.from(this.producerToSocket.entries())
            .filter(([_, sockId]) => sockId === socket.id)
            .map(([producerId]) => producerId);
          
          for (const producerId of socketProducers) {
            const recorderKey = `${sessionId}:${producerId}`;
            const recorder = this.recorders.get(recorderKey);
            if (recorder) {
              recorder.setCandidateInfo({ name, email });
              console.log(
                `📝 Updated candidate info for session ${sessionId}, producer ${producerId}: ${name} (${email})`
              );
              break;
            }
          }
          
          console.log(
            `📝 Candidate info stored for socket ${socket.id}, session ${sessionId}: ${name} (${email})`
          );
        }
      );

      socket.on("stop-recording", async (data: { sessionId: string }) => {
        const { sessionId } = data;
        
        // Find all recorders for this socket in this session
        const socketProducers = Array.from(this.producerToSocket.entries())
          .filter(([_, sockId]) => sockId === socket.id)
          .map(([producerId]) => producerId);
        
        for (const producerId of socketProducers) {
          const recorderKey = `${sessionId}:${producerId}`;
          const recorder = this.recorders.get(recorderKey);
          if (recorder) {
            await recorder.stop();
            this.recorders.delete(recorderKey);
            socket.emit("recording-stopped", { sessionId });
            break; // Stop first recorder found (should only be one per socket)
          }
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
    // Find all recorders for this socket in this session
    const socketProducers = Array.from(this.producerToSocket.entries())
      .filter(([_, sockId]) => sockId === socketId)
      .map(([producerId]) => producerId);
    
    let stoppedAny = false;
    for (const producerId of socketProducers) {
      const recorderKey = `${sessionId}:${producerId}`;
      const recorder = this.recorders.get(recorderKey);
      if (recorder) {
        console.log(`🛑 Stopping recording for session ${sessionId}, producer ${producerId} (socket ${socketId} disconnected)`);
        try {
          await recorder.stop();
          this.recorders.delete(recorderKey);
          console.log(`✅ Recording stopped and cleaned up for session ${sessionId}, producer ${producerId}`);
          stoppedAny = true;
        } catch (error) {
          console.error(`❌ Error stopping recording for session ${sessionId}, producer ${producerId}:`, error);
          // Even if stop() fails, remove from map to prevent memory leak
          this.recorders.delete(recorderKey);
          stoppedAny = true;
        }
      }
    }
    
    // Clean up producer tracking for this socket
    for (const [producerId, sockId] of this.producerToSocket.entries()) {
      if (sockId === socketId) {
        this.producerToSocket.delete(producerId);
      }
    }
    
    if (!stoppedAny) {
      console.log(`ℹ️ No active recorder found for session ${sessionId}, socket ${socketId}`);
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
