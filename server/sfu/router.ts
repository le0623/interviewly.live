import * as mediasoup from "mediasoup";
import { types as MediasoupTypes } from "mediasoup";
import { getMediasoupRouterCapabilities } from "./worker";

export class SFURouter {
  private router: MediasoupTypes.Router | null = null;
  private transports: Map<string, MediasoupTypes.WebRtcTransport> = new Map();
  private producers: Map<string, MediasoupTypes.Producer> = new Map();
  private consumers: Map<string, MediasoupTypes.Consumer> = new Map();

  constructor(private worker: MediasoupTypes.Worker) {}

  async createRouter() {
    if (this.router) {
      return this.router;
    }

    const mediaCodecs = getMediasoupRouterCapabilities(this.worker)
      .mediaCodecs as mediasoup.types.RtpCodecCapability[];

    this.router = await this.worker.createRouter({ mediaCodecs });
    console.log("✅ Router created");
    return this.router;
  }

  getRouter() {
    if (!this.router) {
      throw new Error("Router not created. Call createRouter() first.");
    }
    return this.router;
  }

  async createWebRtcTransport(sessionId: string) {
    const router = this.getRouter();

    // In Docker, we need to listen on 0.0.0.0 to accept connections from outside the container
    // The announcedIp should be the public IP or domain that clients can reach
    const listenIp = process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0";
    const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || undefined;
    
    console.log(`🌐 Creating WebRTC transport - listenIp: ${listenIp}, announcedIp: ${announcedIp || 'auto-detect'}`);
    
    const transport = await router.createWebRtcTransport({
      listenIps: [
        {
          ip: listenIp,
          announcedIp: announcedIp,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
    });

    this.transports.set(transport.id, transport);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });

    transport.on("@close", () => {
      this.transports.delete(transport.id);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    transportId: string,
    dtlsParameters: MediasoupTypes.DtlsParameters
  ) {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }
    await transport.connect({ dtlsParameters });
  }

  async createProducer(
    transportId: string,
    rtpParameters: MediasoupTypes.RtpParameters,
    kind: "audio" | "video"
  ) {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const producer = await transport.produce({
      kind,
      rtpParameters,
    });

    this.producers.set(producer.id, producer);

    producer.on("@close", () => {
      this.producers.delete(producer.id);
    });

    return {
      id: producer.id,
      kind: producer.kind,
      rtpParameters: producer.rtpParameters,
    };
  }

  async createConsumer(
    transportId: string,
    producerId: string,
    rtpCapabilities: MediasoupTypes.RtpCapabilities
  ) {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const producer = this.producers.get(producerId);
    if (!producer) {
      throw new Error(`Producer ${producerId} not found`);
    }

    if (
      !this.getRouter().canConsume({
        producerId: producer.id,
        rtpCapabilities,
      })
    ) {
      throw new Error("Cannot consume producer");
    }

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: false,
    });

    this.consumers.set(consumer.id, consumer);

    consumer.on("@close", () => {
      this.consumers.delete(consumer.id);
    });

    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  getProducer(producerId: string) {
    return this.producers.get(producerId);
  }

  getAllProducers() {
    return Array.from(this.producers.values());
  }

  close() {
    this.transports.forEach((transport) => transport.close());
    this.transports.clear();
    this.producers.forEach((producer) => producer.close());
    this.producers.clear();
    this.consumers.forEach((consumer) => consumer.close());
    this.consumers.clear();
    if (this.router) {
      this.router.close();
      this.router = null;
    }
  }
}
