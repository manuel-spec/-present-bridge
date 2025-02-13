import { beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { clientMessageSchema, ErrorCode, type ClientMessage } from "@packet-bridge/shared";
import { SignalingDispatcher } from "./dispatcher.js";
import { RoomService } from "../domain/room/room-service.js";
import { createMockSocket, findMessageByType, parseSentMessages } from "../test/helpers.js";
import type { SfuService } from "../media/sfu-service.js";

function createMockSfu(): SfuService {
  return {
    getRouterRtpCapabilities: vi.fn().mockResolvedValue({ codecs: [] }),
    createWebRtcTransport: vi.fn().mockResolvedValue({
      transportId: "transport-1",
      iceParameters: {},
      iceCandidates: [],
      dtlsParameters: {},
    }),
    connectWebRtcTransport: vi.fn().mockResolvedValue(undefined),
    produce: vi.fn().mockResolvedValue("producer-1"),
    consume: vi.fn().mockResolvedValue({
      consumerId: "consumer-1",
      producerId: "producer-1",
      kind: "video",
      rtpParameters: {},
    }),
    resumeConsumer: vi.fn().mockResolvedValue(undefined),
    closeRoomMedia: vi.fn().mockResolvedValue(undefined),
  } as unknown as SfuService;
}

describe("SignalingDispatcher", () => {
  let roomService: RoomService;
  let sfuService: SfuService;
  let dispatcher: SignalingDispatcher;

  beforeEach(() => {
    roomService = new RoomService();
    sfuService = createMockSfu();
    dispatcher = new SignalingDispatcher({ roomService, sfuService });
  });

  it("rejects invalid messages", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, { type: "unknown" });

    const error = findMessageByType(parseSentMessages(socket), "error");
    expect(error?.payload).toMatchObject({ code: ErrorCode.INVALID_MESSAGE });
  });

  it("handles room.join and notifies peers", async () => {
    const aliceSocket = createMockSocket();
    const bobSocket = createMockSocket();

    await dispatcher.handle(aliceSocket, {
      type: "room.join",
      requestId: "join-1",
      payload: { roomId: "room-a", displayName: "Alice" },
    });

    await dispatcher.handle(bobSocket, {
      type: "room.join",
      requestId: "join-2",
      payload: { roomId: "room-a", displayName: "Bob" },
    });

    const aliceMessages = parseSentMessages(aliceSocket);
    const bobMessages = parseSentMessages(bobSocket);

    expect(findMessageByType(aliceMessages, "room.joined")).toBeTruthy();
    expect(findMessageByType(bobMessages, "room.joined")).toBeTruthy();
    expect(findMessageByType(aliceMessages, "room.peerJoined")).toBeTruthy();
  });

  it("returns RTP capabilities for joined peer", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });

    await dispatcher.handle(socket, {
      type: "media.getRouterRtpCapabilities",
      requestId: "caps-1",
      payload: {},
    });

    expect(findMessageByType(parseSentMessages(socket), "media.routerRtpCapabilities")).toBeTruthy();
    expect(sfuService.getRouterRtpCapabilities).toHaveBeenCalledWith("room-a");
  });

  it("errors when media actions happen before join", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, {
      type: "media.getRouterRtpCapabilities",
      payload: {},
    });

    const error = findMessageByType(parseSentMessages(socket), "error");
    expect(error?.payload).toMatchObject({ code: ErrorCode.PEER_NOT_FOUND });
  });

  it("creates WebRTC transport for joined peer", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });
    await dispatcher.handle(socket, {
      type: "media.createWebRtcTransport",
      requestId: "transport-1",
      payload: { direction: "sendrecv" },
    });

    expect(findMessageByType(parseSentMessages(socket), "media.webRtcTransportCreated")).toBeTruthy();
  });

  it("handles produce and broadcasts new producer", async () => {
    const aliceSocket = createMockSocket();
    const bobSocket = createMockSocket();

    await dispatcher.handle(aliceSocket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });
    await dispatcher.handle(bobSocket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Bob" },
    });

    await dispatcher.handle(aliceSocket, {
      type: "media.produce",
      requestId: "produce-1",
      payload: { transportId: "transport-1", kind: "video", rtpParameters: {} },
    });

    expect(findMessageByType(parseSentMessages(aliceSocket), "media.produced")).toBeTruthy();
    expect(findMessageByType(parseSentMessages(bobSocket), "media.newProducer")).toBeTruthy();
  });

  it("handles consume flow", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });
    await dispatcher.handle(socket, {
      type: "media.consume",
      requestId: "consume-1",
      payload: {
        transportId: "transport-1",
        producerId: "producer-1",
        rtpCapabilities: {},
      },
    });

    expect(findMessageByType(parseSentMessages(socket), "media.consumed")).toBeTruthy();
  });

  it("handles connect and resume without response payloads", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });
    await dispatcher.handle(socket, {
      type: "media.connectWebRtcTransport",
      payload: { transportId: "transport-1", dtlsParameters: {} },
    });
    await dispatcher.handle(socket, {
      type: "media.resumeConsumer",
      payload: { consumerId: "consumer-1" },
    });

    expect(sfuService.connectWebRtcTransport).toHaveBeenCalledOnce();
    expect(sfuService.resumeConsumer).toHaveBeenCalledOnce();
  });

  it("handles room.leave and closes media when room empties", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });
    await dispatcher.handle(socket, { type: "room.leave", payload: {} });

    expect(sfuService.closeRoomMedia).toHaveBeenCalledWith("room-a");
  });

  it("keeps router open when other peers remain after leave", async () => {
    const aliceSocket = createMockSocket();
    const bobSocket = createMockSocket();

    await dispatcher.handle(aliceSocket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });
    await dispatcher.handle(bobSocket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Bob" },
    });

    vi.mocked(sfuService.closeRoomMedia).mockClear();
    await dispatcher.handle(aliceSocket, { type: "room.leave", payload: {} });

    expect(sfuService.closeRoomMedia).not.toHaveBeenCalled();
  });

  it("errors when leaving before joining a room", async () => {
    const socket = createMockSocket();
    await dispatcher.handle(socket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });

    const session = roomService.getSessionBySocket(socket);
    session.roomId = null;

    await dispatcher.handle(socket, { type: "room.leave", payload: {} });

    const error = findMessageByType(parseSentMessages(socket), "error");
    expect(error?.payload).toMatchObject({ code: ErrorCode.PEER_NOT_IN_ROOM });
  });

  it("does not send when socket is not open", async () => {
    const socket = createMockSocket();
    Object.defineProperty(socket, "readyState", { value: WebSocket.CLOSED });

    await dispatcher.handle(socket, { type: "unknown" });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("wraps internal errors with request id", async () => {
    vi.mocked(sfuService.getRouterRtpCapabilities).mockRejectedValue(new Error("boom"));
    const socket = createMockSocket();

    await dispatcher.handle(socket, {
      type: "room.join",
      payload: { roomId: "room-a", displayName: "Alice" },
    });
    await dispatcher.handle(socket, {
      type: "media.getRouterRtpCapabilities",
      requestId: "caps-error",
      payload: {},
    });

    const error = findMessageByType(parseSentMessages(socket), "error");
    expect(error?.requestId).toBe("caps-error");
    expect(error?.payload).toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
  });

  it("handles unknown internal message types", async () => {
    vi.spyOn(clientMessageSchema, "safeParse").mockReturnValue({
      success: true,
      data: { type: "room.custom", payload: {} } as unknown as ClientMessage,
    });

    const socket = createMockSocket();
    await dispatcher.handle(socket, { type: "ignored" });

    const error = findMessageByType(parseSentMessages(socket), "error");
    expect(error?.payload).toMatchObject({ code: ErrorCode.INVALID_MESSAGE });
  });
});
