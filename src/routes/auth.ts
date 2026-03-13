import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getBearerToken, hashPassword, signAuthToken, verifyAuthToken, verifyPassword } from "../lib/auth";

const signupSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(160),
  password: z.string().min(6).max(128),
  organizationName: z.string().min(2).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(6).max(128),
});

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const sanitizeUser = (user: { id: string; name: string; email: string; tenantId: string }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  tenantId: user.tenantId,
});

export const registerAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post("/api/auth/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido para cadastro.",
        errors: parsed.error.issues,
      });
    }

    const email = normalizeEmail(parsed.data.email);

    try {
      const existingUser = await prisma.appUser.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existingUser) {
        return reply.status(409).send({ message: "Ja existe usuario com este e-mail." });
      }

      const created = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: parsed.data.organizationName?.trim() || `Organizacao de ${parsed.data.name.trim()}`,
          },
          select: { id: true, name: true },
        });

        const user = await tx.appUser.create({
          data: {
            tenantId: tenant.id,
            name: parsed.data.name.trim(),
            email,
            passwordHash: hashPassword(parsed.data.password),
          },
          select: {
            id: true,
            name: true,
            email: true,
            tenantId: true,
          },
        });

        return { tenant, user };
      });

      const token = signAuthToken({
        userId: created.user.id,
        tenantId: created.user.tenantId,
        email: created.user.email,
      });

      return reply.status(201).send({
        status: "ok",
        token,
        user: sanitizeUser(created.user),
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        message: "Falha ao criar usuario.",
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido para login.",
        errors: parsed.error.issues,
      });
    }

    const email = normalizeEmail(parsed.data.email);

    try {
      const user = await prisma.appUser.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          tenantId: true,
          passwordHash: true,
        },
      });

      if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
        return reply.status(401).send({ message: "Credenciais invalidas." });
      }

      const token = signAuthToken({
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
      });

      return reply.status(200).send({
        status: "ok",
        token,
        user: sanitizeUser(user),
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        message: "Falha ao autenticar usuario.",
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    const token = getBearerToken(request.headers.authorization);
    if (!token) {
      return reply.status(401).send({ message: "Token de autenticacao ausente." });
    }

    const payload = verifyAuthToken(token);
    if (!payload) {
      return reply.status(401).send({ message: "Token invalido ou expirado." });
    }

    try {
      const user = await prisma.appUser.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          name: true,
          email: true,
          tenantId: true,
        },
      });

      if (!user) {
        return reply.status(401).send({ message: "Usuario nao encontrado para este token." });
      }

      return reply.status(200).send({
        status: "ok",
        user: sanitizeUser(user),
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        message: "Falha ao consultar usuario autenticado.",
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });
};
