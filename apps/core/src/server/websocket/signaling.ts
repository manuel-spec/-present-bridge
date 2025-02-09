import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { SignalingDispatcher } from "../../signaling/dispatcher.js";
import type { RoomService } from "../../domain/room/room-service.js";
import type { SfuService } from "../../media/sfu-service.js";
import type { Env } from "../../config/env.js";

export async function registerSignalingWebSocket(
  app: FastifyInstance,
  env: Env,
  roomService: RoomService,
  sfuService: SfuService,
): Promise<void> {
  await app.register(websocket);

  const dispatcher = new SignalingDispatcher({ roomService, sfuService });

  app.get(env.wsPath, { websocket: true }, (socket) => {
    socket.on("message", (data) => {
      try {
        const raw = JSON.parse(data.toString()) as unknown;
        void dispatcher.handle(socket, raw);
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            payload: { code: "INVALID_MESSAGE", message: "Message must be valid JSON" },
          }),
        );
      }
    });

    socket.on("close", () => {
      void (async () => {
        try {
          const session = roomService.getSessionBySocket(socket);
          await session.closeMedia();
        } catch {
          return;
        }

        const left = roomService.leaveBySocket(socket);
        if (!left) {
          return;
        }

        if (roomService.getPeersInRoom(left.roomId).length === 0) {
          await sfuService.closeRoomMedia(left.roomId);
        }

        roomService.broadcast(left.roomId, {
          type: "room.peerLeft",
          payload: { peerId: left.peerId },
        });
      })();
    });
  });
}
