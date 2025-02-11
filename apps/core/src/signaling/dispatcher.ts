import {
  clientMessageSchema,
  ErrorCode,
  type ClientMessage,
  type ServerMessage,
} from "@packet-bridge/shared";
import WebSocket from "ws";
import type { RoomService } from "../domain/room/room-service.js";
import type { SfuService } from "../media/sfu-service.js";
import { AppError, isAppError, toAppError } from "../lib/errors.js";

export interface SignalingContext {
  roomService: RoomService;
  sfuService: SfuService;
}

export class SignalingDispatcher {
  constructor(private readonly context: SignalingContext) {}

  async handle(socket: WebSocket, raw: unknown): Promise<void> {
    const parsed = clientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendError(socket, new AppError(ErrorCode.INVALID_MESSAGE, "Invalid signaling message"));
      return;
    }

    try {
      await this.dispatch(socket, parsed.data);
    } catch (error) {
      const appError = toAppError(error, parsed.data.requestId);
      this.sendError(socket, appError, parsed.data.requestId);
    }
  }

  private async dispatch(socket: WebSocket, message: ClientMessage): Promise<void> {
    const { roomService, sfuService } = this.context;

    switch (message.type) {
      case "room.join": {
        const session = roomService.joinRoom(
          message.payload.roomId,
          message.payload.displayName,
          socket,
        );
        const peers = roomService.getPeersInRoom(message.payload.roomId);

        this.send(socket, {
          type: "room.joined",
          requestId: message.requestId,
          payload: {
            roomId: message.payload.roomId,
            peerId: session.peerId,
            peers,
          },
        });

        roomService.broadcast(
          message.payload.roomId,
          {
            type: "room.peerJoined",
            payload: { peer: { peerId: session.peerId, displayName: session.displayName } },
          },
          session.peerId,
        );
        break;
      }

      case "room.leave": {
        const session = roomService.getSessionBySocket(socket);
        const roomId = session.roomId;
        if (!roomId) {
          throw new AppError(ErrorCode.PEER_NOT_IN_ROOM, "Peer is not in a room");
        }

        await session.closeMedia();
        roomService.leavePeer(session.peerId);

        if (roomService.getPeersInRoom(roomId).length === 0) {
          await sfuService.closeRoomMedia(roomId);
        }

        roomService.broadcast(roomId, {
          type: "room.peerLeft",
          payload: { peerId: session.peerId },
        });
        break;
      }

      case "media.getRouterRtpCapabilities": {
        const session = roomService.getSessionBySocket(socket);
        if (!session.roomId) {
          throw new AppError(ErrorCode.PEER_NOT_IN_ROOM, "Join a room before requesting capabilities");
        }

        const rtpCapabilities = await sfuService.getRouterRtpCapabilities(session.roomId);
        this.send(socket, {
          type: "media.routerRtpCapabilities",
          requestId: message.requestId,
          payload: { rtpCapabilities },
        });
        break;
      }

      case "media.createWebRtcTransport": {
        const session = roomService.getSessionBySocket(socket);
        if (!session.roomId) {
          throw new AppError(ErrorCode.PEER_NOT_IN_ROOM, "Join a room before creating a transport");
        }

        const transport = await sfuService.createWebRtcTransport(
          session.roomId,
          session,
          message.payload.direction,
        );

        this.send(socket, {
          type: "media.webRtcTransportCreated",
          requestId: message.requestId,
          payload: transport,
        });
        break;
      }

      case "media.connectWebRtcTransport": {
        const session = roomService.getSessionBySocket(socket);
        await sfuService.connectWebRtcTransport(
          session,
          message.payload.transportId,
          message.payload.dtlsParameters,
        );
        break;
      }

      case "media.produce": {
        const session = roomService.getSessionBySocket(socket);
        if (!session.roomId) {
          throw new AppError(ErrorCode.PEER_NOT_IN_ROOM, "Join a room before producing media");
        }

        const producerId = await sfuService.produce(
          session,
          message.payload.transportId,
          message.payload.kind,
          message.payload.rtpParameters,
        );

        this.send(socket, {
          type: "media.produced",
          requestId: message.requestId,
          payload: { producerId },
        });

        roomService.broadcast(
          session.roomId,
          {
            type: "media.newProducer",
            payload: {
              peerId: session.peerId,
              producerId,
              kind: message.payload.kind,
            },
          },
          session.peerId,
        );
        break;
      }

      case "media.consume": {
        const session = roomService.getSessionBySocket(socket);
        if (!session.roomId) {
          throw new AppError(ErrorCode.PEER_NOT_IN_ROOM, "Join a room before consuming media");
        }

        const consumed = await sfuService.consume(
          session.roomId,
          session,
          message.payload.transportId,
          message.payload.producerId,
          message.payload.rtpCapabilities,
        );

        this.send(socket, {
          type: "media.consumed",
          requestId: message.requestId,
          payload: consumed,
        });
        break;
      }

      case "media.resumeConsumer": {
        const session = roomService.getSessionBySocket(socket);
        await sfuService.resumeConsumer(session, message.payload.consumerId);
        break;
      }

      default: {
        const exhaustive: never = message;
        throw new AppError(ErrorCode.INVALID_MESSAGE, `Unhandled message type: ${(exhaustive as ClientMessage).type}`);
      }
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private sendError(socket: WebSocket, error: AppError, requestId?: string): void {
    const payload = isAppError(error) ? error.toPayload() : toAppError(error, requestId).toPayload();
    this.send(socket, { type: "error", requestId: requestId ?? payload.requestId, payload });
  }
}
