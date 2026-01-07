import * as mediasoup from "mediasoup";
import os from "os";

export async function createMediasoupWorker() {
  const worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    dtlsCertificateFile: undefined,
    dtlsPrivateKeyFile: undefined,
  });

  console.log(`✅ Mediasoup worker created (PID: ${worker.pid})`);

  worker.on("died", () => {
    console.error("❌ Mediasoup worker died, exiting...");
    process.exit(1);
  });

  return worker;
}

export function getMediasoupRouterCapabilities(worker: mediasoup.types.Worker) {
  return {
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
          "x-google-start-bitrate": 1000,
        },
      },
      {
        kind: "video",
        mimeType: "video/VP9",
        clockRate: 90000,
        parameters: {
          "profile-id": 2,
          "x-google-start-bitrate": 1000,
        },
      },
      {
        kind: "video",
        mimeType: "video/h264",
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f",
          "level-asymmetry-allowed": 1,
        },
      },
    ],
  };
}
