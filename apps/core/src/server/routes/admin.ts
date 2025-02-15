import type { FastifyInstance } from "fastify";
import type { AdminService } from "../../admin/admin-service.js";
import type { MetricsService } from "../../metrics/metrics-service.js";

export interface AdminRouteDeps {
  adminService: AdminService;
  metricsService: MetricsService;
  version: string;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  app.get("/admin/status", async (_request, reply) => {
    const status = await deps.adminService.getStatus({ version: deps.version });
    return reply.send(status);
  });

  app.get("/admin/diagnostics", async (_request, reply) => {
    const diagnostics = await deps.adminService.getDiagnostics({ version: deps.version });
    return reply.send(diagnostics);
  });

  app.get("/admin/rooms", async (_request, reply) => {
    const rooms = deps.adminService.getRoomInspection().rooms;
    return reply.send({ rooms });
  });

  app.get("/admin/rooms/:roomId", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const room = deps.adminService.inspectRoom(roomId);
    return reply.send(room);
  });

  app.get("/metrics", async (_request, reply) => {
    const scrape = await deps.metricsService.scrape();
    return reply.header("Content-Type", scrape.contentType).send(scrape.body);
  });
}
