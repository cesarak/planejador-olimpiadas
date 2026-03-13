"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const server_1 = require("./server");
const start = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL nao definida. Crie o arquivo .env a partir de .env.example.");
    }
    const app = await (0, server_1.buildServer)();
    const port = Number(process.env.PORT ?? 3333);
    try {
        await app.listen({ port, host: "0.0.0.0" });
    }
    catch (error) {
        app.log.error(error);
        process.exit(1);
    }
};
void start();
