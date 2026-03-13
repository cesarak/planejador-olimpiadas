"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCompetitionRoutes = void 0;
const prisma_1 = require("../lib/prisma");
const zod_1 = require("zod");
const auth_1 = require("../lib/auth");
const tenantQuerySchema = zod_1.z.object({
    tenantId: zod_1.z.string().min(1),
});
const createTenantSchema = zod_1.z.object({
    name: zod_1.z.string().min(3).max(120),
});
const createCompetitionSchema = zod_1.z.object({
    tenantId: zod_1.z.string().min(1).optional(),
    name: zod_1.z.string().min(3).max(120),
    startMin: zod_1.z.number().int().min(0).max(1439),
    endMin: zod_1.z.number().int().min(1).max(1440),
    stepGrid: zod_1.z.number().int().min(5).max(60),
    days: zod_1.z.array(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
});
const competitionParamsSchema = zod_1.z.object({
    competitionId: zod_1.z.string().min(1),
});
const updateCompetitionSchema = zod_1.z
    .object({
    tenantId: zod_1.z.string().min(1).optional(),
    name: zod_1.z.string().min(3).max(120).optional(),
    startMin: zod_1.z.number().int().min(0).max(1439).optional(),
    endMin: zod_1.z.number().int().min(1).max(1440).optional(),
    stepGrid: zod_1.z.number().int().min(5).max(60).optional(),
    days: zod_1.z.array(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).optional(),
})
    .refine((payload) => payload.name !== undefined ||
    payload.startMin !== undefined ||
    payload.endMin !== undefined ||
    payload.stepGrid !== undefined ||
    payload.days !== undefined, { message: "Informe ao menos um campo para atualizacao." });
const ensureTimeWindow = (startMin, endMin) => {
    if (endMin <= startMin) {
        return "Configuracao de horario invalida: endMin deve ser maior que startMin.";
    }
    return null;
};
const resolveAccessContext = async (authorizationHeader, tenantFallback) => {
    const token = (0, auth_1.getBearerToken)(authorizationHeader);
    if (!token) {
        if (!tenantFallback) {
            return null;
        }
        return { tenantId: tenantFallback };
    }
    const payload = (0, auth_1.verifyAuthToken)(token);
    if (!payload) {
        return null;
    }
    const user = await prisma_1.prisma.appUser.findUnique({
        where: { id: payload.userId },
        select: { id: true, tenantId: true },
    });
    if (!user || user.tenantId !== payload.tenantId) {
        return null;
    }
    return {
        tenantId: user.tenantId,
        userId: user.id,
    };
};
const registerCompetitionRoutes = async (app) => {
    app.get("/api/tenants", async (request, reply) => {
        try {
            const tenants = await prisma_1.prisma.tenant.findMany({
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    name: true,
                    createdAt: true,
                    _count: {
                        select: {
                            competitions: true,
                        },
                    },
                },
            });
            return reply.status(200).send({
                status: "ok",
                total: tenants.length,
                tenants,
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                message: "Falha ao listar organizacoes.",
                error: error instanceof Error ? error.message : "Erro desconhecido",
            });
        }
    });
    app.post("/api/tenants", async (request, reply) => {
        const parsedBody = createTenantSchema.safeParse(request.body);
        if (!parsedBody.success) {
            return reply.status(400).send({
                message: "Payload invalido para criar organizacao.",
                errors: parsedBody.error.issues,
            });
        }
        try {
            const tenant = await prisma_1.prisma.tenant.create({
                data: {
                    name: parsedBody.data.name,
                },
            });
            return reply.status(201).send({
                status: "ok",
                tenant,
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                message: "Falha ao criar organizacao.",
                error: error instanceof Error ? error.message : "Erro desconhecido",
            });
        }
    });
    app.get("/api/competitions", async (request, reply) => {
        const parsedQuery = tenantQuerySchema.safeParse(request.query);
        const accessContext = await resolveAccessContext(request.headers.authorization, parsedQuery.success ? parsedQuery.data.tenantId : undefined);
        if (!accessContext) {
            return reply.status(400).send({
                message: "Contexto invalido para listar campeonatos. Informe tenantId ou token de autenticacao valido.",
                errors: parsedQuery.success ? undefined : parsedQuery.error.issues,
            });
        }
        try {
            const competitions = await prisma_1.prisma.competition.findMany({
                where: {
                    tenantId: accessContext.tenantId,
                    ...(accessContext.userId ? { createdByUserId: accessContext.userId } : {}),
                },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    name: true,
                    createdByUserId: true,
                    startMin: true,
                    endMin: true,
                    stepGrid: true,
                    days: true,
                    createdAt: true,
                    _count: {
                        select: {
                            matches: true,
                            scheduleVersions: true,
                        },
                    },
                },
            });
            return reply.status(200).send({
                status: "ok",
                total: competitions.length,
                competitions,
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                message: "Falha ao listar campeonatos.",
                error: error instanceof Error ? error.message : "Erro desconhecido",
            });
        }
    });
    app.post("/api/competitions", async (request, reply) => {
        const parsedBody = createCompetitionSchema.safeParse(request.body);
        if (!parsedBody.success) {
            return reply.status(400).send({
                message: "Payload invalido para criar campeonato.",
                errors: parsedBody.error.issues,
            });
        }
        const accessContext = await resolveAccessContext(request.headers.authorization, parsedBody.data.tenantId);
        if (!accessContext) {
            return reply.status(400).send({
                message: "Contexto invalido para criar campeonato. Informe tenantId ou token de autenticacao valido.",
            });
        }
        const timeValidationError = ensureTimeWindow(parsedBody.data.startMin, parsedBody.data.endMin);
        if (timeValidationError) {
            return reply.status(400).send({ message: timeValidationError });
        }
        try {
            const tenant = await prisma_1.prisma.tenant.findUnique({
                where: { id: accessContext.tenantId },
                select: { id: true },
            });
            if (!tenant) {
                return reply.status(404).send({
                    message: "Tenant nao encontrado. Crie ou informe um tenant valido.",
                });
            }
            const competition = await prisma_1.prisma.competition.create({
                data: {
                    tenantId: accessContext.tenantId,
                    createdByUserId: accessContext.userId,
                    name: parsedBody.data.name,
                    startMin: parsedBody.data.startMin,
                    endMin: parsedBody.data.endMin,
                    stepGrid: parsedBody.data.stepGrid,
                    days: parsedBody.data.days,
                },
            });
            return reply.status(201).send({
                status: "ok",
                competition,
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                message: "Falha ao criar campeonato.",
                error: error instanceof Error ? error.message : "Erro desconhecido",
            });
        }
    });
    app.get("/api/competitions/:competitionId", async (request, reply) => {
        const parsedParams = competitionParamsSchema.safeParse(request.params);
        const parsedQuery = tenantQuerySchema.safeParse(request.query);
        const accessContext = await resolveAccessContext(request.headers.authorization, parsedQuery.success ? parsedQuery.data.tenantId : undefined);
        if (!parsedParams.success || !accessContext) {
            return reply.status(400).send({
                message: "Parametros invalidos para consultar campeonato.",
                errors: [
                    ...(parsedParams.success ? [] : parsedParams.error.issues),
                    ...(parsedQuery.success || request.headers.authorization ? [] : parsedQuery.error.issues),
                ],
            });
        }
        try {
            const competition = await prisma_1.prisma.competition.findFirst({
                where: {
                    id: parsedParams.data.competitionId,
                    tenantId: accessContext.tenantId,
                    ...(accessContext.userId ? { createdByUserId: accessContext.userId } : {}),
                },
                select: {
                    id: true,
                    tenantId: true,
                    createdByUserId: true,
                    name: true,
                    startMin: true,
                    endMin: true,
                    stepGrid: true,
                    days: true,
                    createdAt: true,
                    _count: {
                        select: {
                            matches: true,
                            scheduleVersions: true,
                        },
                    },
                },
            });
            if (!competition) {
                return reply.status(404).send({ message: "Campeonato nao encontrado." });
            }
            return reply.status(200).send({
                status: "ok",
                competition,
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                message: "Falha ao consultar campeonato.",
                error: error instanceof Error ? error.message : "Erro desconhecido",
            });
        }
    });
    app.put("/api/competitions/:competitionId", async (request, reply) => {
        const parsedParams = competitionParamsSchema.safeParse(request.params);
        const parsedBody = updateCompetitionSchema.safeParse(request.body);
        const accessContext = await resolveAccessContext(request.headers.authorization, parsedBody.success ? parsedBody.data.tenantId : undefined);
        if (!parsedParams.success || !parsedBody.success || !accessContext) {
            return reply.status(400).send({
                message: "Payload invalido para atualizar campeonato.",
                errors: [
                    ...(parsedParams.success ? [] : parsedParams.error.issues),
                    ...(parsedBody.success ? [] : parsedBody.error.issues),
                ],
            });
        }
        try {
            const current = await prisma_1.prisma.competition.findFirst({
                where: {
                    id: parsedParams.data.competitionId,
                    tenantId: accessContext.tenantId,
                    ...(accessContext.userId ? { createdByUserId: accessContext.userId } : {}),
                },
                select: {
                    id: true,
                    startMin: true,
                    endMin: true,
                },
            });
            if (!current) {
                return reply.status(404).send({ message: "Campeonato nao encontrado." });
            }
            const nextStartMin = parsedBody.data.startMin ?? current.startMin;
            const nextEndMin = parsedBody.data.endMin ?? current.endMin;
            const timeValidationError = ensureTimeWindow(nextStartMin, nextEndMin);
            if (timeValidationError) {
                return reply.status(400).send({ message: timeValidationError });
            }
            const competition = await prisma_1.prisma.competition.update({
                where: { id: current.id },
                data: {
                    name: parsedBody.data.name,
                    startMin: parsedBody.data.startMin,
                    endMin: parsedBody.data.endMin,
                    stepGrid: parsedBody.data.stepGrid,
                    days: parsedBody.data.days,
                },
            });
            return reply.status(200).send({
                status: "ok",
                competition,
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                message: "Falha ao atualizar campeonato.",
                error: error instanceof Error ? error.message : "Erro desconhecido",
            });
        }
    });
    app.delete("/api/competitions/:competitionId", async (request, reply) => {
        const parsedParams = competitionParamsSchema.safeParse(request.params);
        const parsedQuery = tenantQuerySchema.safeParse(request.query);
        const accessContext = await resolveAccessContext(request.headers.authorization, parsedQuery.success ? parsedQuery.data.tenantId : undefined);
        if (!parsedParams.success || !accessContext) {
            return reply.status(400).send({
                message: "Parametros invalidos para remover campeonato.",
                errors: [
                    ...(parsedParams.success ? [] : parsedParams.error.issues),
                    ...(parsedQuery.success || request.headers.authorization ? [] : parsedQuery.error.issues),
                ],
            });
        }
        try {
            const competition = await prisma_1.prisma.competition.findFirst({
                where: {
                    id: parsedParams.data.competitionId,
                    tenantId: accessContext.tenantId,
                    ...(accessContext.userId ? { createdByUserId: accessContext.userId } : {}),
                },
                select: { id: true },
            });
            if (!competition) {
                return reply.status(404).send({ message: "Campeonato nao encontrado." });
            }
            await prisma_1.prisma.$transaction(async (tx) => {
                const [versionRows, matchRows] = await Promise.all([
                    tx.scheduleVersion.findMany({
                        where: { competitionId: competition.id },
                        select: { id: true },
                    }),
                    tx.match.findMany({
                        where: { competitionId: competition.id },
                        select: { id: true },
                    }),
                ]);
                const versionIds = versionRows.map((row) => row.id);
                const matchIds = matchRows.map((row) => row.id);
                if (versionIds.length > 0 || matchIds.length > 0) {
                    await tx.scheduledMatch.deleteMany({
                        where: {
                            OR: [
                                ...(versionIds.length > 0 ? [{ scheduleVersionId: { in: versionIds } }] : []),
                                ...(matchIds.length > 0 ? [{ matchId: { in: matchIds } }] : []),
                            ],
                        },
                    });
                }
                await tx.scheduleVersion.deleteMany({
                    where: { competitionId: competition.id },
                });
                await tx.match.deleteMany({
                    where: { competitionId: competition.id },
                });
                await tx.competition.delete({
                    where: { id: competition.id },
                });
            });
            return reply.status(200).send({
                status: "ok",
                message: "Campeonato removido com sucesso.",
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                message: "Falha ao remover campeonato.",
                error: error instanceof Error ? error.message : "Erro desconhecido",
            });
        }
    });
};
exports.registerCompetitionRoutes = registerCompetitionRoutes;
