import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerHealthRoutes } from "./health.js";

describe("registerHealthRoutes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerHealthRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns ok status and uptime", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});
