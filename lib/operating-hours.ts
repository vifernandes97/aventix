// Aventix — horarios de funcionamento recorrentes (CLAUDE.md secoes 4.3 e 6).
//
// A grade SEMANAL do tenant: faixas por dia da semana (0=domingo). Pode haver
// mais de uma faixa no mesmo dia — manha e tarde, com intervalo de almoco no
// meio.
//
// >>> ESTA GRADE E A BASE, E PERDE PARA schedule_exceptions <<<
// Numa data com excecao, o operating_hours daquele weekday e IGNORADO por
// completo (secao 6). Quem implementa a precedencia e o passo 1 de
// lib/availability.ts (venda) e getDayGrid em lib/calendar.ts (desenho).
//
// >>> A LEITURA SERVE A DUAS TELAS <<<
// A de horarios (este CRUD) e a de EXCECOES, que usa `getWeeklyGrid` para
// mostrar o contraste "hoje x com a excecao" — e o que torna a precedencia da
// secao 6 visivel em vez de abstrata.
//
// >>> FAIXAS SOBREPOSTAS SAO RECUSADAS AQUI <<<
// O schema NAO impede duas faixas cruzadas no mesmo weekday, e o motor de
// disponibilidade ja se defende delas deduplicando candidatos por instante —
// com um comentario que diz textualmente que "o certo e o CRUD de horarios
// recusar faixas sobrepostas no cadastro". Este e o CRUD. A defesa em
// availability.ts FICA onde esta: as duas juntas sao defesa em profundidade, e
// tirar a de la deixaria dado antigo (ou vindo de seed) sem rede.
//
// >>> AQUI EXISTE DELETE <<<
// Nada referencia operating_hours. E apagar uma faixa NAO cancela reserva ja
// vendida naquele horario: a vaga vive em reservation_resources.period,
// congelada na venda (secao 4.6). A grade governa venda FUTURA, so isso.
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts e experiences.ts.

import 'server-only';

import { and, asc, eq, ne } from 'drizzle-orm';

import { db } from './db/client';
import { operatingHours } from './db/schema';
import { getTenantId } from './tenant';

export type OperatingHoursRow = {
  id: number;
  /** 0=domingo .. 6=sabado */
  weekday: number;
  /** 'HH:MM' — ver normalizeTime sobre os segundos do Postgres. */
  opens: string;
  closes: string;
};

/** Faixas de um dia da semana. Array vazio = o tenant nao opera nesse dia. */
export type WeeklyGrid = Record<number, { opens: string; closes: string }[]>;

/**
 * 'HH:MM:SS' -> 'HH:MM'. A coluna e `time` e o Postgres devolve com segundos;
 * `<input type="time">` so entende 'HH:MM' e descarta o resto em silencio.
 */
const normalizeTime = (value: string) => value.slice(0, 5);

/** Todas as faixas do tenant, em ordem de leitura humana (domingo -> sabado). */
export async function listOperatingHours(): Promise<OperatingHoursRow[]> {
  const rows = await db
    .select({
      id: operatingHours.id,
      weekday: operatingHours.weekday,
      opens: operatingHours.opens,
      closes: operatingHours.closes,
    })
    .from(operatingHours)
    .where(eq(operatingHours.tenantId, getTenantId()))
    .orderBy(asc(operatingHours.weekday), asc(operatingHours.opens));

  return rows.map((r) => ({
    ...r,
    opens: normalizeTime(r.opens),
    closes: normalizeTime(r.closes),
  }));
}

/**
 * As mesmas faixas indexadas por weekday, com os SETE dias presentes.
 *
 * Os dias sem faixa vem como array vazio em vez de ausentes: quem consome
 * (a tela de excecoes) precisa dizer "terca: nao opera", e uma chave faltando
 * viraria `undefined` e um `.map` quebrado no meio do render.
 */
export async function getWeeklyGrid(): Promise<WeeklyGrid> {
  const grid: WeeklyGrid = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  for (const row of await listOperatingHours()) {
    grid[row.weekday].push({ opens: row.opens, closes: row.closes });
  }

  return grid;
}

// ============================================================================
// Erros de dominio — a rota os traduz em HTTP sem conhecer a query
// ============================================================================

export class OperatingHoursNotFoundError extends Error {
  constructor(public readonly rowId: number) {
    super(`faixa ${rowId} nao encontrada`);
    this.name = 'OperatingHoursNotFoundError';
  }
}

/**
 * A faixa cruza outra do MESMO dia da semana.
 *
 * Vira 409, e nao 422: o corpo esta correto — o que conflita e o ESTADO. A tela
 * usa a distincao para dizer QUAL faixa atrapalha, em vez de acusar de invalido
 * um horario que o dono digitou certo.
 */
export class OperatingHoursOverlapError extends Error {
  constructor(public readonly conflict: { opens: string; closes: string }) {
    super(`faixa sobrepoe ${conflict.opens}-${conflict.closes}`);
    this.name = 'OperatingHoursOverlapError';
  }
}

export type OperatingHoursInput = {
  weekday: number;
  /** 'HH:MM' */
  opens: string;
  closes: string;
};

/**
 * Faixa do mesmo weekday que cruza [opens, closes), ignorando `exceptId`.
 *
 * A condicao de sobreposicao e `novoInicio < fimExistente AND novoFim >
 * inicioExistente`. Encostar NAO e sobrepor: 08:00-12:00 e 12:00-18:00 convivem,
 * e sao exatamente o caso de manha e tarde com intervalo — recusa-las
 * inviabilizaria o uso mais comum da tabela.
 *
 * Comparacao de string funciona porque `time` sai zero-padded do Postgres e
 * 'HH:MM' e lexicograficamente ordenado.
 */
async function findOverlap(
  input: OperatingHoursInput,
  exceptId?: number,
): Promise<{ opens: string; closes: string } | null> {
  const sameWeekday = await db
    .select({ id: operatingHours.id, opens: operatingHours.opens, closes: operatingHours.closes })
    .from(operatingHours)
    .where(
      and(
        eq(operatingHours.tenantId, getTenantId()),
        eq(operatingHours.weekday, input.weekday),
        ...(exceptId === undefined ? [] : [ne(operatingHours.id, exceptId)]),
      ),
    );

  for (const row of sameWeekday) {
    const opens = normalizeTime(row.opens);
    const closes = normalizeTime(row.closes);
    if (input.opens < closes && input.closes > opens) return { opens, closes };
  }

  return null;
}

/** @throws {OperatingHoursOverlapError} */
export async function createOperatingHours(
  input: OperatingHoursInput,
): Promise<OperatingHoursRow> {
  const conflict = await findOverlap(input);
  if (conflict) throw new OperatingHoursOverlapError(conflict);

  const [row] = await db
    .insert(operatingHours)
    .values({
      tenantId: getTenantId(),
      weekday: input.weekday,
      opens: input.opens,
      closes: input.closes,
    })
    .returning({
      id: operatingHours.id,
      weekday: operatingHours.weekday,
      opens: operatingHours.opens,
      closes: operatingHours.closes,
    });

  return { ...row, opens: normalizeTime(row.opens), closes: normalizeTime(row.closes) };
}

/**
 * Substitui a faixa inteira (PUT, nao PATCH): sao tres campos interdependentes,
 * e `closes > opens` e a sobreposicao so podem ser julgadas com os tres juntos.
 *
 * @throws {OperatingHoursNotFoundError} inexistente ou de outro tenant.
 * @throws {OperatingHoursOverlapError}
 */
export async function updateOperatingHours(
  rowId: number,
  input: OperatingHoursInput,
): Promise<OperatingHoursRow> {
  // `exceptId` e o que permite salvar a propria faixa sem mudanca: sem ele, ela
  // sobreporia a si mesma e toda edicao responderia 409.
  const conflict = await findOverlap(input, rowId);
  if (conflict) throw new OperatingHoursOverlapError(conflict);

  const [row] = await db
    .update(operatingHours)
    .set({ weekday: input.weekday, opens: input.opens, closes: input.closes })
    .where(and(eq(operatingHours.id, rowId), eq(operatingHours.tenantId, getTenantId())))
    .returning({
      id: operatingHours.id,
      weekday: operatingHours.weekday,
      opens: operatingHours.opens,
      closes: operatingHours.closes,
    });

  if (!row) throw new OperatingHoursNotFoundError(rowId);
  return { ...row, opens: normalizeTime(row.opens), closes: normalizeTime(row.closes) };
}

/**
 * Apaga a faixa. O dia da semana passa a nao operar se era a ultima.
 *
 * NAO cancela reserva ja vendida naquele horario — ver o cabecalho do arquivo.
 *
 * @throws {OperatingHoursNotFoundError} inexistente ou de outro tenant.
 */
export async function deleteOperatingHours(rowId: number): Promise<void> {
  const [row] = await db
    .delete(operatingHours)
    .where(and(eq(operatingHours.id, rowId), eq(operatingHours.tenantId, getTenantId())))
    .returning({ id: operatingHours.id });

  if (!row) throw new OperatingHoursNotFoundError(rowId);
}
