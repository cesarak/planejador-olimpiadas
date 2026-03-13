"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDashboardRoutes = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const registerDashboardRoutes = async (app) => {
    const dashboardPath = (0, node_path_1.join)(process.cwd(), "public", "dashboard.html");
    const professionalDashboardPath = (0, node_path_1.join)(process.cwd(), "public", "dashboard-pro.html");
    const legacyHandler = async (_request, reply) => {
        try {
            const html = await (0, promises_1.readFile)(dashboardPath, "utf8");
            return reply.type("text/html; charset=utf-8").send(html);
        }
        catch (error) {
            app.log.error(error);
            return reply.type("text/plain; charset=utf-8").send("Dashboard nao encontrado.");
        }
    };
    const professionalHandler = async (_request, reply) => {
        try {
            const html = await (0, promises_1.readFile)(professionalDashboardPath, "utf8");
            return reply.type("text/html; charset=utf-8").send(html);
        }
        catch (error) {
            app.log.error(error);
            return reply.type("text/plain; charset=utf-8").send("Dashboard profissional nao encontrado.");
        }
    };
    app.get("/", legacyHandler);
    app.get("/dashboard", legacyHandler);
    app.get("/dashboard-pro", professionalHandler);
    app.get("/dashboard-v2", professionalHandler);
};
exports.registerDashboardRoutes = registerDashboardRoutes;
