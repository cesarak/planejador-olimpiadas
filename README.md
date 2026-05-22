# Planejador de Olimpiadas - Backend + Dashboard

Projeto com API e dashboard visual para entrada de dados pelos usuarios:

- Fastify (API REST)
- Prisma (PostgreSQL)
- Dashboard web (`/` e `/dashboard`) para cadastro de dados e geracao de cronograma
- Endpoint de agendamento (incremento 4.1): geracao, viabilidade, alocacao, persistencia e comparacao avancada de versoes
- Dashboard v2 (`/dashboard-v2` ou `/dashboard-pro`) com login/senha e autorizacao por usuario

## Requisitos

- Node.js 20+
- PostgreSQL (para futuras etapas com persistencia)

## Executar

1. Copie `.env.example` para `.env` e ajuste os valores.
2. Instale dependencias:

```bash
npm install
```

3. Execute em modo desenvolvimento:

```bash
npm run dev
```

## Docker Compose (web + api + banco)

Suba todos os servicos:

```bash
docker compose up --build -d
docker compose ps
```

Acesse:

- Web: `http://localhost:8080`
- API health: `http://localhost:8080/health`
- PostgreSQL (host): `localhost:5433` (altere com `POSTGRES_HOST_PORT`)

Para acompanhar logs:

```bash
docker compose logs -f
```

Para parar/remover os containers:

```bash
docker compose down
```

Se for rodar fora do Docker, gere o client e rode migracoes:

```bash
npm run prisma:generate
npx prisma migrate dev --name init_incremento_3
npx prisma migrate dev --name auth_dashboard_v2
```

## Endpoints

- `GET /` (dashboard)
- `GET /dashboard` (dashboard)
- `GET /dashboard-v2` (dashboard profissional com auth)
- `GET /dashboard-pro` (alias do dashboard-v2)
- `GET /health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/competitions` (com `Authorization: Bearer <token>` ou `tenantId`)
- `POST /api/competitions` (com `Authorization: Bearer <token>` ou `tenantId`)
- `GET /api/competitions/:competitionId`
- `PUT /api/competitions/:competitionId`
- `DELETE /api/competitions/:competitionId`
- `POST /api/scheduling/generate`
- `GET /api/scheduling/versions?tenantId=...&competitionId=...&page=1&pageSize=20&status=GENERATED&createdBy=user&nomeContains=versao`
- `GET /api/scheduling/versions/:versionId?tenantId=...`
- `POST /api/scheduling/versions/compare`

### Auth e autorizacao por usuario

- Cadastre com `POST /api/auth/signup` (name, email, password, organizationName opcional)
- Faça login com `POST /api/auth/login` (email, password)
- Envie o token no header `Authorization: Bearer <token>`
- No dashboard v2, os campeonatos sao filtrados automaticamente para o usuario logado

Se enviar `persistencia.salvar = true`, o endpoint tambem persiste:

- `ScheduleVersion` (versao gerada)
- `Match` (confrontos gerados)
- `ScheduledMatch` (alocados e nao alocados)

Comparacao de versoes (`POST /api/scheduling/versions/compare`) recebe:

```json
{
  "versionAId": "versao-1",
  "versionBId": "versao-2",
  "tenantId": "tenant-opcional"
}
```

Resposta de comparacao agora inclui:

- `resumo_diff` com contadores (status, horario, quadra, motivo, novos/removidos)
- `mudancas_detalhadas` por `sourceMatchId`

### Exemplo rapido

```bash
curl -X POST http://localhost:3333/api/scheduling/generate \
  -H "Content-Type: application/json" \
  -d '{
    "teams": [
      { "id": "team-1", "nome": "A", "categoria": "5-Ano", "genero": "M" },
      { "id": "team-2", "nome": "B", "categoria": "5-Ano", "genero": "M" },
      { "id": "team-3", "nome": "C", "categoria": "5-Ano", "genero": "F" }
    ],
    "modalidades": [
      { "id": "mod-1", "nome": "Futsal", "duracao_min": 25, "regra_genero": "separado" },
      { "id": "mod-2", "nome": "Queimada", "duracao_min": 15, "regra_genero": "misto" }
    ],
    "locais": [
      { "id": "l1", "nome": "Quadra 1", "modalidades_permitidas": ["mod-1", "mod-2"], "categorias_permitidas": "*" },
      { "id": "l2", "nome": "Quadra 2", "modalidades_permitidas": "*", "categorias_permitidas": "*" }
    ],
    "bloqueios": [
      { "dia": "2026-03-12", "inicio": 590, "fim": 610, "motivo": "Recreio" }
    ],
    "competicao": {
      "inicio_min": 480,
      "fim_min": 720,
      "passo_grid": 5,
      "dias": ["2026-03-12"]
    },
    "parametros": {
      "descanso_minimo": 25,
      "formato": "todos_contra_todos",
      "modo_encaixe": "arredondar_cima",
      "modo_ordem": "dificil_primeiro"
    },
    "persistencia": {
      "salvar": false
    }
  }'
```
