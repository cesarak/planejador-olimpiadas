import "dotenv/config";
import { buildServer } from "./server";

const start = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL nao definida. Crie o arquivo .env a partir de .env.example."
    );
  }

  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3333);

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
