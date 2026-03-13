"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareScheduleVersions = exports.getScheduleVersionById = exports.listScheduleVersions = exports.persistScheduleVersion = void 0;
const prisma_1 = require("../../lib/prisma");
const persistScheduleVersion = async ({ input, result, options, }) => {
    if (!options.tenantId || !options.competitionId) {
        throw new Error("tenantId e competitionId sao obrigatorios para persistencia.");
    }
    const competition = await prisma_1.prisma.competition.findFirst({
        where: {
            id: options.competitionId,
            tenantId: options.tenantId,
        },
        select: { id: true },
    });
    if (!competition) {
        throw new Error("Competicao nao encontrada para este tenant.");
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const scheduleVersion = await tx.scheduleVersion.create({
            data: {
                tenantId: options.tenantId,
                competitionId: options.competitionId,
                name: options.nomeVersao ?? `Versao ${new Date().toISOString()}`,
                status: "GENERATED",
                schedulingInput: JSON.parse(JSON.stringify(input)),
                kpis: result.kpis,
                createdBy: options.createdBy,
            },
            select: { id: true },
        });
        const matchIdBySource = new Map();
        for (const confronto of result.confrontos) {
            const upserted = await tx.match.upsert({
                where: {
                    competitionId_sourceMatchId: {
                        competitionId: options.competitionId,
                        sourceMatchId: confronto.id,
                    },
                },
                update: {
                    teamAId: confronto.time_a.id,
                    teamBId: confronto.time_b.id,
                    category: confronto.categoria,
                    modalityId: confronto.modalidade_id,
                    modalityName: confronto.modalidade,
                    phase: confronto.fase,
                    durationMin: confronto.duracao_min,
                    genderRule: confronto.regra_genero,
                    modalityKey: confronto.chave_modalidade,
                },
                create: {
                    tenantId: options.tenantId,
                    competitionId: options.competitionId,
                    sourceMatchId: confronto.id,
                    teamAId: confronto.time_a.id,
                    teamBId: confronto.time_b.id,
                    category: confronto.categoria,
                    modalityId: confronto.modalidade_id,
                    modalityName: confronto.modalidade,
                    phase: confronto.fase,
                    durationMin: confronto.duracao_min,
                    genderRule: confronto.regra_genero,
                    modalityKey: confronto.chave_modalidade,
                },
                select: { id: true },
            });
            matchIdBySource.set(confronto.id, upserted.id);
        }
        for (const item of result.alocados) {
            const matchId = matchIdBySource.get(item.confronto_id);
            if (!matchId) {
                continue;
            }
            await tx.scheduledMatch.create({
                data: {
                    scheduleVersionId: scheduleVersion.id,
                    matchId,
                    status: "ALLOCATED",
                    day: item.dia,
                    startMin: item.inicio,
                    endMin: item.fim,
                    localId: item.local_id,
                    localName: item.nome_quadra,
                    span: item.span,
                    score: item.score,
                },
            });
        }
        for (const item of result.nao_alocados) {
            const matchId = matchIdBySource.get(item.confronto_id);
            if (!matchId) {
                continue;
            }
            await tx.scheduledMatch.create({
                data: {
                    scheduleVersionId: scheduleVersion.id,
                    matchId,
                    status: "UNALLOCATED",
                    reason: item.motivo,
                },
            });
        }
        return {
            scheduleVersionId: scheduleVersion.id,
            totalMatchesPersistidos: result.confrontos.length,
            totalScheduledItensPersistidos: result.alocados.length + result.nao_alocados.length,
        };
    });
};
exports.persistScheduleVersion = persistScheduleVersion;
const listScheduleVersions = async (tenantId, competitionId, options) => {
    const where = {
        tenantId,
        competitionId,
        ...(options.status ? { status: options.status } : {}),
        ...(options.createdBy ? { createdBy: options.createdBy } : {}),
        ...(options.nomeContains ? { name: { contains: options.nomeContains, mode: "insensitive" } } : {}),
    };
    const [total, versions] = await Promise.all([
        prisma_1.prisma.scheduleVersion.count({ where }),
        prisma_1.prisma.scheduleVersion.findMany({
            where,
            orderBy: { generatedAt: "desc" },
            skip: (options.page - 1) * options.pageSize,
            take: options.pageSize,
            select: {
                id: true,
                name: true,
                status: true,
                generatedAt: true,
                createdBy: true,
                kpis: true,
                _count: {
                    select: { scheduledItems: true },
                },
            },
        }),
    ]);
    return {
        page: options.page,
        pageSize: options.pageSize,
        total,
        totalPages: Math.ceil(total / options.pageSize),
        versions,
    };
};
exports.listScheduleVersions = listScheduleVersions;
const getScheduleVersionById = async (versionId, tenantId) => {
    return prisma_1.prisma.scheduleVersion.findFirst({
        where: {
            id: versionId,
            ...(tenantId ? { tenantId } : {}),
        },
        select: {
            id: true,
            tenantId: true,
            competitionId: true,
            name: true,
            status: true,
            generatedAt: true,
            createdBy: true,
            schedulingInput: true,
            kpis: true,
            scheduledItems: {
                select: {
                    id: true,
                    status: true,
                    reason: true,
                    day: true,
                    startMin: true,
                    endMin: true,
                    localId: true,
                    localName: true,
                    span: true,
                    score: true,
                    match: {
                        select: {
                            id: true,
                            sourceMatchId: true,
                            teamAId: true,
                            teamBId: true,
                            category: true,
                            modalityId: true,
                            modalityName: true,
                            phase: true,
                            durationMin: true,
                            genderRule: true,
                            modalityKey: true,
                        },
                    },
                },
                orderBy: [{ day: "asc" }, { startMin: "asc" }],
            },
        },
    });
};
exports.getScheduleVersionById = getScheduleVersionById;
const allocationSignature = (item) => `${item.match.sourceMatchId}|${item.status}|${item.day ?? ""}|${item.startMin ?? ""}|${item.endMin ?? ""}|${item.localId ?? ""}`;
const compareScheduleVersions = async (versionAId, versionBId, tenantId) => {
    const [versionA, versionB] = await Promise.all([
        prisma_1.prisma.scheduleVersion.findFirst({
            where: { id: versionAId, ...(tenantId ? { tenantId } : {}) },
            select: {
                id: true,
                name: true,
                generatedAt: true,
                competitionId: true,
                kpis: true,
                scheduledItems: {
                    select: {
                        status: true,
                        reason: true,
                        day: true,
                        startMin: true,
                        endMin: true,
                        localId: true,
                        localName: true,
                        match: { select: { sourceMatchId: true } },
                    },
                },
            },
        }),
        prisma_1.prisma.scheduleVersion.findFirst({
            where: { id: versionBId, ...(tenantId ? { tenantId } : {}) },
            select: {
                id: true,
                name: true,
                generatedAt: true,
                competitionId: true,
                kpis: true,
                scheduledItems: {
                    select: {
                        status: true,
                        reason: true,
                        day: true,
                        startMin: true,
                        endMin: true,
                        localId: true,
                        localName: true,
                        match: { select: { sourceMatchId: true } },
                    },
                },
            },
        }),
    ]);
    if (!versionA || !versionB) {
        throw new Error("Uma ou ambas as versoes nao foram encontradas.");
    }
    if (versionA.competitionId !== versionB.competitionId) {
        throw new Error("As versoes devem pertencer a mesma competicao para comparacao.");
    }
    const signaturesA = new Set(versionA.scheduledItems.map(allocationSignature));
    const signaturesB = new Set(versionB.scheduledItems.map(allocationSignature));
    const onlyInA = [...signaturesA].filter((signature) => !signaturesB.has(signature));
    const onlyInB = [...signaturesB].filter((signature) => !signaturesA.has(signature));
    const mapA = new Map(versionA.scheduledItems.map((item) => [item.match.sourceMatchId, item]));
    const mapB = new Map(versionB.scheduledItems.map((item) => [item.match.sourceMatchId, item]));
    const allMatchIds = new Set([...mapA.keys(), ...mapB.keys()]);
    const mudancasDetalhadas = [];
    let mudaramStatus = 0;
    let mudaramHorario = 0;
    let mudaramQuadra = 0;
    let mudaramMotivo = 0;
    let novosNaVersaoB = 0;
    let removidosNaVersaoB = 0;
    for (const sourceMatchId of allMatchIds) {
        const a = mapA.get(sourceMatchId);
        const b = mapB.get(sourceMatchId);
        const snapshotA = {
            status: a?.status ?? null,
            day: a?.day ?? null,
            startMin: a?.startMin ?? null,
            endMin: a?.endMin ?? null,
            localId: a?.localId ?? null,
            localName: a?.localName ?? null,
            reason: a?.reason ?? null,
        };
        const snapshotB = {
            status: b?.status ?? null,
            day: b?.day ?? null,
            startMin: b?.startMin ?? null,
            endMin: b?.endMin ?? null,
            localId: b?.localId ?? null,
            localName: b?.localName ?? null,
            reason: b?.reason ?? null,
        };
        if (!a && b) {
            novosNaVersaoB += 1;
            mudancasDetalhadas.push({
                sourceMatchId,
                tipo: "novo_na_b",
                versaoA: snapshotA,
                versaoB: snapshotB,
            });
            continue;
        }
        if (a && !b) {
            removidosNaVersaoB += 1;
            mudancasDetalhadas.push({
                sourceMatchId,
                tipo: "removido_na_b",
                versaoA: snapshotA,
                versaoB: snapshotB,
            });
            continue;
        }
        if (!a || !b) {
            continue;
        }
        if (a.status !== b.status) {
            mudaramStatus += 1;
            mudancasDetalhadas.push({
                sourceMatchId,
                tipo: "status",
                versaoA: snapshotA,
                versaoB: snapshotB,
            });
        }
        const horarioMudou = a.day !== b.day || a.startMin !== b.startMin || a.endMin !== b.endMin;
        if (horarioMudou) {
            mudaramHorario += 1;
            mudancasDetalhadas.push({
                sourceMatchId,
                tipo: "horario",
                versaoA: snapshotA,
                versaoB: snapshotB,
            });
        }
        if (a.localId !== b.localId) {
            mudaramQuadra += 1;
            mudancasDetalhadas.push({
                sourceMatchId,
                tipo: "quadra",
                versaoA: snapshotA,
                versaoB: snapshotB,
            });
        }
        if ((a.reason ?? "") !== (b.reason ?? "")) {
            mudaramMotivo += 1;
            mudancasDetalhadas.push({
                sourceMatchId,
                tipo: "motivo",
                versaoA: snapshotA,
                versaoB: snapshotB,
            });
        }
    }
    return {
        versao_a: {
            id: versionA.id,
            nome: versionA.name,
            generatedAt: versionA.generatedAt,
            kpis: versionA.kpis,
            total_itens: versionA.scheduledItems.length,
        },
        versao_b: {
            id: versionB.id,
            nome: versionB.name,
            generatedAt: versionB.generatedAt,
            kpis: versionB.kpis,
            total_itens: versionB.scheduledItems.length,
        },
        diferencas: {
            somente_na_versao_a: onlyInA,
            somente_na_versao_b: onlyInB,
            total_diferencas: onlyInA.length + onlyInB.length,
        },
        resumo_diff: {
            mudaram_status: mudaramStatus,
            mudaram_horario: mudaramHorario,
            mudaram_quadra: mudaramQuadra,
            mudaram_motivo: mudaramMotivo,
            novos_na_versao_b: novosNaVersaoB,
            removidos_na_versao_b: removidosNaVersaoB,
            total_confrontos_com_alguma_mudanca: mudaramStatus +
                mudaramHorario +
                mudaramQuadra +
                mudaramMotivo +
                novosNaVersaoB +
                removidosNaVersaoB,
        },
        mudancas_detalhadas: mudancasDetalhadas,
    };
};
exports.compareScheduleVersions = compareScheduleVersions;
