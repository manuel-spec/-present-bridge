import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@packet-bridge/shared";
import WebSocket from "ws";
import { AppError } from "../lib/errors.js";
import { PeerSession } from "../domain/peer/peer-session.js";
import {
  createMockMediasoupTransport,
  createMockRouter,
  createTestEnv,
} from "../test/helpers.js";
import type { RouterManager } from "./router-manager.js";
import { SfuService } from "./sfu-service.js";

describe("SfuService", () => {
  let router: ReturnType<typeof createMockRouter>;
  let routerManager: RouterManager;
  let session: PeerSession;
  let socket: WebSocket;

  beforeEach(() => {
    router = createMockRouter();
    routerManager = {
      getOrCreateRouter: vi.fn().mockResolvedValue(router),
      getRouter: vi.fn().mockReturnValue(router),
      closeRouter: vi.fn().mockResolvedValue(undefined),
    } as unknown as RouterManager;

    socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    session = new PeerSession("peer-1", "Alice", socket);
  });

  it("returns router RTP capabilities", async () => {
    const service = new SfuService(createTestEnv(), routerManager);
    const caps = await service.getRouterRtpCapabilities("room-a");
    expect(caps).toEqual(router.rtpCapabilities);
  });

  it("creates and stores a WebRTC transport", async () => {
    const service = new SfuService(createTestEnv(), routerManager);
    const created = await service.createWebRtcTransport("room-a", session, "sendrecv");

    expect(created.transportId).toBe("transport-1");
    expect(session.transports.has("transport-1")).toBe(true);
    expect(router.createWebRtcTransport).toHaveBeenCalledOnce();
  });

  it("connects an existing transport", async () => {
    const transport = createMockMediasoupTransport();
    session.transports.set("transport-1", transport as never);

    const service = new SfuService(createTestEnv(), routerManager);
    await service.connectWebRtcTransport(session, "transport-1", { role: "client" });

    expect(transport.connect).toHaveBeenCalledOnce();
  });

  it("produces media on a transport", async () => {
    const transport = createMockMediasoupTransport();
    session.transports.set("transport-1", transport as never);

    const service = new SfuService(createTestEnv(), routerManager);
    const producerId = await service.produce(session, "transport-1", "video", { codecs: [] });

    expect(producerId).toBe("producer-1");
    expect(session.producers.has("producer-1")).toBe(true);
  });

  it("consumes a producer when router allows it", async () => {
    const transport = createMockMediasoupTransport("transport-2");
    session.transports.set("transport-2", transport as never);

    const service = new SfuService(createTestEnv(), routerManager);
    const consumed = await service.consume(
      "room-a",
      session,
      "transport-2",
      "producer-9",
      { codecs: [] },
    );

    expect(consumed.consumerId).toBe("consumer-1");
    expect(session.consumers.has("consumer-1")).toBe(true);
  });

  it("throws when router is missing during consume", async () => {
    vi.mocked(routerManager.getRouter).mockReturnValue(undefined);
    const service = new SfuService(createTestEnv(), routerManager);

    await expect(
      service.consume("room-a", session, "transport-1", "producer-9", {}),
    ).rejects.toMatchObject({ code: ErrorCode.MEDIA_ERROR });
  });

  it("throws when router cannot consume", async () => {
    router.canConsume.mockReturnValue(false);
    const service = new SfuService(createTestEnv(), routerManager);

    await expect(
      service.consume("room-a", session, "transport-1", "producer-9", {}),
    ).rejects.toMatchObject({ code: ErrorCode.MEDIA_ERROR });
  });

  it("throws when transport is missing", async () => {
    const service = new SfuService(createTestEnv(), routerManager);
    await expect(service.connectWebRtcTransport(session, "missing", {})).rejects.toMatchObject({
      code: ErrorCode.TRANSPORT_NOT_FOUND,
    });
  });

  it("resumes an existing consumer", async () => {
    const consumer = { resume: vi.fn().mockResolvedValue(undefined) };
    session.consumers.set("consumer-1", consumer as never);

    const service = new SfuService(createTestEnv(), routerManager);
    await service.resumeConsumer(session, "consumer-1");

    expect(consumer.resume).toHaveBeenCalledOnce();
  });

  it("throws when consumer is missing", async () => {
    const service = new SfuService(createTestEnv(), routerManager);
    await expect(service.resumeConsumer(session, "missing")).rejects.toMatchObject({
      code: ErrorCode.CONSUMER_NOT_FOUND,
    });
  });

  it("closes room media via router manager", async () => {
    const service = new SfuService(createTestEnv(), routerManager);
    await service.closeRoomMedia("room-a");
    expect(routerManager.closeRouter).toHaveBeenCalledWith("room-a");
  });
});
