// Aventix — bootstrap do banco de teste, UMA vez por rodada de `npm test`.
//
// ============================================================================
// POR QUE ESTE ARQUIVO EXISTE
//
// A suite roda contra o Postgres local de verdade (decisao de 2026-07-28), e o
// catalogo semeado e pre-condicao dela. Ate aqui essa pre-condicao era MANUAL:
// quem esquecesse `npm run db:seed` via 25 testes falharem com mensagem sobre
// catalogo. Pior, o estado do banco virou fonte recorrente de quebra — tres
// episodios ate 28/07, o ultimo deles com a suite vermelha por dias sem ninguem
// perceber.
//
// A partir daqui `npm test` PARTE DE UM BANCO VAZIO e se vira sozinho:
// migra e semeia antes de qualquer arquivo de teste. `docker compose down -v`
// seguido de `npm test` passa direto, sem passo manual.
// ============================================================================
//
// A ORDEM DOS IMPORTS IMPORTA: `dotenv/config` primeiro, porque
// lib/db/client.ts le process.env.DATABASE_URL no import. O globalSetup roda
// ANTES dos setupFiles, entao nao da para contar com o dotenv de tests/setup.ts.

import 'dotenv/config';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db } from '@/lib/db/client';
import { seedTenant } from '@/lib/seed';

/**
 * `docker compose up -d` devolve o controle assim que o CONTAINER sobe, nao
 * quando o Postgres esta aceitando conexao. Sem esta espera, um `npm test`
 * disparado logo apos o `up` falharia com ECONNREFUSED — e falharia de forma
 * intermitente, que e o pior tipo de teste vermelho.
 */
async function waitForPostgres(attempts = 30, delayMs = 500): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await db.execute(sql`SELECT 1`);
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(
          `Postgres nao respondeu apos ${attempts} tentativas. O container esta no ar? ` +
            '`docker compose -f docker-compose.dev.yml up -d`. Erro: ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export default async function setup(): Promise<void> {
  await waitForPostgres();

  // Idempotente por natureza: o drizzle registra o que ja aplicou em
  // drizzle.__drizzle_migrations e pula. Num banco vazio cria as 13 tabelas, a
  // extensao btree_gist e a exclusion constraint; num banco ja migrado e no-op.
  await migrate(db, { migrationsFolder: 'drizzle' });

  // Tambem idempotente (reconcilia, nunca apaga). Rodar duas vezes seguidas
  // deixa o banco no mesmo estado, que e o que permite `npm test` repetido dar
  // placar identico.
  const report = await seedTenant();

  const created =
    report.settings.created +
    report.resources.created +
    report.experiences.created +
    report.operatingHours.created;

  // Uma linha so, e so quando houve escrita: num banco ja semeado (o caso
  // comum) o setup fica em silencio e nao polui a saida da suite.
  if (created > 0 || report.tenantCreated) {
    console.log(`[global-setup] catalogo semeado (${created} registro(s) criado(s))`);
  }
}
