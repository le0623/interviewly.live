import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import next from "next";
import { createMediasoupWorker } from "./server/sfu/worker";
import { SignalingServer } from "./server/signaling/server";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST_NAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

// Clean up Next.js lock file if it exists (from previous crashed process)
if (dev) {
  const lockFile = join(process.cwd(), ".next", "dev", "lock");
  if (existsSync(lockFile)) {
    try {
      unlinkSync(lockFile);
      console.log("🧹 Cleaned up stale Next.js lock file");
    } catch (error) {
      console.warn("⚠️ Could not remove lock file (may be in use):", error);
    }
  }
}

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

let httpServer: ReturnType<typeof createServer> | null = null;
let worker: Awaited<ReturnType<typeof createMediasoupWorker>> | null = null;

app.prepare().then(async () => {
  // Create HTTP server for both Next.js and Socket.IO
  httpServer = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  // Initialize Socket.IO on the same server
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || `http://${hostname}:${port}`,
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
  });

  // Initialize mediasoup worker
  worker = await createMediasoupWorker();

  // Initialize signaling server
  const signalingServer = new SignalingServer(io, worker);

  // Start the combined server
  httpServer.listen(port, () => {
    console.log(`🚀 Next.js app running on http://${hostname}:${port}`);
    console.log(`🚀 SFU Server running on port ${port} (same server)`);
    console.log(`📡 WebSocket signaling available at ws://${hostname}:${port}/socket.io`);
    console.log(`💡 SFU URL: http://${hostname}:${port}`);
  });

  // Handle server errors
  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`❌ Port ${port} is already in use. Please stop the other process or use a different port.`);
      console.error(`💡 You can set a different port with: PORT=3001 npm run dev`);
      process.exit(1);
    } else {
      console.error("❌ Server error:", error);
      process.exit(1);
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n🛑 Shutting down gracefully...");
    
    // Close mediasoup worker
    if (worker) {
      try {
        await worker.close();
        console.log("✅ Mediasoup worker closed");
      } catch (error) {
        console.error("❌ Error closing worker:", error);
      }
    }
    
    // Close HTTP server
    if (httpServer) {
      httpServer.close(() => {
        console.log("✅ HTTP server closed");
        
        // Clean up Next.js lock file in dev mode
        if (dev) {
          const lockFile = join(process.cwd(), ".next", "dev", "lock");
          if (existsSync(lockFile)) {
            try {
              unlinkSync(lockFile);
              console.log("🧹 Cleaned up Next.js lock file");
            } catch (error) {
              // Ignore errors - file might already be deleted
            }
          }
        }
        
        process.exit(0);
      });
      
      // Force close after 5 seconds if graceful shutdown doesn't complete
      setTimeout(() => {
        console.log("⚠️ Forcing shutdown after timeout");
        process.exit(1);
      }, 5000);
    } else {
      process.exit(0);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  
  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    console.error("❌ Uncaught exception:", error);
    shutdown();
  });
  
  process.on("unhandledRejection", (reason, promise) => {
    console.error("❌ Unhandled rejection at:", promise, "reason:", reason);
    shutdown();
  });
});
