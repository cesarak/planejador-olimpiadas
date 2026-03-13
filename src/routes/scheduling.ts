import { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildSchedulePreview } from "../modules/scheduling/engine";
import { getBearerToken, verifyAuthToken } from "../lib/auth";
import { prisma } from "../lib/prisma";
import {
  compareScheduleVersions,
  getScheduleVersionById,
  listScheduleVersions,
  persistScheduleVersion,
} from "../modules/scheduling/persistence";

const teamSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  categoria: z.string().min(1),
  genero: z.enum(["M", "F", "X"]),
});

const modalitySchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  duracao_min: z.number().int().min(5).max(240),
  regra_genero: z.enum(["misto", "separado"]),
  formato: z.enum(["todos_contra_todos", "eliminatoria"]).optional(),
  categorias: z.array(z.string().min(1)).optional(),
  categorias_eliminatoria: z.array(z.string().min(1)).optional(),
});

const localSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  modalidades_permitidas: z.union([
    z.array(z.string().min(1)),
    z.literal("*"),
    z.null(),
  ]),
  categorias_permitidas: z.union([
    z.array(z.string().min(1)),
    z.literal("*"),
    z.null(),
  ]),
});

const blockingSchema = z.object({
  id: z.string().optional(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inicio: z.number().int().min(0).max(1439),
  fim: z.number().int().min(1).max(1440),
  motivo: z.string().min(1),
});

const competitionSchema = z.object({
  inicio_min: z.number().int().min(0).max(1439),
  fim_min: z.number().int().min(1).max(1440),
  passo_grid: z.number().int().min(5).max(60),
  dias: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
});

const legacyFormatSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "todos_contra_todos" ||
    normalized === "todos-contra-todos" ||
    normalized === "todos contra todos"
  ) {
    return "todos_contra_todos";
  }

  if (normalized === "eliminatoria" || normalized === "eliminatória") {
    return "eliminatoria";
  }

  return value;
}, z.enum(["todos_contra_todos", "eliminatoria"]).optional());

const paramsSchema = z.object({
  descanso_minimo: z.number().int().min(0),
  // Deprecated: manter por compatibilidade com payload antigo.
  formato: legacyFormatSchema,
  modo_encaixe: z.enum(["arredondar_cima", "exato"]),
  modo_ordem: z.enum([
    "curtos_primeiro",
    "longos_primeiro",
    "dificil_primeiro",
    "agrupar_categoria",
  ]),
  algoritmo: z.enum(["GREEDY", "SIMULATED_ANNEALING"]).optional(),
});

const schedulingPayloadSchema = z.object({
  teams: z.array(teamSchema),
  modalidades: z.array(modalitySchema).min(1),
  locais: z.array(localSchema).min(1),
  bloqueios: z.array(blockingSchema).default([]),
  competicao: competitionSchema,
  parametros: paramsSchema,
  persistencia: z
    .object({
      salvar: z.boolean().default(false),
      tenantId: z.string().min(1).optional(),
      competitionId: z.string().min(1).optional(),
      nomeVersao: z.string().min(1).optional(),
      createdBy: z.string().min(1).optional(),
    })
    .default({ salvar: false }),
});

const listVersionsQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
  competitionId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().min(1).optional(),
  createdBy: z.string().min(1).optional(),
  nomeContains: z.string().min(1).optional(),
});

const getVersionParamsSchema = z.object({
  versionId: z.string().min(1),
});

const getVersionQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
});

const compareVersionsPayloadSchema = z.object({
  versionAId: z.string().min(1),
  versionBId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
});

interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
}

const resolveAuthContext = async (
  authorizationHeader?: string
): Promise<AuthContext | null> => {
  const token = getBearerToken(authorizationHeader);
  if (!token) {
    return null;
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    return null;
  }

  const user = await prisma.appUser.findUnique({
    where: { id: payload.userId },
    select: { id: true, tenantId: true, email: true },
  });

  if (!user || user.tenantId !== payload.tenantId) {
    return null;
  }

  return {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
  };
};

export const registerSchedulingRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post("/api/scheduling/generate", async (request, reply) => {
    const authContext = await resolveAuthContext(request.headers.authorization);
    const parsed = schedulingPayloadSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido para geracao de agendamento.",
        errors: parsed.error.issues,
      });
    }

    if (parsed.data.competicao.fim_min <= parsed.data.competicao.inicio_min) {
      return reply.status(400).send({
        message:
          "Configuração de horario invalida: fim_min deve ser maior que inicio_min.",
      });
    }

    const teamIdSet = new Set<string>();
    const duplicatedTeamIds = new Set<string>();
    for (const team of parsed.data.teams) {
      if (teamIdSet.has(team.id)) {
        duplicatedTeamIds.add(team.id);
      }
      teamIdSet.add(team.id);
    }
    if (duplicatedTeamIds.size > 0) {
      return reply.status(400).send({
        message:
          "IDs de times duplicados detectados. Cada time precisa ter ID unico.",
        duplicatedTeamIds: [...duplicatedTeamIds],
      });
    }

    const invalidBlocking = parsed.data.bloqueios.find(
      (block) => block.fim <= block.inicio
    );
    if (invalidBlocking) {
      return reply.status(400).send({
        message: "Bloqueio invalido: fim deve ser maior que inicio.",
        bloqueio: invalidBlocking,
      });
    }

    const result = buildSchedulePreview(parsed.data);
    const persistencia = {
      ...parsed.data.persistencia,
      tenantId: parsed.data.persistencia.tenantId ?? authContext?.tenantId,
      createdBy: parsed.data.persistencia.createdBy ?? authContext?.email,
    };

    if (persistencia.salvar) {
      if (!persistencia.tenantId || !persistencia.competitionId) {
        return reply.status(400).send({
          message:
            "Para persistir, informe persistencia.tenantId e persistencia.competitionId.",
        });
      }

      try {
        const persisted = await persistScheduleVersion({
          input: {
            teams: parsed.data.teams,
            modalidades: parsed.data.modalidades,
            locais: parsed.data.locais,
            bloqueios: parsed.data.bloqueios,
            competicao: parsed.data.competicao,
            parametros: parsed.data.parametros,
          },
          result,
          options: persistencia,
        });

        result.persistencia = persisted;
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          message: "Falha ao persistir a versao do agendamento.",
          error: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }
    }

    return reply.status(200).send({
      status: "ok",
      etapa: "incremento_4_1",
      descricao:
        "Geracao, viabilidade, alocacao na grade, persistencia versionada e comparacao/consulta avancada de versoes.",
      resultado: result,
    });
  });

  app.get("/api/scheduling/versions", async (request, reply) => {
    const authContext = await resolveAuthContext(request.headers.authorization);
    const parsed = listVersionsQuerySchema.safeParse(request.query);
    if (!parsed.success || (!parsed.data.tenantId && !authContext?.tenantId)) {
      return reply.status(400).send({
        message: "Query invalida. Informe competitionId e tenantId (ou token valido).",
        errors: parsed.success ? undefined : parsed.error.issues,
      });
    }

    try {
      const versions = await listScheduleVersions(
        parsed.data.tenantId ?? authContext!.tenantId,
        parsed.data.competitionId,
        {
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
          status: parsed.data.status,
          createdBy: parsed.data.createdBy,
          nomeContains: parsed.data.nomeContains,
        }
      );
      return reply.status(200).send({
        status: "ok",
        ...versions,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        message: "Falha ao listar versoes.",
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.get("/api/scheduling/versions/:versionId", async (request, reply) => {
    const authContext = await resolveAuthContext(request.headers.authorization);
    const parsedParams = getVersionParamsSchema.safeParse(request.params);
    const parsedQuery = getVersionQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return reply.status(400).send({
        message: "Parametros invalidos para consulta da versao.",
        errors: [
          ...(parsedParams.success ? [] : parsedParams.error.issues),
          ...(parsedQuery.success ? [] : parsedQuery.error.issues),
        ],
      });
    }

    try {
      const version = await getScheduleVersionById(
        parsedParams.data.versionId,
        parsedQuery.data.tenantId ?? authContext?.tenantId
      );
      if (!version) {
        return reply.status(404).send({ message: "Versao nao encontrada." });
      }

      return reply.status(200).send({
        status: "ok",
        version,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        message: "Falha ao consultar versao.",
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  app.post("/api/scheduling/versions/compare", async (request, reply) => {
    const authContext = await resolveAuthContext(request.headers.authorization);
    const parsed = compareVersionsPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido para comparacao de versoes.",
        errors: parsed.error.issues,
      });
    }

    try {
      const comparison = await compareScheduleVersions(
        parsed.data.versionAId,
        parsed.data.versionBId,
        parsed.data.tenantId ?? authContext?.tenantId
      );

      return reply.status(200).send({
        status: "ok",
        comparison,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      if (
        msg.includes("nao foram encontradas") ||
        msg.includes("mesma competicao")
      ) {
        return reply.status(400).send({ message: msg });
      }

      request.log.error(error);
      return reply.status(500).send({
        message: "Falha ao comparar versoes.",
        error: msg,
      });
    }
  });
};
