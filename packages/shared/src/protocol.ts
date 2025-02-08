import { z } from "zod";

export const transportDirectionSchema = z.enum(["send", "recv", "sendrecv"]);
export type TransportDirection = z.infer<typeof transportDirectionSchema>;

export const mediaKindSchema = z.enum(["audio", "video"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const peerInfoSchema = z.object({
  peerId: z.string(),
  displayName: z.string(),
});

export type PeerInfo = z.infer<typeof peerInfoSchema>;

export const roomJoinPayloadSchema = z.object({
  roomId: z.string().min(1),
  displayName: z.string().min(1).max(64),
});

export const roomLeavePayloadSchema = z.object({}).optional();

export const mediaGetRouterRtpCapabilitiesPayloadSchema = z.object({}).optional();

export const mediaCreateWebRtcTransportPayloadSchema = z.object({
  direction: transportDirectionSchema,
});

export const mediaConnectWebRtcTransportPayloadSchema = z.object({
  transportId: z.string(),
  dtlsParameters: z.record(z.unknown()),
});

export const mediaProducePayloadSchema = z.object({
  transportId: z.string(),
  kind: mediaKindSchema,
  rtpParameters: z.record(z.unknown()),
});

export const mediaConsumePayloadSchema = z.object({
  transportId: z.string(),
  producerId: z.string(),
  rtpCapabilities: z.record(z.unknown()),
});

export const mediaResumeConsumerPayloadSchema = z.object({
  consumerId: z.string(),
});

export const clientMessagePayloadSchemas = {
  "room.join": roomJoinPayloadSchema,
  "room.leave": roomLeavePayloadSchema,
  "media.getRouterRtpCapabilities": mediaGetRouterRtpCapabilitiesPayloadSchema,
  "media.createWebRtcTransport": mediaCreateWebRtcTransportPayloadSchema,
  "media.connectWebRtcTransport": mediaConnectWebRtcTransportPayloadSchema,
  "media.produce": mediaProducePayloadSchema,
  "media.consume": mediaConsumePayloadSchema,
  "media.resumeConsumer": mediaResumeConsumerPayloadSchema,
} as const;

export type ClientMessageType = keyof typeof clientMessagePayloadSchemas;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("room.join"),
    requestId: z.string().optional(),
    payload: roomJoinPayloadSchema,
  }),
  z.object({
    type: z.literal("room.leave"),
    requestId: z.string().optional(),
    payload: roomLeavePayloadSchema,
  }),
  z.object({
    type: z.literal("media.getRouterRtpCapabilities"),
    requestId: z.string().optional(),
    payload: mediaGetRouterRtpCapabilitiesPayloadSchema,
  }),
  z.object({
    type: z.literal("media.createWebRtcTransport"),
    requestId: z.string().optional(),
    payload: mediaCreateWebRtcTransportPayloadSchema,
  }),
  z.object({
    type: z.literal("media.connectWebRtcTransport"),
    requestId: z.string().optional(),
    payload: mediaConnectWebRtcTransportPayloadSchema,
  }),
  z.object({
    type: z.literal("media.produce"),
    requestId: z.string().optional(),
    payload: mediaProducePayloadSchema,
  }),
  z.object({
    type: z.literal("media.consume"),
    requestId: z.string().optional(),
    payload: mediaConsumePayloadSchema,
  }),
  z.object({
    type: z.literal("media.resumeConsumer"),
    requestId: z.string().optional(),
    payload: mediaResumeConsumerPayloadSchema,
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface RoomJoinedPayload {
  roomId: string;
  peerId: string;
  peers: PeerInfo[];
}

export interface RoomPeerJoinedPayload {
  peer: PeerInfo;
}

export interface RoomPeerLeftPayload {
  peerId: string;
}

export interface MediaRouterRtpCapabilitiesPayload {
  rtpCapabilities: Record<string, unknown>;
}

export interface MediaWebRtcTransportCreatedPayload {
  transportId: string;
  iceParameters: Record<string, unknown>;
  iceCandidates: Record<string, unknown>[];
  dtlsParameters: Record<string, unknown>;
}

export interface MediaProducedPayload {
  producerId: string;
}

export interface MediaNewProducerPayload {
  peerId: string;
  producerId: string;
  kind: MediaKind;
}

export interface MediaConsumedPayload {
  consumerId: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: Record<string, unknown>;
}

export type ServerMessage =
  | { type: "room.joined"; requestId?: string; payload: RoomJoinedPayload }
  | { type: "room.peerJoined"; payload: RoomPeerJoinedPayload }
  | { type: "room.peerLeft"; payload: RoomPeerLeftPayload }
  | { type: "media.routerRtpCapabilities"; requestId?: string; payload: MediaRouterRtpCapabilitiesPayload }
  | { type: "media.webRtcTransportCreated"; requestId?: string; payload: MediaWebRtcTransportCreatedPayload }
  | { type: "media.produced"; requestId?: string; payload: MediaProducedPayload }
  | { type: "media.newProducer"; payload: MediaNewProducerPayload }
  | { type: "media.consumed"; requestId?: string; payload: MediaConsumedPayload }
  | { type: "error"; requestId?: string; payload: import("./errors.js").ErrorPayload };

export interface ServerInfo {
  host: string;
  announcedIp: string;
  httpPort: number;
  wsPath: string;
  wsUrl: string;
  rtcMinPort: number;
  rtcMaxPort: number;
  version: string;
  mdnsEnabled: boolean;
  mdnsServiceName: string;
}

export interface HealthResponse {
  status: "ok";
  uptime: number;
}

export interface CreateRoomRequest {
  roomId?: string;
}

export interface RoomSummary {
  roomId: string;
  peerCount: number;
  createdAt: string;
}

export interface CreateRoomResponse {
  room: RoomSummary;
}

export interface ListRoomsResponse {
  rooms: RoomSummary[];
}

export interface GetRoomResponse {
  room: RoomSummary;
}

export interface ApiErrorResponse {
  error: import("./errors.js").ErrorPayload;
}
