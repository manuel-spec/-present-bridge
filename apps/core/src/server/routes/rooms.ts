import type { FastifyInstance } from "fastify";
import type { CreateRoomRequest, CreateRoomResponse, GetRoomResponse, ApiErrorResponse, ListRoomsResponse } from "@bridge-packet/shared";
import { isAppError } from "../../lib/errors.js";
import type { RoomService } from "../../domain/room/room-service.js";

export function registerRoomRoutes(app: FastifyInstance, roomService: RoomService): void {
  app.get<{ Reply: ListRoomsResponse }>("/rooms", async (_request, reply) => {
    return reply.send({ rooms: roomService.listRooms() });
  });

  app.post<{ Body: CreateRoomRequest; Reply: CreateRoomResponse | ApiErrorResponse }>("/rooms", async (request, reply) => {
    try {
      const room = roomService.createRoom(request.body?.roomId);
      return reply.code(201).send({ room });
    } catch (error) {
      if (isAppError(error)) {
        return reply.code(400).send({ error: error.toPayload() });
      }
      throw error;
    }
  });

  app.get<{ Params: { roomId: string }; Reply: GetRoomResponse | ApiErrorResponse }>(
    "/rooms/:roomId",
    async (request, reply) => {
      try {
        const room = roomService.getRoom(request.params.roomId);
        return reply.send({ room });
      } catch (error) {
        if (isAppError(error)) {
          return reply.code(404).send({ error: error.toPayload() });
        }
        throw error;
      }
    },
  );
}
