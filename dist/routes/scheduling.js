"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSchedulingRoutes = void 0;
const zod_1 = require("zod");
const engine_1 = require("../modules/scheduling/engine");
const auth_1 = require("../lib/auth");
const prisma_1 = require("../lib/prisma");
const persistence_1 = require("../modules/scheduling/persistence");
const teamSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    nome: zod_1.z.string().min(1),
    categoria: zod_1.z.string().min(1),
    genero: zod_1.z.enum(["M", "F", "X"]),
});
const modalitySchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    nome: zod_1.z.string().min(1),
    duracao_min: zod_1.z.number().int().min(5).max(240),
    regra_genero: zod_1.z.enum(["misto", "separado"]),
    formato: zod_1.z.enum(["todos_contra_todos", "eliminatoria"]).optional(),
    categorias: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    categorias_eliminatoria: zod_1.z.array(zod_1.z.string().min(1)).optional(),
});
const localSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    nome: zod_1.z.string().min(1),
    modalidades_permitidas: zod_1.z.union([
        zod_1.z.array(zod_1.z.string().min(1)),
        zod_1.z.literal("*"),
        zod_1.z.null(),
    ]),
    categorias_permitidas: zod_1.z.union([
        zod_1.z.array(zod_1.z.string().min(1)),
        zod_1.z.literal("*"),
        zod_1.z.null(),
    ]),
});
const blockingSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    dia: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    inicio: zod_1.z.number().int().min(0).max(1439),
    fim: zod_1.z.number().int().min(1).max(1440),
    motivo: zod_1.z.string().min(1),
});
const categoryWindowSchema = zod_1.z.object({
    categoria: zod_1.z.string().min(1),
    dias: zod_1.z.array(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
    inicio_min: zod_1.z.number().int().min(0).max(1439),
    fim_min: zod_1.z.number().int().min(1).max(1440),
});
const mandatoryCategoryPresenceSchema = zod_1.z.object({
    dias: zod_1.z.array(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
});
const competitionSchema = zod_1.z.object({
    inicio_min: zod_1.z.number().int().min(0).max(1439),
    fim_min: zod_1.z.number().int().min(1).max(1440),
    passo_grid: zod_1.z.number().int().min(5).max(60),
    dias: zod_1.z.array(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
});
const legacyFormatSchema = zod_1.z.preprocess((value) => {
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
    if (normalized === "todos_contra_todos" ||
        normalized === "todos-contra-todos" ||
        normalized === "todos contra todos") {
        return "todos_contra_todos";
    }
    if (normalized === "eliminatoria" || normalized === "eliminatória") {
        return "eliminatoria";
    }
    return value;
}, zod_1.z.enum(["todos_contra_todos", "eliminatoria"]).optional());
const paramsSchema = zod_1.z.object({
    descanso_minimo: zod_1.z.number().int().min(0),
    // Deprecated: manter por compatibilidade com payload antigo.
    formato: legacyFormatSchema,
    modo_encaixe: zod_1.z.enum(["arredondar_cima", "exato"]),
    modo_ordem: zod_1.z.enum([
        "curtos_primeiro",
        "longos_primeiro",
        "dificil_primeiro",
        "agrupar_categoria",
    ]),
    algoritmo: zod_1.z.enum(["GREEDY", "SIMULATED_ANNEALING"]).optional(),
});
const schedulingPayloadSchema = zod_1.z.object({
    teams: zod_1.z.array(teamSchema),
    modalidades: zod_1.z.array(modalitySchema).min(1),
    locais: zod_1.z.array(localSchema).min(1),
    bloqueios: zod_1.z.array(blockingSchema).default([]),
    restricoes_categoria: zod_1.z.array(categoryWindowSchema).default([]),
    presenca_categorias: mandatoryCategoryPresenceSchema
        .optional()
        .default({ dias: [] }),
    competicao: competitionSchema,
    parametros: paramsSchema,
    persistencia: zod_1.z
        .object({
        salvar: zod_1.z.boolean().default(false),
        tenantId: zod_1.z.string().min(1).optional(),
        competitionId: zod_1.z.string().min(1).optional(),
        nomeVersao: zod_1.z.string().min(1).optional(),
        createdBy: zod_1.z.string().min(1).optional(),
    })
        .default({ salvar: false }),
});
const listVersionsQuerySchema = zod_1.z.object({
    tenantId: zod_1.z.string().min(1).optional(),
    competitionId: zod_1.z.string().min(1),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    pageSize: zod_1.z.coerce.number().int().min(1).max(100).default(20),
    status: zod_1.z.string().min(1).optional(),
    createdBy: zod_1.z.string().min(1).optional(),
    nomeContains: zod_1.z.string().min(1).optional(),
});
const getVersionParamsSchema = zod_1.z.object({
    versionId: zod_1.z.string().min(1),
});
const getVersionQuerySchema = zod_1.z.object({
    tenantId: zod_1.z.string().min(1).optional(),
});
const compareVersionsPayloadSchema = zod_1.z.object({
    versionAId: zod_1.z.string().min(1),
    versionBId: zod_1.z.string().min(1),
    tenantId: zod_1.z.string().min(1).optional(),
});
const resolveAuthContext = async (authorizationHeader) => {
    const token = (0, auth_1.getBearerToken)(authorizationHeader);
    if (!token) {
        return null;
    }
    const payload = (0, auth_1.verifyAuthToken)(token);
    if (!payload) {
        return null;
    }
    const user = await prisma_1.prisma.appUser.findUnique({
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
const registerSchedulingRoutes = async (app) => {
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
                message: "Configuração de horario invalida: fim_min deve ser maior que inicio_min.",
            });
        }
        const teamIdSet = new Set();
        const duplicatedTeamIds = new Set();
        for (const team of parsed.data.teams) {
            if (teamIdSet.has(team.id)) {
                duplicatedTeamIds.add(team.id);
            }
            teamIdSet.add(team.id);
        }
        if (duplicatedTeamIds.size > 0) {
            return reply.status(400).send({
                message: "IDs de times duplicados detectados. Cada time precisa ter ID unico.",
                duplicatedTeamIds: [...duplicatedTeamIds],
            });
        }
        const invalidBlocking = parsed.data.bloqueios.find((block) => block.fim <= block.inicio);
        if (invalidBlocking) {
            return reply.status(400).send({
                message: "Bloqueio invalido: fim deve ser maior que inicio.",
                bloqueio: invalidBlocking,
            });
        }
        const invalidCategoryWindow = parsed.data.restricoes_categoria.find((restriction) => restriction.fim_min <= restriction.inicio_min);
        if (invalidCategoryWindow) {
            return reply.status(400).send({
                message: "Restricao de categoria invalida: fim_min deve ser maior que inicio_min.",
                restricao: invalidCategoryWindow,
            });
        }
        const allowedDays = new Set(parsed.data.competicao.dias);
        const restrictionWithInvalidDay = parsed.data.restricoes_categoria.find((restriction) => restriction.dias.some((day) => !allowedDays.has(day)));
        if (restrictionWithInvalidDay) {
            return reply.status(400).send({
                message: "Restricao de categoria contem dia fora do periodo da competicao.",
                restricao: restrictionWithInvalidDay,
            });
        }
        const invalidMandatoryPresenceDay = (parsed.data.presenca_categorias?.dias ?? []).find((day) => !allowedDays.has(day));
        if (invalidMandatoryPresenceDay) {
            return reply.status(400).send({
                message: "Presenca obrigatoria por categoria contem dia fora do periodo da competicao.",
                dia: invalidMandatoryPresenceDay,
            });
        }
        const result = (0, engine_1.buildSchedulePreview)(parsed.data);
        const persistencia = {
            ...parsed.data.persistencia,
            tenantId: parsed.data.persistencia.tenantId ?? authContext?.tenantId,
            createdBy: parsed.data.persistencia.createdBy ?? authContext?.email,
        };
        if (persistencia.salvar) {
            if (!persistencia.tenantId || !persistencia.competitionId) {
                return reply.status(400).send({
                    message: "Para persistir, informe persistencia.tenantId e persistencia.competitionId.",
                });
            }
            try {
                const persisted = await (0, persistence_1.persistScheduleVersion)({
                    input: {
                        teams: parsed.data.teams,
                        modalidades: parsed.data.modalidades,
                        locais: parsed.data.locais,
                        bloqueios: parsed.data.bloqueios,
                        presenca_categorias: parsed.data.presenca_categorias,
                        competicao: parsed.data.competicao,
                        parametros: parsed.data.parametros,
                    },
                    result,
                    options: persistencia,
                });
                result.persistencia = persisted;
            }
            catch (error) {
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
            descricao: "Geracao, viabilidade, alocacao na grade, persistencia versionada e comparacao/consulta avancada de versoes.",
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
            const versions = await (0, persistence_1.listScheduleVersions)(parsed.data.tenantId ?? authContext.tenantId, parsed.data.competitionId, {
                page: parsed.data.page,
                pageSize: parsed.data.pageSize,
                status: parsed.data.status,
                createdBy: parsed.data.createdBy,
                nomeContains: parsed.data.nomeContains,
            });
            return reply.status(200).send({
                status: "ok",
                ...versions,
            });
        }
        catch (error) {
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
            const version = await (0, persistence_1.getScheduleVersionById)(parsedParams.data.versionId, parsedQuery.data.tenantId ?? authContext?.tenantId);
            if (!version) {
                return reply.status(404).send({ message: "Versao nao encontrada." });
            }
            return reply.status(200).send({
                status: "ok",
                version,
            });
        }
        catch (error) {
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
            const comparison = await (0, persistence_1.compareScheduleVersions)(parsed.data.versionAId, parsed.data.versionBId, parsed.data.tenantId ?? authContext?.tenantId);
            return reply.status(200).send({
                status: "ok",
                comparison,
            });
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "Erro desconhecido";
            if (msg.includes("nao foram encontradas") ||
                msg.includes("mesma competicao")) {
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
exports.registerSchedulingRoutes = registerSchedulingRoutes;
