import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@bridge-packet/shared";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async (_request, reply) => {
    const response: HealthResponse = {
      status: "ok",
      uptime: process.uptime(),
    };
    return reply.send(response);
  });
}
