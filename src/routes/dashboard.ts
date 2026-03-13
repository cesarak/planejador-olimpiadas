import { FastifyInstance, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const registerDashboardRoutes = async (app: FastifyInstance): Promise<void> => {
  const dashboardPath = join(process.cwd(), "public", "dashboard.html");
  const professionalDashboardPath = join(process.cwd(), "public", "dashboard-pro.html");

  const legacyHandler = async (_request: unknown, reply: FastifyReply) => {
    try {
      const html = await readFile(dashboardPath, "utf8");
      return reply.type("text/html; charset=utf-8").send(html);
    } catch (error) {
      app.log.error(error);
      return reply.type("text/plain; charset=utf-8").send("Dashboard nao encontrado.");
    }
  };

  const professionalHandler = async (_request: unknown, reply: FastifyReply) => {
    try {
      const html = await readFile(professionalDashboardPath, "utf8");
      return reply.type("text/html; charset=utf-8").send(html);
    } catch (error) {
      app.log.error(error);
      return reply.type("text/plain; charset=utf-8").send("Dashboard profissional nao encontrado.");
    }
  };

  app.get("/", legacyHandler);
  app.get("/dashboard", legacyHandler);
  app.get("/dashboard-pro", professionalHandler);
  app.get("/dashboard-v2", professionalHandler);
};
