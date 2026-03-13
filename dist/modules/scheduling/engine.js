"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSchedulePreview = void 0;
const keyByCategoryAndModality = (categoria, modalityId) => `${categoria}::${modalityId}`;
const keyByModeAndCategory = (modalityId, category) => `${modalityId}::${category}`;
const normalizeAdjustedDuration = (durationMin, gridStepMin, fitMode) => {
    if (fitMode === "exato") {
        return durationMin;
    }
    return Math.ceil(durationMin / gridStepMin) * gridStepMin;
};
const generateRoundRobinPairs = (teams) => {
    const players = [...teams];
    if (players.length % 2 === 1) {
        players.push(null);
    }
    const rounds = players.length - 1;
    const roundPairs = [];
    for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
        for (let i = 0; i < players.length / 2; i += 1) {
            const a = players[i];
            const b = players[players.length - 1 - i];
            if (a && b) {
                roundPairs.push([a, b]);
            }
        }
        const fixed = players[0];
        const rotating = players.slice(1);
        rotating.unshift(rotating.pop() ?? null);
        players.splice(0, players.length, fixed, ...rotating);
    }
    return roundPairs;
};
const generateEliminationPairs = (teams) => {
    const pairs = [];
    for (let i = 0; i + 1 < teams.length; i += 2) {
        pairs.push([teams[i], teams[i + 1]]);
    }
    return pairs;
};
const generatePairsByFormat = (teams, format) => {
    if (format === "eliminatoria") {
        return generateEliminationPairs(teams);
    }
    return generateRoundRobinPairs(teams);
};
const createPlaceholderTeam = (id, nome, categoria, genero) => ({
    id,
    nome,
    categoria,
    genero,
});
const splitTeamsIntoChaves = (teams) => {
    if (teams.length < 4) {
        return [{ nome: "A", teams: [...teams] }];
    }
    const ordered = [...teams].sort((a, b) => a.nome.localeCompare(b.nome));
    const chaves = [
        { nome: "A", teams: [] },
        { nome: "B", teams: [] },
    ];
    ordered.forEach((team, index) => {
        chaves[index % 2].teams.push(team);
    });
    return chaves;
};
const normalizeTextKey = (value) => value.trim().toLowerCase();
const toIdToken = (value) => normalizeTextKey(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const buildMixedLogicalTeams = (teams) => {
    const grouped = new Map();
    teams.forEach((team) => {
        const key = `${normalizeTextKey(team.categoria)}::${normalizeTextKey(team.nome)}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                id: `MIX_${normalizeTextKey(team.categoria).replace(/\s+/g, "_")}_${normalizeTextKey(team.nome).replace(/\s+/g, "_")}`,
                nome: team.nome,
                categoria: team.categoria,
            });
        }
    });
    return [...grouped.values()]
        .map((item) => ({
        id: item.id,
        nome: item.nome,
        categoria: item.categoria,
        genero: "X",
    }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
};
const acceptsRule = (allowed, value) => {
    if (!allowed || allowed === "*") {
        return true;
    }
    return allowed.includes(value);
};
const compatibleLocalCount = (locals, categoria, modalidadeId) => {
    return locals.filter((local) => acceptsRule(local.modalidades_permitidas, modalidadeId) &&
        acceptsRule(local.categorias_permitidas, categoria)).length;
};
const overlapMinutes = (startA, endA, startB, endB) => {
    const start = Math.max(startA, startB);
    const end = Math.min(endA, endB);
    return Math.max(0, end - start);
};
const blockedMinutesInWindow = (blocks, day, windowStart, windowEnd) => {
    return blocks
        .filter((block) => block.dia === day)
        .reduce((sum, block) => sum + overlapMinutes(windowStart, windowEnd, block.inicio, block.fim), 0);
};
const isLocalCompatible = (local, categoria, modalidadeId) => {
    return (acceptsRule(local.modalidades_permitidas, modalidadeId) &&
        acceptsRule(local.categorias_permitidas, categoria));
};
const conflictByOverlap = (inicioA, fimA, inicioB, fimB) => overlapMinutes(inicioA, fimA, inicioB, fimB) > 0;
const hasMinimumRestViolation = (currentStart, currentEnd, otherStart, otherEnd, minimumRest) => {
    if (minimumRest <= 0) {
        return false;
    }
    if (conflictByOverlap(currentStart, currentEnd, otherStart, otherEnd)) {
        return false;
    }
    if (currentStart >= otherEnd) {
        return currentStart - otherEnd < minimumRest;
    }
    if (otherStart >= currentEnd) {
        return otherStart - currentEnd < minimumRest;
    }
    return false;
};
const buildEmptyGrid = (input) => {
    const grid = {};
    const totalSlots = Math.floor((input.competicao.fim_min - input.competicao.inicio_min) / input.competicao.passo_grid);
    for (const day of input.competicao.dias) {
        grid[day] = {};
        for (const local of input.locais) {
            grid[day][local.id] = Array.from({ length: totalSlots }, () => ({ tipo: "vazio" }));
        }
    }
    return grid;
};
const applyGlobalBlocksOnGrid = (grid, input) => {
    const step = input.competicao.passo_grid;
    const windowStart = input.competicao.inicio_min;
    for (const block of input.bloqueios) {
        if (!grid[block.dia]) {
            continue;
        }
        for (const local of input.locais) {
            const localCells = grid[block.dia][local.id];
            for (let slotIndex = 0; slotIndex < localCells.length; slotIndex += 1) {
                const slotStart = windowStart + slotIndex * step;
                const slotEnd = slotStart + step;
                if (overlapMinutes(slotStart, slotEnd, block.inicio, block.fim) > 0) {
                    localCells[slotIndex] = { tipo: "bloqueado", motivo: block.motivo };
                }
            }
        }
    }
};
const sortMatchesByMode = (matches, mode, teamAllocatedGames, recentTeamIds) => {
    const phasePriority = (match) => {
        if (match.tipo_fase === "classificacao") {
            return 0;
        }
        if (match.fase === "SF1" || match.fase === "SF2") {
            return 1;
        }
        if (match.fase === "3L") {
            return 2;
        }
        if (match.fase === "FINAL") {
            return 3;
        }
        return 1;
    };
    const byPhase = (a, b) => {
        const priorityDiff = phasePriority(a) - phasePriority(b);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        return 0;
    };
    const byRecentTeamPenalty = (a, b) => {
        if (!recentTeamIds || recentTeamIds.size === 0) {
            return 0;
        }
        const sharedA = Number(recentTeamIds.has(a.time_a.id)) + Number(recentTeamIds.has(a.time_b.id));
        const sharedB = Number(recentTeamIds.has(b.time_a.id)) + Number(recentTeamIds.has(b.time_b.id));
        return sharedA - sharedB;
    };
    if (mode === "curtos_primeiro") {
        return [...matches].sort((a, b) => {
            const phaseCmp = byPhase(a, b);
            if (phaseCmp !== 0) {
                return phaseCmp;
            }
            const recentCmp = byRecentTeamPenalty(a, b);
            if (recentCmp !== 0) {
                return recentCmp;
            }
            return a.duracao_min - b.duracao_min;
        });
    }
    if (mode === "longos_primeiro") {
        return [...matches].sort((a, b) => {
            const phaseCmp = byPhase(a, b);
            if (phaseCmp !== 0) {
                return phaseCmp;
            }
            const recentCmp = byRecentTeamPenalty(a, b);
            if (recentCmp !== 0) {
                return recentCmp;
            }
            return b.duracao_min - a.duracao_min;
        });
    }
    if (mode === "agrupar_categoria") {
        const groupKey = (match) => `${match.modalidade_id}::${match.categoria}`;
        const groupCount = new Map();
        for (const match of matches) {
            const key = groupKey(match);
            groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
        }
        return [...matches].sort((a, b) => {
            const phaseCmp = byPhase(a, b);
            if (phaseCmp !== 0) {
                return phaseCmp;
            }
            const countDiff = (groupCount.get(groupKey(b)) ?? 0) - (groupCount.get(groupKey(a)) ?? 0);
            if (countDiff !== 0) {
                return countDiff;
            }
            const recentCmp = byRecentTeamPenalty(a, b);
            if (recentCmp !== 0) {
                return recentCmp;
            }
            if (a.categoria !== b.categoria) {
                return a.categoria.localeCompare(b.categoria, "pt-BR");
            }
            if (a.modalidade !== b.modalidade) {
                return a.modalidade.localeCompare(b.modalidade, "pt-BR");
            }
            return a.fase.localeCompare(b.fase, "pt-BR");
        });
    }
    return [...matches].sort((a, b) => {
        const phaseCmp = byPhase(a, b);
        if (phaseCmp !== 0) {
            return phaseCmp;
        }
        const recentCmp = byRecentTeamPenalty(a, b);
        if (recentCmp !== 0) {
            return recentCmp;
        }
        const difficultyA = (teamAllocatedGames.get(a.time_a.id) ?? 0) + (teamAllocatedGames.get(a.time_b.id) ?? 0);
        const difficultyB = (teamAllocatedGames.get(b.time_a.id) ?? 0) + (teamAllocatedGames.get(b.time_b.id) ?? 0);
        if (difficultyA !== difficultyB) {
            return difficultyB - difficultyA;
        }
        return b.duracao_min - a.duracao_min;
    });
};
const toReasonByRestriction = (firstFailure) => {
    if (!firstFailure) {
        return "Sem capacidade / restricoes impediram alocacao";
    }
    return firstFailure;
};
const buildSchedulePreview = (input) => {
    const warnings = [];
    const matches = [];
    const chaveAssociations = [];
    const teamByCategory = new Map();
    for (const team of input.teams) {
        const current = teamByCategory.get(team.categoria) ?? [];
        current.push(team);
        teamByCategory.set(team.categoria, current);
    }
    for (const [category, teamsInCategory] of teamByCategory) {
        for (const modality of input.modalidades) {
            const categoryToken = normalizeTextKey(category);
            const categoriasConfiguradas = new Set((modality.categorias ??
                // Compatibilidade com payloads salvos antes da introducao de "categorias".
                (modality.formato === "eliminatoria" ? modality.categorias_eliminatoria : []) ??
                []).map((item) => normalizeTextKey(item)));
            const hasCategoryFilter = categoriasConfiguradas.size > 0;
            if (hasCategoryFilter && !categoriasConfiguradas.has(categoryToken)) {
                continue;
            }
            const modalityFormat = modality.formato ?? input.parametros.formato ?? "todos_contra_todos";
            if (modality.regra_genero === "misto") {
                const mixedLogicalTeams = buildMixedLogicalTeams(teamsInCategory);
                if (mixedLogicalTeams.length < 2) {
                    warnings.push(`Sem confrontos para categoria "${category}" na modalidade "${modality.nome}": menos de 2 equipes mistas (nome + categoria).`);
                    continue;
                }
                if (modalityFormat === "eliminatoria") {
                    const chaves = splitTeamsIntoChaves(mixedLogicalTeams);
                    chaves.forEach((chave) => {
                        chave.teams.forEach((team) => {
                            chaveAssociations.push({
                                team_id: team.id,
                                team_nome: team.nome,
                                categoria: team.categoria,
                                genero: team.genero,
                                modalidade_id: modality.id,
                                modalidade: modality.nome,
                                agrupador: "misto",
                                chave: chave.nome,
                            });
                        });
                        const classPairs = generateRoundRobinPairs(chave.teams);
                        classPairs.forEach(([a, b], index) => {
                            matches.push({
                                id: `${modality.id}_${category}_MIX_CH${chave.nome}_${a.id}_${b.id}_${index}`,
                                time_a: { id: a.id, nome: a.nome, categoria: a.categoria, genero: a.genero },
                                time_b: { id: b.id, nome: b.nome, categoria: b.categoria, genero: b.genero },
                                fase: `CHAVE_${chave.nome}_R${index + 1}`,
                                tipo_fase: "classificacao",
                                chave: chave.nome,
                                categoria: category,
                                modalidade: modality.nome,
                                modalidade_id: modality.id,
                                chave_modalidade: `${category}__${modality.id}`,
                                duracao_min: modality.duracao_min,
                                regra_genero: modality.regra_genero,
                            });
                        });
                    });
                    if (chaves.length >= 2 && chaves.every((c) => c.teams.length >= 2)) {
                        const placeholderGender = "X";
                        const token = `${toIdToken(modality.id)}_${toIdToken(category)}_misto`;
                        const p1A = createPlaceholderTeam(`P_1A_${token}`, "1o Chave A", category, placeholderGender);
                        const p2A = createPlaceholderTeam(`P_2A_${token}`, "2o Chave A", category, placeholderGender);
                        const p1B = createPlaceholderTeam(`P_1B_${token}`, "1o Chave B", category, placeholderGender);
                        const p2B = createPlaceholderTeam(`P_2B_${token}`, "2o Chave B", category, placeholderGender);
                        const vSf1 = createPlaceholderTeam(`P_V_SF1_${token}`, "Vencedor SF1", category, placeholderGender);
                        const vSf2 = createPlaceholderTeam(`P_V_SF2_${token}`, "Vencedor SF2", category, placeholderGender);
                        const dSf1 = createPlaceholderTeam(`P_D_SF1_${token}`, "Perdedor SF1", category, placeholderGender);
                        const dSf2 = createPlaceholderTeam(`P_D_SF2_${token}`, "Perdedor SF2", category, placeholderGender);
                        matches.push({
                            id: `${modality.id}_${category}_MIX_SF1`,
                            time_a: p1A,
                            time_b: p2B,
                            fase: "SF1",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        }, {
                            id: `${modality.id}_${category}_MIX_SF2`,
                            time_a: p1B,
                            time_b: p2A,
                            fase: "SF2",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        }, {
                            id: `${modality.id}_${category}_MIX_3L`,
                            time_a: dSf1,
                            time_b: dSf2,
                            fase: "3L",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        }, {
                            id: `${modality.id}_${category}_MIX_FINAL`,
                            time_a: vSf1,
                            time_b: vSf2,
                            fase: "FINAL",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        });
                    }
                }
                else {
                    const pairs = generatePairsByFormat(mixedLogicalTeams, modalityFormat);
                    pairs.forEach(([a, b], index) => {
                        matches.push({
                            id: `${modality.id}_${category}_${a.id}_${b.id}_${index}`,
                            time_a: { id: a.id, nome: a.nome, categoria: a.categoria, genero: a.genero },
                            time_b: { id: b.id, nome: b.nome, categoria: b.categoria, genero: b.genero },
                            fase: `R${index + 1}`,
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        });
                    });
                }
                continue;
            }
            const groupedByGender = new Map();
            for (const team of teamsInCategory) {
                const current = groupedByGender.get(team.genero) ?? [];
                current.push(team);
                groupedByGender.set(team.genero, current);
            }
            ["M", "F", "X"].forEach((gender) => {
                const teamsInGender = groupedByGender.get(gender) ?? [];
                if (teamsInGender.length < 2) {
                    if (teamsInGender.length === 1) {
                        warnings.push(`Sem confrontos para categoria "${category}" na modalidade "${modality.nome}" e genero "${gender}": apenas 1 time.`);
                    }
                    return;
                }
                if (modalityFormat === "eliminatoria") {
                    const chaves = splitTeamsIntoChaves(teamsInGender);
                    chaves.forEach((chave) => {
                        chave.teams.forEach((team) => {
                            chaveAssociations.push({
                                team_id: team.id,
                                team_nome: team.nome,
                                categoria: team.categoria,
                                genero: team.genero,
                                modalidade_id: modality.id,
                                modalidade: modality.nome,
                                agrupador: gender,
                                chave: chave.nome,
                            });
                        });
                        const classPairs = generateRoundRobinPairs(chave.teams);
                        classPairs.forEach(([a, b], index) => {
                            matches.push({
                                id: `${modality.id}_${category}_${gender}_CH${chave.nome}_${a.id}_${b.id}_${index}`,
                                time_a: { id: a.id, nome: a.nome, categoria: a.categoria, genero: a.genero },
                                time_b: { id: b.id, nome: b.nome, categoria: b.categoria, genero: b.genero },
                                fase: `CHAVE_${chave.nome}_R${index + 1}`,
                                tipo_fase: "classificacao",
                                chave: chave.nome,
                                categoria: category,
                                modalidade: modality.nome,
                                modalidade_id: modality.id,
                                chave_modalidade: `${category}__${modality.id}__${gender}`,
                                duracao_min: modality.duracao_min,
                                regra_genero: modality.regra_genero,
                            });
                        });
                    });
                    if (chaves.length >= 2 && chaves.every((c) => c.teams.length >= 2)) {
                        const placeholderGender = gender;
                        const token = `${toIdToken(modality.id)}_${toIdToken(category)}_${toIdToken(gender)}`;
                        const p1A = createPlaceholderTeam(`P_1A_${token}`, "1o Chave A", category, placeholderGender);
                        const p2A = createPlaceholderTeam(`P_2A_${token}`, "2o Chave A", category, placeholderGender);
                        const p1B = createPlaceholderTeam(`P_1B_${token}`, "1o Chave B", category, placeholderGender);
                        const p2B = createPlaceholderTeam(`P_2B_${token}`, "2o Chave B", category, placeholderGender);
                        const vSf1 = createPlaceholderTeam(`P_V_SF1_${token}`, "Vencedor SF1", category, placeholderGender);
                        const vSf2 = createPlaceholderTeam(`P_V_SF2_${token}`, "Vencedor SF2", category, placeholderGender);
                        const dSf1 = createPlaceholderTeam(`P_D_SF1_${token}`, "Perdedor SF1", category, placeholderGender);
                        const dSf2 = createPlaceholderTeam(`P_D_SF2_${token}`, "Perdedor SF2", category, placeholderGender);
                        matches.push({
                            id: `${modality.id}_${category}_${gender}_SF1`,
                            time_a: p1A,
                            time_b: p2B,
                            fase: "SF1",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}__${gender}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        }, {
                            id: `${modality.id}_${category}_${gender}_SF2`,
                            time_a: p1B,
                            time_b: p2A,
                            fase: "SF2",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}__${gender}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        }, {
                            id: `${modality.id}_${category}_${gender}_3L`,
                            time_a: dSf1,
                            time_b: dSf2,
                            fase: "3L",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}__${gender}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        }, {
                            id: `${modality.id}_${category}_${gender}_FINAL`,
                            time_a: vSf1,
                            time_b: vSf2,
                            fase: "FINAL",
                            tipo_fase: "futuro",
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}__${gender}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        });
                    }
                }
                else {
                    const pairs = generatePairsByFormat(teamsInGender, modalityFormat);
                    pairs.forEach(([a, b], index) => {
                        matches.push({
                            id: `${modality.id}_${category}_${gender}_${a.id}_${b.id}_${index}`,
                            time_a: { id: a.id, nome: a.nome, categoria: a.categoria, genero: a.genero },
                            time_b: { id: b.id, nome: b.nome, categoria: b.categoria, genero: b.genero },
                            fase: `R${index + 1}`,
                            categoria: category,
                            modalidade: modality.nome,
                            modalidade_id: modality.id,
                            chave_modalidade: `${category}__${modality.id}__${gender}`,
                            duracao_min: modality.duracao_min,
                            regra_genero: modality.regra_genero,
                        });
                    });
                }
            });
        }
    }
    const demandByKey = new Map();
    for (const match of matches) {
        const key = keyByCategoryAndModality(match.categoria, match.modalidade_id);
        const current = demandByKey.get(key) ?? {
            categoria: match.categoria,
            modalidade: match.modalidade,
            modalidade_id: match.modalidade_id,
            total_jogos: 0,
            demanda_min: 0,
            demanda_ajustada_min: 0,
        };
        current.total_jogos += 1;
        current.demanda_min += match.duracao_min;
        current.demanda_ajustada_min += normalizeAdjustedDuration(match.duracao_min, input.competicao.passo_grid, input.parametros.modo_encaixe);
        demandByKey.set(key, current);
    }
    const viability = [];
    for (const [, demand] of demandByKey) {
        const compatibleLocals = compatibleLocalCount(input.locais, demand.categoria, demand.modalidade_id);
        if (compatibleLocals === 0) {
            warnings.push(`Sem quadra compativel para categoria "${demand.categoria}" e modalidade "${demand.modalidade}".`);
        }
        let totalOfferMinutes = 0;
        for (const day of input.competicao.dias) {
            const totalWindow = input.competicao.fim_min - input.competicao.inicio_min;
            const blockedMinutes = blockedMinutesInWindow(input.bloqueios, day, input.competicao.inicio_min, input.competicao.fim_min);
            const availableForDay = Math.max(0, totalWindow - blockedMinutes);
            totalOfferMinutes += availableForDay * compatibleLocals;
        }
        const saldo = totalOfferMinutes - demand.demanda_ajustada_min;
        viability.push({
            categoria: demand.categoria,
            modalidade: demand.modalidade,
            modalidade_id: demand.modalidade_id,
            total_jogos: demand.total_jogos,
            demanda_min: demand.demanda_min,
            demanda_ajustada_min: demand.demanda_ajustada_min,
            oferta_min: totalOfferMinutes,
            saldo_min: saldo,
            viavel: saldo >= 0,
        });
    }
    const totals = viability.reduce((acc, item) => {
        acc.total_demanda_min += item.demanda_min;
        acc.total_demanda_ajustada_min += item.demanda_ajustada_min;
        acc.total_oferta_min += item.oferta_min;
        acc.total_saldo_min += item.saldo_min;
        return acc;
    }, {
        total_demanda_min: 0,
        total_demanda_ajustada_min: 0,
        total_oferta_min: 0,
        total_saldo_min: 0,
    });
    const grid = buildEmptyGrid(input);
    applyGlobalBlocksOnGrid(grid, input);
    const allocated = [];
    const unallocated = [];
    const teamAllocationsByDay = new Map();
    const teamAllocatedGames = new Map();
    const gamesByLocal = new Map();
    input.locais.forEach((local) => gamesByLocal.set(local.id, 0));
    const preferredLocalByGroup = new Map();
    const lastGroupByTimeline = new Map();
    const lastModalityByTimeline = new Map();
    const totalSlots = Math.floor((input.competicao.fim_min - input.competicao.inicio_min) / input.competicao.passo_grid);
    const step = input.competicao.passo_grid;
    const dayIndexByName = new Map(input.competicao.dias.map((day, index) => [day, index]));
    const toAbsoluteMinute = (day, minuteOfDay) => (dayIndexByName.get(day) ?? 0) * 1440 + minuteOfDay;
    const bracketBaseKey = (match) => match.chave_modalidade;
    const timelineKey = (day, localId) => `${day}::${localId}`;
    const getPhaseConstraint = (match) => {
        if (match.tipo_fase !== "futuro") {
            return { absoluteStartMin: Number.NEGATIVE_INFINITY, blockedReason: null };
        }
        let absoluteStartMin = Number.NEGATIVE_INFINITY;
        const baseKey = bracketBaseKey(match);
        const classificationMatches = matches.filter((item) => item.tipo_fase === "classificacao" && bracketBaseKey(item) === baseKey);
        const allocatedClassification = allocated.filter((item) => item.confronto.tipo_fase === "classificacao" && bracketBaseKey(item.confronto) === baseKey);
        if (classificationMatches.length > 0 && allocatedClassification.length < classificationMatches.length) {
            return {
                absoluteStartMin,
                blockedReason: "Aguardando termino de todas as partidas classificatorias da modalidade/categoria.",
            };
        }
        if (allocatedClassification.length > 0) {
            const latestClassificationEnd = Math.max(...allocatedClassification.map((item) => toAbsoluteMinute(item.dia, item.fim)));
            absoluteStartMin = Math.max(absoluteStartMin, latestClassificationEnd);
        }
        if (match.fase === "3L" || match.fase === "FINAL") {
            const semifinals = matches.filter((item) => item.chave_modalidade === match.chave_modalidade &&
                (item.fase === "SF1" || item.fase === "SF2"));
            const allocatedSemifinals = allocated.filter((item) => item.confronto.chave_modalidade === match.chave_modalidade &&
                (item.confronto.fase === "SF1" || item.confronto.fase === "SF2"));
            if (semifinals.length > 0 && allocatedSemifinals.length < semifinals.length) {
                return {
                    absoluteStartMin,
                    blockedReason: "Aguardando termino das semifinais para liberar 3o lugar/final.",
                };
            }
            if (allocatedSemifinals.length > 0) {
                const latestSemifinalEnd = Math.max(...allocatedSemifinals.map((item) => toAbsoluteMinute(item.dia, item.fim)));
                absoluteStartMin = Math.max(absoluteStartMin, latestSemifinalEnd);
            }
        }
        return { absoluteStartMin, blockedReason: null };
    };
    const getTeamDayAllocations = (teamId, day) => {
        const teamMap = teamAllocationsByDay.get(teamId) ?? new Map();
        teamAllocationsByDay.set(teamId, teamMap);
        const intervals = teamMap.get(day) ?? [];
        teamMap.set(day, intervals);
        return intervals;
    };
    const findBestCandidate = (match) => {
        const phaseConstraint = getPhaseConstraint(match);
        if (phaseConstraint.blockedReason) {
            return { candidate: null, reason: phaseConstraint.blockedReason };
        }
        const compatibleLocals = input.locais.filter((local) => isLocalCompatible(local, match.categoria, match.modalidade_id));
        if (compatibleLocals.length === 0) {
            return { candidate: null, reason: "Sem quadra compativel (modalidade + categoria)" };
        }
        const durationUsed = normalizeAdjustedDuration(match.duracao_min, input.competicao.passo_grid, input.parametros.modo_encaixe);
        const span = Math.ceil(durationUsed / input.competicao.passo_grid);
        let best = null;
        let firstFailure = null;
        for (const day of input.competicao.dias) {
            for (const local of compatibleLocals) {
                for (let startSlotIndex = 0; startSlotIndex + span <= totalSlots; startSlotIndex += 1) {
                    const endSlotIndexExclusive = startSlotIndex + span;
                    const startMin = input.competicao.inicio_min + startSlotIndex * step;
                    const endMin = startMin + durationUsed;
                    const localCells = grid[day][local.id];
                    if (toAbsoluteMinute(day, startMin) < phaseConstraint.absoluteStartMin) {
                        if (!firstFailure) {
                            firstFailure = "Partida dependente de fase anterior ainda nao concluida.";
                        }
                        continue;
                    }
                    let allSlotsAvailable = true;
                    for (let i = startSlotIndex; i < endSlotIndexExclusive; i += 1) {
                        if (localCells[i].tipo !== "vazio") {
                            allSlotsAvailable = false;
                            if (!firstFailure) {
                                firstFailure =
                                    localCells[i].tipo === "bloqueado"
                                        ? "Conflito com bloqueio no horario"
                                        : "Conflito com ocupacao de quadra no horario";
                            }
                            break;
                        }
                    }
                    if (!allSlotsAvailable) {
                        continue;
                    }
                    const intervalsA = getTeamDayAllocations(match.time_a.id, day);
                    const intervalsB = getTeamDayAllocations(match.time_b.id, day);
                    const hasTeamConflict = [...intervalsA, ...intervalsB].some((interval) => conflictByOverlap(startMin, endMin, interval.inicio, interval.fim));
                    if (hasTeamConflict) {
                        if (!firstFailure) {
                            firstFailure = "Conflito de time simultaneo em outra quadra";
                        }
                        continue;
                    }
                    const hasRestViolation = [...intervalsA, ...intervalsB].some((interval) => hasMinimumRestViolation(startMin, endMin, interval.inicio, interval.fim, input.parametros.descanso_minimo));
                    if (hasRestViolation) {
                        if (!firstFailure) {
                            firstFailure = "Descanso minimo insuficiente entre jogos do mesmo time";
                        }
                        continue;
                    }
                    let gapAfterMinutes = 0;
                    for (let i = endSlotIndexExclusive; i < totalSlots; i += 1) {
                        if (localCells[i].tipo !== "vazio") {
                            break;
                        }
                        gapAfterMinutes += step;
                    }
                    let gapBeforeMinutes = 0;
                    for (let i = startSlotIndex - 1; i >= 0; i -= 1) {
                        if (localCells[i].tipo !== "vazio") {
                            break;
                        }
                        gapBeforeMinutes += step;
                    }
                    const totalAllocatedMatches = allocated.length;
                    const averageByLocal = input.locais.length > 0 ? totalAllocatedMatches / input.locais.length : 0;
                    const localMatchesCount = gamesByLocal.get(local.id) ?? 0;
                    const unbalanceAbove = Math.max(0, localMatchesCount - averageByLocal);
                    const penaltyAbove = unbalanceAbove * unbalanceAbove * 200;
                    const unbalanceBelow = Math.max(0, averageByLocal - localMatchesCount);
                    const bonusBelow = unbalanceBelow * 100;
                    const balancing = penaltyAbove - bonusBelow;
                    const gap = gapBeforeMinutes * 3 + gapAfterMinutes;
                    const early = startMin * 0.1;
                    let groupingBias = 0;
                    if (input.parametros.modo_ordem === "agrupar_categoria") {
                        const groupKey = keyByModeAndCategory(match.modalidade_id, match.categoria);
                        const preferredLocal = preferredLocalByGroup.get(groupKey);
                        const timeLocalKey = timelineKey(day, local.id);
                        const previousGroup = lastGroupByTimeline.get(timeLocalKey);
                        const previousModality = lastModalityByTimeline.get(timeLocalKey);
                        // Mantem cada bloco modalidade/categoria mais estavel na mesma quadra.
                        if (preferredLocal) {
                            groupingBias += preferredLocal === local.id ? -260 : 260;
                        }
                        // Reduz alternancia frequente na mesma linha de tempo da quadra.
                        if (previousGroup) {
                            groupingBias += previousGroup === groupKey ? -180 : 90;
                        }
                        if (previousModality) {
                            groupingBias += previousModality === match.modalidade_id ? -120 : 120;
                        }
                    }
                    const score = gap + early + balancing + groupingBias;
                    const candidate = {
                        dia: day,
                        local,
                        startSlotIndex,
                        endSlotIndexExclusive,
                        inicio: startMin,
                        fim: endMin,
                        span,
                        score,
                    };
                    if (!best) {
                        best = candidate;
                        continue;
                    }
                    if (candidate.score < best.score) {
                        best = candidate;
                        continue;
                    }
                    const maxScore = Math.max(Math.abs(candidate.score), Math.abs(best.score), 1);
                    const relativeDiff = Math.abs(candidate.score - best.score) / maxScore;
                    if (relativeDiff < 0.05) {
                        const gamesCurrentBest = gamesByLocal.get(best.local.id) ?? 0;
                        const gamesCurrentCandidate = gamesByLocal.get(candidate.local.id) ?? 0;
                        if (gamesCurrentCandidate < gamesCurrentBest) {
                            best = candidate;
                        }
                    }
                }
            }
        }
        return { candidate: best, reason: toReasonByRestriction(firstFailure) };
    };
    let pendingMatches = [...matches];
    let recentTeamIds;
    const deferredAttempts = new Map();
    const isTemporaryPhaseBlock = (reason) => reason.includes("Aguardando termino") || reason.includes("fase anterior");
    while (pendingMatches.length > 0) {
        const ordered = sortMatchesByMode(pendingMatches, input.parametros.modo_ordem, teamAllocatedGames, input.parametros.descanso_minimo > 0 ? recentTeamIds : undefined);
        const current = ordered[0];
        pendingMatches = pendingMatches.filter((m) => m.id !== current.id);
        const { candidate, reason } = findBestCandidate(current);
        if (!candidate) {
            if (isTemporaryPhaseBlock(reason)) {
                const attempts = (deferredAttempts.get(current.id) ?? 0) + 1;
                deferredAttempts.set(current.id, attempts);
                if (attempts <= matches.length) {
                    pendingMatches.push(current);
                    recentTeamIds = new Set([current.time_a.id, current.time_b.id]);
                    continue;
                }
            }
            unallocated.push({
                confronto_id: current.id,
                confronto: current,
                motivo: reason,
            });
            recentTeamIds = new Set([current.time_a.id, current.time_b.id]);
            continue;
        }
        deferredAttempts.delete(current.id);
        const localCells = grid[candidate.dia][candidate.local.id];
        localCells[candidate.startSlotIndex] = {
            tipo: "confronto",
            confronto: current,
            dia: candidate.dia,
            inicio: candidate.inicio,
            fim: candidate.fim,
            nome_quadra: candidate.local.nome,
            local_id: candidate.local.id,
            span: candidate.span,
        };
        for (let i = candidate.startSlotIndex + 1; i < candidate.endSlotIndexExclusive; i += 1) {
            localCells[i] = { tipo: "continua" };
        }
        getTeamDayAllocations(current.time_a.id, candidate.dia).push({
            inicio: candidate.inicio,
            fim: candidate.fim,
        });
        getTeamDayAllocations(current.time_b.id, candidate.dia).push({
            inicio: candidate.inicio,
            fim: candidate.fim,
        });
        teamAllocatedGames.set(current.time_a.id, (teamAllocatedGames.get(current.time_a.id) ?? 0) + 1);
        teamAllocatedGames.set(current.time_b.id, (teamAllocatedGames.get(current.time_b.id) ?? 0) + 1);
        gamesByLocal.set(candidate.local.id, (gamesByLocal.get(candidate.local.id) ?? 0) + 1);
        if (input.parametros.modo_ordem === "agrupar_categoria") {
            const groupKey = keyByModeAndCategory(current.modalidade_id, current.categoria);
            if (!preferredLocalByGroup.has(groupKey)) {
                preferredLocalByGroup.set(groupKey, candidate.local.id);
            }
            const timeLocalKey = timelineKey(candidate.dia, candidate.local.id);
            lastGroupByTimeline.set(timeLocalKey, groupKey);
            lastModalityByTimeline.set(timeLocalKey, current.modalidade_id);
        }
        allocated.push({
            confronto_id: current.id,
            confronto: current,
            dia: candidate.dia,
            local_id: candidate.local.id,
            nome_quadra: candidate.local.nome,
            inicio: candidate.inicio,
            fim: candidate.fim,
            span: candidate.span,
            score: Number(candidate.score.toFixed(2)),
        });
        recentTeamIds = new Set([current.time_a.id, current.time_b.id]);
    }
    const removeTeamInterval = (teamId, day, inicio, fim) => {
        const intervals = getTeamDayAllocations(teamId, day);
        const index = intervals.findIndex((interval) => interval.inicio === inicio && interval.fim === fim);
        if (index >= 0) {
            intervals.splice(index, 1);
        }
    };
    const clearAllocationFromGrid = (item) => {
        const localCells = grid[item.dia][item.local_id];
        const startSlotIndex = Math.floor((item.inicio - input.competicao.inicio_min) / step);
        const endSlotIndexExclusive = startSlotIndex + item.span;
        for (let i = startSlotIndex; i < endSlotIndexExclusive; i += 1) {
            localCells[i] = { tipo: "vazio" };
        }
    };
    const canPlaceAllocationAt = (item, startSlotIndex) => {
        const endSlotIndexExclusive = startSlotIndex + item.span;
        if (endSlotIndexExclusive > totalSlots) {
            return { canPlace: false, inicio: 0, fim: 0 };
        }
        const localCells = grid[item.dia][item.local_id];
        for (let i = startSlotIndex; i < endSlotIndexExclusive; i += 1) {
            if (localCells[i].tipo !== "vazio") {
                return { canPlace: false, inicio: 0, fim: 0 };
            }
        }
        const inicio = input.competicao.inicio_min + startSlotIndex * step;
        const phaseConstraint = getPhaseConstraint(item.confronto);
        if (phaseConstraint.blockedReason) {
            return { canPlace: false, inicio: 0, fim: 0 };
        }
        if (toAbsoluteMinute(item.dia, inicio) < phaseConstraint.absoluteStartMin) {
            return { canPlace: false, inicio: 0, fim: 0 };
        }
        const durationUsed = normalizeAdjustedDuration(item.confronto.duracao_min, input.competicao.passo_grid, input.parametros.modo_encaixe);
        const fim = inicio + durationUsed;
        const intervalsA = getTeamDayAllocations(item.confronto.time_a.id, item.dia);
        const intervalsB = getTeamDayAllocations(item.confronto.time_b.id, item.dia);
        const hasTeamConflict = [...intervalsA, ...intervalsB].some((interval) => conflictByOverlap(inicio, fim, interval.inicio, interval.fim));
        if (hasTeamConflict) {
            return { canPlace: false, inicio: 0, fim: 0 };
        }
        const hasRestViolation = [...intervalsA, ...intervalsB].some((interval) => hasMinimumRestViolation(inicio, fim, interval.inicio, interval.fim, input.parametros.descanso_minimo));
        if (hasRestViolation) {
            return { canPlace: false, inicio: 0, fim: 0 };
        }
        return { canPlace: true, inicio, fim };
    };
    const placeAllocationInGrid = (item) => {
        const localCells = grid[item.dia][item.local_id];
        const startSlotIndex = Math.floor((item.inicio - input.competicao.inicio_min) / step);
        const endSlotIndexExclusive = startSlotIndex + item.span;
        localCells[startSlotIndex] = {
            tipo: "confronto",
            confronto: item.confronto,
            dia: item.dia,
            inicio: item.inicio,
            fim: item.fim,
            nome_quadra: item.nome_quadra,
            local_id: item.local_id,
            span: item.span,
        };
        for (let i = startSlotIndex + 1; i < endSlotIndexExclusive; i += 1) {
            localCells[i] = { tipo: "continua" };
        }
    };
    const compactAllocations = () => {
        let moved = false;
        const ordered = [...allocated].sort((a, b) => {
            if (a.dia !== b.dia) {
                return a.dia.localeCompare(b.dia);
            }
            if (a.local_id !== b.local_id) {
                return a.local_id.localeCompare(b.local_id);
            }
            return a.inicio - b.inicio;
        });
        for (const item of ordered) {
            const currentStartSlot = Math.floor((item.inicio - input.competicao.inicio_min) / step);
            clearAllocationFromGrid(item);
            removeTeamInterval(item.confronto.time_a.id, item.dia, item.inicio, item.fim);
            removeTeamInterval(item.confronto.time_b.id, item.dia, item.inicio, item.fim);
            let chosenStart = currentStartSlot;
            let chosenInicio = item.inicio;
            let chosenFim = item.fim;
            for (let slot = 0; slot < currentStartSlot; slot += 1) {
                const candidate = canPlaceAllocationAt(item, slot);
                if (candidate.canPlace) {
                    chosenStart = slot;
                    chosenInicio = candidate.inicio;
                    chosenFim = candidate.fim;
                    break;
                }
            }
            if (chosenStart !== currentStartSlot) {
                moved = true;
            }
            item.inicio = chosenInicio;
            item.fim = chosenFim;
            placeAllocationInGrid(item);
            getTeamDayAllocations(item.confronto.time_a.id, item.dia).push({
                inicio: item.inicio,
                fim: item.fim,
            });
            getTeamDayAllocations(item.confronto.time_b.id, item.dia).push({
                inicio: item.inicio,
                fim: item.fim,
            });
        }
        return moved;
    };
    while (compactAllocations()) {
        // Keep compacting until no match can move earlier.
    }
    allocated.sort((a, b) => {
        if (a.dia !== b.dia) {
            return a.dia.localeCompare(b.dia);
        }
        if (a.local_id !== b.local_id) {
            return a.local_id.localeCompare(b.local_id);
        }
        return a.inicio - b.inicio;
    });
    const dayGrid = input.competicao.dias.map((day) => {
        const horarios = Array.from({ length: totalSlots }, (_, slotIndex) => input.competicao.inicio_min + slotIndex * input.competicao.passo_grid);
        const linhas = horarios.map((slotStart, slotIndex) => {
            const slotEnd = slotStart + input.competicao.passo_grid;
            const celulas = input.locais.map((local) => ({
                local_id: local.id,
                nome_quadra: local.nome,
                cell: grid[day][local.id][slotIndex],
            }));
            return {
                inicio: slotStart,
                fim: slotEnd,
                celulas,
            };
        });
        return {
            dia: day,
            horarios,
            linhas,
        };
    });
    const occupiedBlocks = allocated.reduce((sum, item) => sum + item.span, 0);
    let effectiveCapacityBlocks = 0;
    for (const day of input.competicao.dias) {
        for (const local of input.locais) {
            const cells = grid[day][local.id];
            let lastMatchIndex = -1;
            for (let i = cells.length - 1; i >= 0; i -= 1) {
                if (cells[i].tipo === "confronto" || cells[i].tipo === "continua") {
                    lastMatchIndex = i;
                    break;
                }
            }
            if (lastMatchIndex < 0) {
                continue;
            }
            for (let i = 0; i <= lastMatchIndex; i += 1) {
                if (cells[i].tipo !== "bloqueado") {
                    effectiveCapacityBlocks += 1;
                }
            }
        }
    }
    const occupancyRate = effectiveCapacityBlocks > 0 ? (occupiedBlocks / effectiveCapacityBlocks) * 100 : 0;
    return {
        kpis: {
            total_confrontos: matches.length,
            total_alocados: allocated.length,
            total_nao_alocados: unallocated.length,
            capacidade_blocos: effectiveCapacityBlocks,
            taxa_ocupacao_aprox: Number(occupancyRate.toFixed(2)),
            combinacoes: viability.length,
            ...totals,
        },
        avisos: warnings,
        confrontos: matches,
        associacoes_chaves: chaveAssociations,
        alocados: allocated,
        nao_alocados: unallocated,
        grade: dayGrid,
        viabilidade: viability,
    };
};
exports.buildSchedulePreview = buildSchedulePreview;
