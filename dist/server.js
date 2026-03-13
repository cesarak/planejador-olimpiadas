"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServer = void 0;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const dashboard_1 = require("./routes/dashboard");
const scheduling_1 = require("./routes/scheduling");
const competitions_1 = require("./routes/competitions");
const auth_1 = require("./routes/auth");
const buildServer = async () => {
    const app = (0, fastify_1.default)({ logger: true });
    await app.register(cors_1.default, { origin: true });
    app.get("/health", async () => ({ status: "ok" }));
    await (0, dashboard_1.registerDashboardRoutes)(app);
    await (0, auth_1.registerAuthRoutes)(app);
    await (0, scheduling_1.registerSchedulingRoutes)(app);
    await (0, competitions_1.registerCompetitionRoutes)(app);
    return app;
};
exports.buildServer = buildServer;
