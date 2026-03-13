export type TeamGender = "M" | "F" | "X";
export type GenderRule = "misto" | "separado";
export type TournamentFormat = "todos_contra_todos" | "eliminatoria";
export type FitMode = "arredondar_cima" | "exato";
export type OrderMode =
  | "curtos_primeiro"
  | "longos_primeiro"
  | "dificil_primeiro"
  | "agrupar_categoria";

export interface TeamInput {
  id: string;
  nome: string;
  categoria: string;
  genero: TeamGender;
}

export interface ModalityInput {
  id: string;
  nome: string;
  duracao_min: number;
  regra_genero: GenderRule;
  // Categorias em que esta modalidade (nesta linha/ID) deve ser aplicada.
  categorias?: string[];
  // Lista de categorias que devem usar eliminatoria para esta modalidade.
  categorias_eliminatoria?: string[];
  formato?: TournamentFormat;
}

export interface LocalInput {
  id: string;
  nome: string;
  modalidades_permitidas: string[] | "*" | null;
  categorias_permitidas: string[] | "*" | null;
}

export interface CompetitionConfigInput {
  inicio_min: number;
  fim_min: number;
  passo_grid: number;
  dias: string[];
}

export interface BlockingInput {
  id?: string;
  dia: string;
  inicio: number;
  fim: number;
  motivo: string;
}

export interface SchedulingParamsInput {
  descanso_minimo: number;
  // Deprecated: formato agora deve ser definido por modalidade.
  formato?: TournamentFormat;
  modo_encaixe: FitMode;
  modo_ordem: OrderMode;
  algoritmo?: "GREEDY" | "SIMULATED_ANNEALING";
}

export interface MatchGenerated {
  id: string;
  time_a: Pick<TeamInput, "id" | "nome" | "categoria" | "genero">;
  time_b: Pick<TeamInput, "id" | "nome" | "categoria" | "genero">;
  fase: string;
  tipo_fase?: "classificacao" | "futuro";
  chave?: string;
  categoria: string;
  modalidade: string;
  modalidade_id: string;
  chave_modalidade: string;
  duracao_min: number;
  regra_genero: GenderRule;
}

export interface TeamChaveAssociation {
  team_id: string;
  team_nome: string;
  categoria: string;
  genero: TeamGender;
  modalidade_id: string;
  modalidade: string;
  agrupador: string;
  chave: string;
}

export interface ViabilityItem {
  categoria: string;
  modalidade: string;
  modalidade_id: string;
  total_jogos: number;
  demanda_min: number;
  demanda_ajustada_min: number;
  oferta_min: number;
  saldo_min: number;
  viavel: boolean;
}

export interface SchedulingInput {
  teams: TeamInput[];
  modalidades: ModalityInput[];
  locais: LocalInput[];
  bloqueios: BlockingInput[];
  competicao: CompetitionConfigInput;
  parametros: SchedulingParamsInput;
}

export interface PersistOptionsInput {
  salvar: boolean;
  tenantId?: string;
  competitionId?: string;
  nomeVersao?: string;
  createdBy?: string;
}

export interface SchedulingResult {
  kpis: {
    total_confrontos: number;
    total_alocados: number;
    total_nao_alocados: number;
    capacidade_blocos: number;
    taxa_ocupacao_aprox: number;
    combinacoes: number;
    total_demanda_min: number;
    total_demanda_ajustada_min: number;
    total_oferta_min: number;
    total_saldo_min: number;
  };
  avisos: string[];
  confrontos: MatchGenerated[];
  associacoes_chaves: TeamChaveAssociation[];
  alocados: ScheduledMatch[];
  nao_alocados: UnallocatedMatch[];
  grade: DayGrid[];
  viabilidade: ViabilityItem[];
  persistencia?: {
    scheduleVersionId: string;
    totalMatchesPersistidos: number;
    totalScheduledItensPersistidos: number;
  };
}

export interface ScheduledMatch {
  confronto_id: string;
  confronto: MatchGenerated;
  dia: string;
  local_id: string;
  nome_quadra: string;
  inicio: number;
  fim: number;
  span: number;
  score: number;
}

export interface UnallocatedMatch {
  confronto_id: string;
  confronto: MatchGenerated;
  motivo: string;
}

export type GridCell =
  | { tipo: "vazio" }
  | { tipo: "bloqueado"; motivo: string }
  | {
      tipo: "confronto";
      confronto: MatchGenerated;
      dia: string;
      inicio: number;
      fim: number;
      nome_quadra: string;
      local_id: string;
      span: number;
    }
  | { tipo: "continua" };

export interface DayGridRow {
  inicio: number;
  fim: number;
  celulas: Array<{
    local_id: string;
    nome_quadra: string;
    cell: GridCell;
  }>;
}

export interface DayGrid {
  dia: string;
  horarios: number[];
  linhas: DayGridRow[];
}
