// Aventix — motor de disponibilidade (CLAUDE.md secao 6).
//
// REGRA INEGOCIAVEL: toda logica de SOBREPOSICAO de periodo vive no SQL, no
// operador `&&` sobre tstzrange. Nunca reimplemente comparacao de intervalos
// em JavaScript.
//
// Por que: tstzrange usa limites [) — inicio incluido, fim excluido. Uma reserva
// que termina 11:45 NAO conflita com uma que comeca 11:45. Se o motor recalcular
// isso em JS e usar <= onde deveria ser <, ele DIVERGE da exclusion constraint:
// ou horarios vendaveis somem da grade, ou o cliente escolhe um slot que a grade
// mostrou e o POST responde 409. Motor, recheck transacional e constraint tem que
// concordar SEMPRE, e a unica forma de garantir isso e usar o mesmo operador do
// Postgres. Em JS fica so a matematica de calendario (candidatos de 30 em 30,
// duracao, lead time) — que nao envolve sobreposicao.

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from './db/client';
import { experiences, operatingHours, resources, scheduleExceptions } from './db/schema';
import type { Transaction } from './reservations';
import { getBooleanSetting, getNumberSetting, getTenantId } from './tenant';
import {
  isValidCalendarDate,
  localToUtc,
  minutesToTime,
  timeToMinutes,
  utcToLocalLabel,
  weekdayOf,
} from './time';

/** Granularidade da grade (secao 6). Constante de codigo, nao setting. */
export const SLOT_GRANULARITY_MINUTES = 30;

export type AvailabilitySlot = {
  /** instante UTC em ISO — o que vai para o POST /api/reservations */
  startAt: string;
  /** 'HH:mm' em America/Sao_Paulo — o que o cliente ve */
  label: string;
};

/**
 * `dayState` distingue tres situacoes que colapsariam numa lista vazia
 * indistinguivel e produziriam a mensagem errada na tela (secao 7.1).
 */
export type DayState = 'open' | 'closed_exception' | 'closed_weekday';

export type AvailabilityResult = {
  slots: AvailabilitySlot[];
  dayState: DayState;
};

export type GetAvailabilityParams = {
  experienceId: number;
  /** 'YYYY-MM-DD' em America/Sao_Paulo */
  date: string;
  resourcesNeeded: number;
};

// -- erros -------------------------------------------------------------------

export class InvalidDateError extends Error {
  readonly date: string;

  constructor(date: string) {
    super(`Data invalida: ${JSON.stringify(date)}. Esperado 'YYYY-MM-DD' de calendario valido.`);
    this.name = 'InvalidDateError';
    this.date = date;
  }
}

export class ExperienceNotFoundError extends Error {
  readonly experienceId: number;

  constructor(experienceId: number, tenantId: number) {
    super(`Experiencia ${experienceId} nao encontrada ou inativa no tenant ${tenantId}.`);
    this.name = 'ExperienceNotFoundError';
    this.experienceId = experienceId;
  }
}

export class InvalidResourcesNeededError extends Error {
  readonly resourcesNeeded: number;
  readonly activeResources: number;

  constructor(resourcesNeeded: number, activeResources: number) {
    super(
      `resourcesNeeded invalido: ${resourcesNeeded}. ` +
        `Esperado entre 1 e ${activeResources} (recursos ativos do tenant).`,
    );
    this.name = 'InvalidResourcesNeededError';
    this.resourcesNeeded = resourcesNeeded;
    this.activeResources = activeResources;
  }
}

// -- executor ----------------------------------------------------------------

/**
 * A disponibilidade e somente leitura, entao sem `tx` ela roda direto na
 * conexao — nao ha o que tornar atomico. Com `tx`, roda DENTRO da transacao de
 * quem chamou: e assim que a criacao da reserva (secao 6, passo 4) reexecuta a
 * checagem enxergando o proprio advisory lock e as proprias escritas.
 */
type Executor = Transaction | typeof db;

// -- motor -------------------------------------------------------------------

type OpenRange = { opens: string; closes: string };

export async function getAvailability(
  params: GetAvailabilityParams,
  tx?: Transaction,
): Promise<AvailabilityResult> {
  const { experienceId, date, resourcesNeeded } = params;
  const executor: Executor = tx ?? db;
  const tenantId = getTenantId();

  // -- validacoes ------------------------------------------------------------

  if (!isValidCalendarDate(date)) throw new InvalidDateError(date);

  const [experience] = await executor
    .select({
      id: experiences.id,
      durationMinutes: experiences.durationMinutes,
      bufferMinutes: experiences.bufferMinutes,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.id, experienceId),
        eq(experiences.tenantId, tenantId),
        eq(experiences.active, true),
      ),
    );

  if (!experience) throw new ExperienceNotFoundError(experienceId, tenantId);

  // Teto de resourcesNeeded e validacao de APP, nao CHECK (secao 4.6).
  const [{ activeResources }] = await executor
    .select({ activeResources: sql<number>`count(*)::int` })
    .from(resources)
    .where(and(eq(resources.tenantId, tenantId), eq(resources.active, true)));

  if (
    !Number.isInteger(resourcesNeeded) ||
    resourcesNeeded < 1 ||
    resourcesNeeded > activeResources
  ) {
    throw new InvalidResourcesNeededError(resourcesNeeded, activeResources);
  }

  // -- PASSO 1: grade do dia -------------------------------------------------
  // schedule_exceptions TEM PRECEDENCIA sobre operating_hours (secao 6).

  const [exception] = await executor
    .select({
      closed: scheduleExceptions.closed,
      opens: scheduleExceptions.opens,
      closes: scheduleExceptions.closes,
    })
    .from(scheduleExceptions)
    .where(and(eq(scheduleExceptions.tenantId, tenantId), eq(scheduleExceptions.date, date)));

  let ranges: OpenRange[];

  if (exception) {
    // Recesso / feriado fechado: encerra aqui, sem olhar operating_hours.
    if (exception.closed) return { slots: [], dayState: 'closed_exception' };

    // Excecao aberta IGNORA o weekday — e o que permite abrir numa terca em que
    // o tenant normalmente nao opera (o caso de uso que motivou a tabela).
    // O CHECK da tabela garante opens/closes preenchidos quando closed=false.
    ranges = [{ opens: exception.opens!, closes: exception.closes! }];
  } else {
    // Pode haver MAIS DE UMA faixa por dia (ex.: 08:00-12:00 e 14:00-18:00).
    // ORDER BY explicito: sem ele o Postgres nao garante ordem das linhas, e a
    // query final ordena pela POSICAO no array de candidatos — ou seja,
    // preservaria a desordem, e o cliente veria a grade indo 14:00..18:00 e
    // depois voltando para 08:00.
    ranges = await executor
      .select({ opens: operatingHours.opens, closes: operatingHours.closes })
      .from(operatingHours)
      .where(
        and(
          eq(operatingHours.tenantId, tenantId),
          eq(operatingHours.weekday, weekdayOf(date)),
        ),
      )
      .orderBy(operatingHours.opens);

    if (ranges.length === 0) return { slots: [], dayState: 'closed_weekday' };
  }

  // A partir daqui o dia OPERA. Lista vazia de slots significa "sem horario
  // livre", nunca "fechado" — por isso dayState fica 'open' ate o fim.

  // -- candidatos (matematica de calendario, sem sobreposicao) ---------------

  const minLeadMinutes = await getNumberSetting('min_lead_minutes');
  const notBefore = new Date(Date.now() + minLeadMinutes * 60_000);

  const rawCandidates: Date[] = [];

  for (const range of ranges) {
    const opensAt = timeToMinutes(range.opens);
    const closesAt = timeToMinutes(range.closes);

    for (let t = opensAt; t + experience.durationMinutes <= closesAt; t += SLOT_GRANULARITY_MINUTES) {
      // Descarta T + duration > closes. Duracao, NAO duracao + buffer: o buffer
      // e tempo de limpeza e pode extrapolar o fechamento; o passeio, nao.
      const startAt = localToUtc(date, minutesToTime(t));

      // Antecedencia minima configuravel (secao 6). Sem constante hardcoded.
      if (startAt.getTime() < notBefore.getTime()) continue;

      rawCandidates.push(startAt);
    }
  }

  // Deduplica por instante e ordena cronologicamente.
  //
  // O schema nao impede faixas SOBREPOSTAS no mesmo weekday (ex.: 08:00-12:00 e
  // 10:00-14:00), e nesse caso o mesmo horario sairia duas vezes na grade —
  // mostrar "10:00" duplicado nunca e o resultado desejado. A ordenacao tambem
  // protege contra faixas cadastradas fora de ordem.
  //
  // Isto e defesa em profundidade, nao a correcao de origem: o certo e o CRUD de
  // horarios (Fase 3) recusar faixas sobrepostas no cadastro. Enquanto ele nao
  // existir, dado ruim em operating_hours nao vira grade ruim.
  const candidates = [...new Map(rawCandidates.map((c) => [c.getTime(), c])).values()].sort(
    (a, b) => a.getTime() - b.getTime(),
  );

  if (candidates.length === 0) return { slots: [], dayState: 'open' };

  // -- PASSOS 2 e 2b: disponibilidade, TUDO EM SQL ---------------------------

  const totalMinutes = experience.durationMinutes + experience.bufferMinutes;
  const singleExperiencePerSlot = await getBooleanSetting('single_experience_per_slot');
  const candidateIsos = candidates.map((c) => c.toISOString());

  // Uma unica ida ao banco resolve o dia inteiro: os candidatos entram como
  // array e sao cruzados com resources. Nada de uma query por candidato.
  //
  // WITH ORDINALITY + retorno do indice (em vez do timestamp): o driver entrega
  // timestamptz como TEXTO, e reparsear esse texto em Date so introduziria uma
  // chance de divergir do instante que o JS ja calculou. O SQL decide QUAIS
  // candidatos passam; os instantes continuam sendo os do array original.
  const rows = await executor.execute<{ idx: string }>(sql`
    WITH candidates AS (
      SELECT idx, start_at
      FROM unnest(${sql.param(candidateIsos)}::timestamptz[])
        WITH ORDINALITY AS c(start_at, idx)
    ),
    periods AS (
      SELECT
        idx,
        tstzrange(start_at, start_at + make_interval(mins => ${totalMinutes})) AS period
      FROM candidates
    )
    SELECT p.idx
    FROM periods p
    WHERE
      -- PASSO 2: recursos ativos livres no periodo >= resourcesNeeded
      (
        SELECT count(*)
        FROM resources r
        WHERE r.tenant_id = ${tenantId}
          AND r.active
          AND NOT EXISTS (
            SELECT 1
            FROM reservation_resources rr
            WHERE rr.resource_id = r.id
              AND rr.status IN ('pending_payment', 'confirmed')
              AND rr.period && p.period
          )
          AND NOT EXISTS (
            SELECT 1
            FROM blackouts bl
            WHERE bl.tenant_id = ${tenantId}
              AND (bl.resource_id = r.id OR bl.resource_id IS NULL)
              AND bl.period && p.period
          )
      ) >= ${resourcesNeeded}
      -- PASSO 2b: exclusividade de experiencia, so se o tenant tiver o flag.
      -- Reserva ativa de experiencia DIFERENTE sobreposta bloqueia; a MESMA
      -- experiencia nao bloqueia aqui (segue governada pelo passo 2).
      AND (
        ${singleExperiencePerSlot} = false
        OR NOT EXISTS (
          SELECT 1
          FROM reservation_resources rr2
          JOIN reservations res ON res.id = rr2.reservation_id
          WHERE res.tenant_id = ${tenantId}
            AND res.experience_id <> ${experienceId}
            AND rr2.status IN ('pending_payment', 'confirmed')
            AND rr2.period && p.period
        )
      )
    ORDER BY p.idx
  `);

  const slots = rows.rows.map((row) => {
    const instant = candidates[Number(row.idx) - 1]; // ORDINALITY e 1-based
    return { startAt: instant.toISOString(), label: utcToLocalLabel(instant) };
  });

  return { slots, dayState: 'open' };
}
