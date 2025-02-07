/**
 * Smoke test: join a room and request router RTP capabilities over WebSocket.
 * Usage: pnpm --filter @packet-bridge/core smoke (with server running)
 */
import WebSocket from "ws";

const baseUrl = process.env.SMOKE_WS_URL ?? "ws://127.0.0.1:3000/ws";
const roomId = process.env.SMOKE_ROOM_ID ?? "smoke-room";

function send(socket: WebSocket, message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = `req-${Date.now()}`;
    const payload = { ...(message as object), requestId };

    const onMessage = (data: WebSocket.RawData) => {
      const parsed = JSON.parse(data.toString()) as { type: string; requestId?: string };
      if (parsed.requestId === requestId) {
        socket.off("message", onMessage);
        resolve(parsed);
      }
    };

    socket.on("message", onMessage);
    socket.send(JSON.stringify(payload));

    setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timeout waiting for response to ${(message as { type: string }).type}`));
    }, 5000);
  });
}

async function main(): Promise<void> {
  const socket = new WebSocket(baseUrl);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  const joined = (await send(socket, {
    type: "room.join",
    payload: { roomId, displayName: "smoke-tester" },
  })) as { type: string; payload: { peerId: string } };

  if (joined.type !== "room.joined") {
    throw new Error(`Expected room.joined, got ${joined.type}`);
  }

  const caps = (await send(socket, {
    type: "media.getRouterRtpCapabilities",
    payload: {},
  })) as { type: string; payload: { rtpCapabilities: unknown } };

  if (caps.type !== "media.routerRtpCapabilities") {
    throw new Error(`Expected media.routerRtpCapabilities, got ${caps.type}`);
  }

  if (!caps.payload.rtpCapabilities) {
    throw new Error("Missing rtpCapabilities in response");
  }

  console.log("Smoke test passed:", { peerId: joined.payload.peerId, roomId });
  socket.close();
}

void main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
