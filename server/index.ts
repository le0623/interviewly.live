import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { createMediasoupWorker } from "./sfu/worker";
import { SignalingServer } from "./signaling/server";

const PORT = process.env.SFU_PORT ? parseInt(process.env.SFU_PORT) : 3000;

async function main() {
  // Create HTTP server for Socket.IO
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Initialize mediasoup worker
  const worker = await createMediasoupWorker();

  // Initialize signaling server
  const signalingServer = new SignalingServer(io, worker);

  httpServer.listen(PORT, () => {
    console.log(`🚀 SFU Server running on port ${PORT}`);
    console.log(`📡 WebSocket signaling available at ws://localhost:${PORT}`);
  }).on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use. Please stop the other process or use a different port.`);
      console.error(`💡 You can set a different port with: SFU_PORT=3002 npm run dev:sfu`);
    } else {
      console.error("❌ Server error:", error);
    }
    process.exit(1);
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully...");
    await worker.close();
    httpServer.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
