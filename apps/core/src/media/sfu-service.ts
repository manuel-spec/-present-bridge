import type { MediaKind, TransportDirection } from "@bridge-packet/shared";
import { ErrorCode } from "@bridge-packet/shared";
import type { types as MediasoupTypes } from "mediasoup";
import type { Env } from "../config/env.js";
import type { PeerSession } from "../domain/peer/peer-session.js";
import { AppError } from "../lib/errors.js";
import type { RouterManager } from "./router-manager.js";

export class SfuService {
  constructor(
    private readonly env: Env,
    private readonly routerManager: RouterManager,
  ) {}

  async getRouterRtpCapabilities(roomId: string): Promise<Record<string, unknown>> {
    const router = await this.routerManager.getOrCreateRouter(roomId);
    return router.rtpCapabilities as unknown as Record<string, unknown>;
  }

  async createWebRtcTransport(
    roomId: string,
    session: PeerSession,
    direction: TransportDirection,
  ): Promise<{
    transportId: string;
    iceParameters: Record<string, unknown>;
    iceCandidates: Record<string, unknown>[];
    dtlsParameters: Record<string, unknown>;
  }> {
    const router = await this.routerManager.getOrCreateRouter(roomId);
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: this.env.announcedIp }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1_000_000,
      appData: { direction },
    });

    session.transports.set(transport.id, transport);

    return {
      transportId: transport.id,
      iceParameters: transport.iceParameters as unknown as Record<string, unknown>,
      iceCandidates: transport.iceCandidates as unknown as Record<string, unknown>[],
      dtlsParameters: transport.dtlsParameters as unknown as Record<string, unknown>,
    };
  }

  async connectWebRtcTransport(
    session: PeerSession,
    transportId: string,
    dtlsParameters: Record<string, unknown>,
  ): Promise<void> {
    const transport = this.getTransport(session, transportId);
    await transport.connect({
      dtlsParameters: dtlsParameters as MediasoupTypes.DtlsParameters,
    });
  }

  async produce(
    session: PeerSession,
    transportId: string,
    kind: MediaKind,
    rtpParameters: Record<string, unknown>,
  ): Promise<string> {
    const transport = this.getTransport(session, transportId);
    const producer = await transport.produce({
      kind,
      rtpParameters: rtpParameters as MediasoupTypes.RtpParameters,
    });

    session.producers.set(producer.id, producer);
    return producer.id;
  }

  async consume(
    roomId: string,
    session: PeerSession,
    transportId: string,
    producerId: string,
    rtpCapabilities: Record<string, unknown>,
  ): Promise<{
    consumerId: string;
    producerId: string;
    kind: MediaKind;
    rtpParameters: Record<string, unknown>;
  }> {
    const router = this.routerManager.getRouter(roomId);
    if (!router) {
      throw new AppError(ErrorCode.MEDIA_ERROR, "Router not found for room");
    }

    if (!router.canConsume({
      producerId,
      rtpCapabilities: rtpCapabilities as MediasoupTypes.RtpCapabilities,
    })) {
      throw new AppError(ErrorCode.MEDIA_ERROR, "Cannot consume producer with given capabilities");
    }

    const transport = this.getTransport(session, transportId);
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: rtpCapabilities as MediasoupTypes.RtpCapabilities,
      paused: true,
    });

    session.consumers.set(consumer.id, consumer);

    return {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind as MediaKind,
      rtpParameters: consumer.rtpParameters as unknown as Record<string, unknown>,
    };
  }

  async resumeConsumer(session: PeerSession, consumerId: string): Promise<void> {
    const consumer = session.consumers.get(consumerId);
    if (!consumer) {
      throw new AppError(ErrorCode.CONSUMER_NOT_FOUND, `Consumer not found: ${consumerId}`);
    }
    await consumer.resume();
  }

  async closeRoomMedia(roomId: string): Promise<void> {
    await this.routerManager.closeRouter(roomId);
  }

  private getTransport(session: PeerSession, transportId: string): MediasoupTypes.WebRtcTransport {
    const transport = session.transports.get(transportId);
    if (!transport) {
      throw new AppError(ErrorCode.TRANSPORT_NOT_FOUND, `Transport not found: ${transportId}`);
    }
    return transport;
  }
}
