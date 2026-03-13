import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerSchedulingRoutes } from "./routes/scheduling";
import { registerCompetitionRoutes } from "./routes/competitions";
import { registerAuthRoutes } from "./routes/auth";

export const buildServer = async () => {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok" }));
  await registerDashboardRoutes(app);
  await registerAuthRoutes(app);
  await registerSchedulingRoutes(app);
  await registerCompetitionRoutes(app);

  return app;
};
