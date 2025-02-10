import type { WebSocket } from "ws";
import type { types as MediasoupTypes } from "mediasoup";

export class PeerSession {
  readonly peerId: string;
  readonly displayName: string;
  readonly socket: WebSocket;
  roomId: string | null = null;
  readonly transports = new Map<string, MediasoupTypes.WebRtcTransport>();
  readonly producers = new Map<string, MediasoupTypes.Producer>();
  readonly consumers = new Map<string, MediasoupTypes.Consumer>();

  constructor(peerId: string, displayName: string, socket: WebSocket) {
    this.peerId = peerId;
    this.displayName = displayName;
    this.socket = socket;
  }

  send(message: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  async closeMedia(): Promise<void> {
    for (const consumer of this.consumers.values()) {
      consumer.close();
    }
    this.consumers.clear();

    for (const producer of this.producers.values()) {
      producer.close();
    }
    this.producers.clear();

    for (const transport of this.transports.values()) {
      transport.close();
    }
    this.transports.clear();
  }
}
