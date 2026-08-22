// Aventix — bloqueios pontuais de recurso ou periodo (CLAUDE.md secoes 4.3 e 6).
//
// Um blackout tira um intervalo de tempo da venda: quadriciclo na manutencao,
// tarde reservada para um evento fechado, guia de folga.
//
// >>> BLACKOUTS APLICAM POR CIMA DE TUDO (secao 6) <<<
// Inclusive de dia aberto por schedule_exception. Enquanto excecao e grade
// disputam a precedencia entre si, o blackout nao disputa: ele corta o que
// sobrou. Quem implementa isso e o passo 2 de lib/availability.ts, num
// `NOT EXISTS` sobre `period &&` — este modulo so escreve as linhas.
//
// >>> resource_id NULL = TODOS os recursos <<<
// E o bloqueio do tenant inteiro (feriado do guia, estrada interditada). Um
// blackout com recurso preenchido tira so aquele recurso, e a venda continua
// nos outros — que e o caso da manutencao de UM quadriciclo.
//
// >>> AQUI EXISTE DELETE, e ele NAO cancela reserva <<<
// Nada referencia blackouts. E criar ou apagar um blackout nao mexe em reserva
// ja vendida: a vaga dela vive em reservation_resources.period, congelada na
// venda (secao 4.6). Criar um blackout por cima de uma reserva existente NAO a
// cancela nem a esconde — apenas impede vendas NOVAS naquele intervalo.
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts e experiences.ts.

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from './db/client';
import { blackouts, resources } from './db/schema';
import { getTenantId } from './tenant';
import { localToUtc } from './time';

// ============================================================================
// Tipos
// ============================================================================

export type BlackoutRow = {
  id: number;
  /** null = todos os recursos do tenant. */
  resourceId: number | null;
  /** Nome do recurso, ja resolvido — null quando o bloqueio e geral. */
  resourceName: string | null;
  /** ISO 8601 (secao 3). */
  startAt: string;
  endAt: string;
  reason: string | null;
};

/**
 * Entrada em HORARIO LOCAL do tenant, nao em instante ISO.
 *
 * `startLocal`/`endLocal` sao 'YYYY-MM-DDTHH:MM' SEM fuso — exatamente o que um
 * `<input type="datetime-local">` produz. A conversao para UTC acontece aqui,
 * com localToUtc, que e a mesma travessia que o motor de disponibilidade usa
 * (secao 3: fuso nas bordas, UTC no banco).
 *
 * Aceitar ISO com 'Z' seria pior: o dono digita "14:00" pensando em 14h de
 * Brasilia, e um cliente que montasse o ISO errado bloquearia 11h — sem erro
 * nenhum aparecendo, com o bloqueio na hora errada.
 */
export type BlackoutInput = {
  resourceId: number | null;
  startLocal: string;
  endLocal: string;
  reason: string | null;
};

export class BlackoutNotFoundError extends Error {
  constructor(public readonly blackoutId: number) {
    super(`bloqueio ${blackoutId} nao encontrado`);
    this.name = 'BlackoutNotFoundError';
  }
}

/** Recurso inexistente ou de outro tenant. Vira 422 — e dado do corpo. */
export class BlackoutResourceNotFoundError extends Error {
  constructor(public readonly resourceId: number) {
    super(`recurso ${resourceId} nao encontrado`);
    this.name = 'BlackoutResourceNotFoundError';
  }
}

// ============================================================================
// Leitura
// ============================================================================

type Row = {
  id: number;
  resource_id: number | null;
  resource_name: string | null;
  start_at: string;
  end_at: string;
  reason: string | null;
};

/**
 * Todos os bloqueios do tenant, do mais proximo ao mais distante.
 *
 * `lower(period)` e `upper(period)` desmontam o tstzrange nas duas pontas que a
 * tela mostra; nao existe leitura util do range como texto cru
 * ('["2026-08-24 11:00+00","2026-08-24 15:00+00")' nao vai para tela nenhuma).
 */
export async function listBlackouts(): Promise<BlackoutRow[]> {
  const { rows } = await db.execute<Row>(sql`
    SELECT
      b.id                    AS id,
      b.resource_id           AS resource_id,
      r.name                  AS resource_name,
      lower(b.period)         AS start_at,
      upper(b.period)         AS end_at,
      b.reason                AS reason
    FROM blackouts b
    LEFT JOIN resources r ON r.id = b.resource_id
    WHERE b.tenant_id = ${getTenantId()}
    ORDER BY lower(b.period)
  `);

  // O driver devolve o TEXTO CRU do Postgres para timestamptz. Toda saida de
  // lib/ para a API vai em ISO 8601 (secao 3) — o V8 tolera o formato cru,
  // outros motores devolvem NaN.
  return rows.map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    startAt: new Date(row.start_at).toISOString(),
    endAt: new Date(row.end_at).toISOString(),
    reason: row.reason,
  }));
}

// ============================================================================
// Escrita
// ============================================================================

/** 'YYYY-MM-DDTHH:MM' local -> instante UTC, pelo fuso do tenant. */
function toInstant(local: string): Date {
  const [date, time] = local.split('T');
  return localToUtc(date, time);
}

/**
 * O recurso existe e e DESTE tenant?
 *
 * Sem esta checagem, um resource_id de outro tenant passaria pela FK (que so
 * olha a tabela, nao o tenant) e criaria um bloqueio apontando para fora — e um
 * id inexistente viraria erro de FK, ou seja, 500 em vez de 422.
 */
async function assertResourceBelongsToTenant(resourceId: number | null): Promise<void> {
  if (resourceId === null) return;

  const [row] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.tenantId, getTenantId())));

  if (!row) throw new BlackoutResourceNotFoundError(resourceId);
}

const periodSql = (input: BlackoutInput) =>
  sql`tstzrange(${toInstant(input.startLocal).toISOString()}::timestamptz, ${toInstant(input.endLocal).toISOString()}::timestamptz)`;

/** @throws {BlackoutResourceNotFoundError} */
export async function createBlackout(input: BlackoutInput): Promise<BlackoutRow> {
  await assertResourceBelongsToTenant(input.resourceId);

  const [inserted] = await db
    .insert(blackouts)
    .values({
      tenantId: getTenantId(),
      resourceId: input.resourceId,
      period: periodSql(input),
      reason: input.reason,
    })
    .returning({ id: blackouts.id });

  return findOrThrow(inserted.id);
}

/**
 * Substitui o bloqueio inteiro (PUT). Mesmo motivo das outras duas telas de
 * grade: os campos sao interdependentes e a validacao precisa dos quatro juntos.
 *
 * @throws {BlackoutNotFoundError} inexistente ou de outro tenant.
 * @throws {BlackoutResourceNotFoundError}
 */
export async function updateBlackout(
  blackoutId: number,
  input: BlackoutInput,
): Promise<BlackoutRow> {
  await assertResourceBelongsToTenant(input.resourceId);

  const [row] = await db
    .update(blackouts)
    .set({
      resourceId: input.resourceId,
      period: periodSql(input),
      reason: input.reason,
    })
    .where(and(eq(blackouts.id, blackoutId), eq(blackouts.tenantId, getTenantId())))
    .returning({ id: blackouts.id });

  if (!row) throw new BlackoutNotFoundError(blackoutId);
  return findOrThrow(row.id);
}

/**
 * Apaga o bloqueio. O intervalo volta a poder ser vendido.
 *
 * NAO ressuscita nem cancela reserva nenhuma — ver o cabecalho do arquivo.
 *
 * @throws {BlackoutNotFoundError} inexistente ou de outro tenant.
 */
export async function deleteBlackout(blackoutId: number): Promise<void> {
  const [row] = await db
    .delete(blackouts)
    .where(and(eq(blackouts.id, blackoutId), eq(blackouts.tenantId, getTenantId())))
    .returning({ id: blackouts.id });

  if (!row) throw new BlackoutNotFoundError(blackoutId);
}

/**
 * Rele a linha pela listagem.
 *
 * O `returning` do insert/update nao consegue trazer `lower`/`upper` do range
 * nem o nome do recurso (que vem de JOIN), e montar o retorno na mao a partir da
 * entrada devolveria o que o CHAMADOR mandou em vez do que o banco gravou —
 * justamente onde uma conversao de fuso errada passaria despercebida.
 */
async function findOrThrow(blackoutId: number): Promise<BlackoutRow> {
  const row = (await listBlackouts()).find((b) => b.id === blackoutId);
  if (!row) throw new BlackoutNotFoundError(blackoutId);
  return row;
}
