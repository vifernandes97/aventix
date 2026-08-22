// Aventix — CRUD de excecoes de agenda (CLAUDE.md secoes 4.3, 6 e 7.2).
//
// Uma excecao diz o que acontece numa DATA especifica, passando por cima da
// grade semanal. Cobre os dois casos numa peca so:
//   - `closed = true`  -> o dia nao tem grade nenhuma (recesso, feriado fechado);
//   - `closed = false` -> vale o opens/closes DA EXCECAO, ignorando o
//     operating_hours daquele weekday. E o que permite abrir numa terca em que
//     o tenant normalmente nao opera — o caso de uso que motivou a tabela, e
//     justamente quando o Quadri Club vende.
//
// >>> PRECEDENCIA (secao 6) <<<
// schedule_exceptions VENCE operating_hours, sempre. Blackouts aplicam por cima
// das duas. Quem implementa a precedencia e o passo 1 de lib/availability.ts
// (venda) e getDayGrid em lib/calendar.ts (desenho) — este modulo so escreve as
// linhas. Nao reimplemente a regra aqui: seria a terceira copia.
//
// >>> AQUI EXISTE DELETE, ao contrario de lib/experiences.ts <<<
// Nenhuma FK aponta para esta tabela: nada referencia uma excecao. Apagar e o
// comportamento certo e nao deixa orfao. Nao replique o "desativar em vez de
// apagar" das experiencias, que existe porque reservations.experience_id
// referencia aquela tabela e apagar quebraria historico.
//
// E apagar uma excecao NAO cancela reserva nenhuma: a reserva ja tem recurso
// alocado em reservation_resources.period, e a grade governa apenas o que ainda
// PODE SER VENDIDO. Vale para as tres tabelas de grade.
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts e experiences.ts: fala com o
// Postgres e resolve o tenant sozinho. O tenant NUNCA vem do cliente.

import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from './db/client';
import { scheduleExceptions } from './db/schema';
import { getTenantId } from './tenant';

// ============================================================================
// Tipos
// ============================================================================

export type ScheduleExceptionRow = {
  id: number;
  /** 'YYYY-MM-DD'. Coluna `date`: NAO passa por new Date() (secao 3). */
  date: string;
  closed: boolean;
  /** 'HH:MM' — null quando closed. Ver normalizeTime sobre os segundos. */
  opens: string | null;
  closes: string | null;
  reason: string | null;
};

/**
 * Dia fechado nao carrega horario, e dia aberto exige os dois. A uniao
 * discriminada faz o compilador cobrar isso de quem chama, antes de o CHECK
 * `schedule_exceptions_closed_check` cobrar do banco (onde viraria 500).
 */
export type ScheduleExceptionInput =
  | { date: string; closed: true; reason: string | null }
  | { date: string; closed: false; opens: string; closes: string; reason: string | null };

// ============================================================================
// Erros de dominio — a rota os traduz em HTTP sem conhecer a query
// ============================================================================

export class ScheduleExceptionNotFoundError extends Error {
  constructor(public readonly exceptionId: number) {
    super(`excecao ${exceptionId} nao encontrada`);
    this.name = 'ScheduleExceptionNotFoundError';
  }
}

/**
 * Ja existe excecao para a data. E o `schedule_exceptions_tenant_date_unique`.
 *
 * Vira 409, e nao 422: o corpo esta perfeito: o que conflita e o ESTADO do
 * banco. A diferenca importa para a tela, que responde a este caso oferecendo
 * editar a excecao existente em vez de repetir "dados invalidos" sobre uma data
 * que o dono digitou certo.
 *
 * Um upsert silencioso seria pior: sobrescreveria sem aviso uma regra que o
 * dono cadastrou semanas antes e nao lembra.
 */
export class ScheduleExceptionDateTakenError extends Error {
  constructor(public readonly date: string) {
    super(`ja existe excecao para ${date}`);
    this.name = 'ScheduleExceptionDateTakenError';
  }
}

// ============================================================================
// Normalizacao
// ============================================================================

/**
 * 'HH:MM:SS' -> 'HH:MM'.
 *
 * A coluna e `time` e o Postgres devolve com segundos; a tela trabalha em
 * 'HH:MM' (o que `<input type="time">` produz e consome). Sem o corte, o valor
 * volta para o formulario de edicao como '08:00:00' e o input o rejeita
 * silenciosamente, deixando o campo vazio — o dono salva de novo e perde o
 * horario. Mesma normalizacao que lib/seed.ts aplica.
 */
function normalizeTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

/**
 * Violacao de unicidade do Postgres (23505).
 *
 * O codigo pode vir em `cause` ou na raiz: o Drizzle EMBRULHA o erro do driver
 * numa excecao propria, entao ler so `error.code` devolve undefined e o 409
 * viraria 500 — medido. Mesma leitura de dois niveis de `isExclusionViolation`
 * em lib/reservations.ts, que existe pelo mesmo motivo.
 */
function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (error as { code?: string })?.code;
  return code === '23505';
}

const COLUMNS = {
  id: scheduleExceptions.id,
  date: scheduleExceptions.date,
  closed: scheduleExceptions.closed,
  opens: scheduleExceptions.opens,
  closes: scheduleExceptions.closes,
  reason: scheduleExceptions.reason,
} as const;

const toRow = (row: ScheduleExceptionRow): ScheduleExceptionRow => ({
  ...row,
  opens: normalizeTime(row.opens),
  closes: normalizeTime(row.closes),
});

// ============================================================================
// Leitura
// ============================================================================

/**
 * TODAS as excecoes do tenant, em ordem cronologica crescente.
 *
 * As passadas VOLTAM junto de proposito. Elas nao afetam mais nada (a grade so
 * oferece horario futuro), mas sao o registro do que o dono ja fez — e sumir com
 * elas transformaria "o feriado do mes passado" em "eu nunca cadastrei isso?".
 * Quem separa passado de futuro e a tela, que tem o "hoje" do fuso do tenant.
 */
export async function listScheduleExceptions(): Promise<ScheduleExceptionRow[]> {
  const rows = await db
    .select(COLUMNS)
    .from(scheduleExceptions)
    .where(eq(scheduleExceptions.tenantId, getTenantId()))
    .orderBy(asc(scheduleExceptions.date));

  return rows.map(toRow);
}

// ============================================================================
// Escrita
// ============================================================================

/**
 * @throws {ScheduleExceptionDateTakenError} ja existe excecao para a data.
 *
 * A checagem de duplicidade e o proprio UNIQUE do banco, capturado como 23505 —
 * nao um SELECT antes do INSERT. Um SELECT deixaria janela entre a consulta e a
 * gravacao; e mesmo com um unico operador (o dono), o duplo clique no botao
 * salvar produz exatamente essa corrida.
 */
export async function createScheduleException(
  input: ScheduleExceptionInput,
): Promise<ScheduleExceptionRow> {
  const values = {
    tenantId: getTenantId(),
    date: input.date,
    closed: input.closed,
    // Dia fechado grava NULL nos dois horarios. Guardar "08:00" numa data
    // fechada seria dado que contradiz a propria linha, e ressuscitaria como
    // horario real se alguem so virasse o `closed` depois.
    opens: input.closed ? null : input.opens,
    closes: input.closed ? null : input.closes,
    reason: input.reason,
  };

  try {
    const [row] = await db.insert(scheduleExceptions).values(values).returning(COLUMNS);
    return toRow(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ScheduleExceptionDateTakenError(input.date);
    throw error;
  }
}

/**
 * Substitui a excecao inteira. NAO e parcial, ao contrario do PATCH de
 * experiencias.
 *
 * O motivo e o CHECK `schedule_exceptions_closed_check`: os campos sao
 * interdependentes (virar `closed` para false exige opens e closes juntos), e um
 * patch parcial permitiria mandar `{ closed: false }` sozinho sobre uma linha
 * que tem os horarios em NULL — corpo aparentemente valido, 500 do banco.
 * Exigir a linha completa faz a validacao de borda conseguir julgar sozinha se o
 * resultado e legal.
 *
 * A DATA tambem entra: mover a excecao de dia e edicao legitima (o feriado
 * caiu noutra data), e ela reencontra o UNIQUE se colidir com outra linha.
 *
 * @throws {ScheduleExceptionNotFoundError} id inexistente OU de outro tenant —
 *         indistinguiveis de proposito (decisao de 03/08).
 * @throws {ScheduleExceptionDateTakenError} a nova data ja tem excecao.
 */
export async function updateScheduleException(
  exceptionId: number,
  input: ScheduleExceptionInput,
): Promise<ScheduleExceptionRow> {
  const values = {
    date: input.date,
    closed: input.closed,
    opens: input.closed ? null : input.opens,
    closes: input.closed ? null : input.closes,
    reason: input.reason,
  };

  try {
    const [row] = await db
      .update(scheduleExceptions)
      .set(values)
      // O tenant entra no WHERE junto do id: sem ele, um id de outro tenant
      // seria editavel por quem descobrisse o numero — e `serial` e adivinhavel
      // por contagem.
      .where(
        and(
          eq(scheduleExceptions.id, exceptionId),
          eq(scheduleExceptions.tenantId, getTenantId()),
        ),
      )
      .returning(COLUMNS);

    if (!row) throw new ScheduleExceptionNotFoundError(exceptionId);
    return toRow(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ScheduleExceptionDateTakenError(input.date);
    throw error;
  }
}

/**
 * Apaga a excecao. O dia volta a seguir o operating_hours do weekday.
 *
 * NAO toca em reserva nenhuma — nem podia: nada referencia esta tabela. Uma
 * reserva ja vendida num dia aberto por excecao continua de pe depois que a
 * excecao some, porque a vaga dela vive em reservation_resources.period, que e
 * congelado na venda (secao 4.6). A grade governa venda FUTURA, so isso.
 *
 * @throws {ScheduleExceptionNotFoundError} inexistente ou de outro tenant.
 */
export async function deleteScheduleException(exceptionId: number): Promise<void> {
  const [row] = await db
    .delete(scheduleExceptions)
    .where(
      and(eq(scheduleExceptions.id, exceptionId), eq(scheduleExceptions.tenantId, getTenantId())),
    )
    .returning({ id: scheduleExceptions.id });

  if (!row) throw new ScheduleExceptionNotFoundError(exceptionId);
}
