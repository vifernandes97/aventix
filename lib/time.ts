// Aventix — helpers de timezone (CLAUDE.md secoes 3 e 14).
//
// Regra da secao 3: `America/Sao_Paulo` nas BORDAS, UTC no banco. As colunas
// `time` de operating_hours/schedule_exceptions e o parametro `date` da
// disponibilidade sao horario LOCAL sem fuso; `timestamptz` no banco e o
// instante em UTC. Toda a conversao entre os dois mundos passa por aqui.
//
// NUNCA subtraia 3 horas na mao. O Brasil nao tem horario de verao hoje, mas
// hardcodar o offset transforma uma eventual volta do DST — ou o primeiro
// tenant fora de SP — num erro silencioso de uma hora em TODOS os agendamentos.
// Usamos a base IANA (date-fns-tz), que sabe as regras historicas e futuras.

import { format as formatTz, fromZonedTime, toZonedTime } from 'date-fns-tz';

/** Timezone do produto. Fixo no MVP (secao 3); vira setting quando houver tenant fora de SP. */
export const TIMEZONE = 'America/Sao_Paulo';

/** 'YYYY-MM-DD' */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida uma data de calendario 'YYYY-MM-DD'. Rejeita formato errado E datas
 * inexistentes (ex.: '2026-02-30', que o Date aceitaria virando 02/03).
 */
export function isValidCalendarDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // round-trip: se o Date "corrigiu" o dia, a data nao existia
  return parsed.toISOString().slice(0, 10) === date;
}

/**
 * Dia da semana de uma data de calendario: 0=domingo .. 6=sabado, na convencao
 * de `operating_hours.weekday` (secao 4.3).
 *
 * Calculado em UTC de proposito: uma data de calendario ('2026-08-01') tem dia
 * da semana proprio, independente de fuso. Usar o relogio local do processo
 * aqui daria o dia errado quando o servidor roda em outro timezone.
 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * Converte data + hora LOCAIS de Sao Paulo no instante UTC correspondente.
 *
 * @param date 'YYYY-MM-DD'
 * @param time 'HH:mm' ou 'HH:mm:ss' (formato das colunas `time` do Postgres)
 */
export function localToUtc(date: string, time: string): Date {
  const withSeconds = time.length === 5 ? `${time}:00` : time;
  return fromZonedTime(`${date}T${withSeconds}`, TIMEZONE);
}

/**
 * Data de calendario ('YYYY-MM-DD') de um instante, em Sao Paulo.
 *
 * Inverso de localToUtc no nivel do dia. NAO use `instant.toISOString().slice(0,10)`
 * no lugar disto: as 23:50 de SP ja sao o dia SEGUINTE em UTC, entao aquela forma
 * daria a data errada por 3 horas todo fim de dia — em `due_date` de cobranca e na
 * data usada para recomputar a grade.
 */
export function utcToLocalDate(instant: Date): string {
  return formatTz(toZonedTime(instant, TIMEZONE), 'yyyy-MM-dd', { timeZone: TIMEZONE });
}

/** Data de calendario de HOJE em Sao Paulo. */
export function todayLocalDate(): string {
  return utcToLocalDate(new Date());
}

/**
 * Idade em anos COMPLETOS numa data de referencia. Ambas 'YYYY-MM-DD'.
 *
 * @returns `null` se qualquer uma das datas nao for data de calendario valida.
 *
 * >>> POR QUE ARITMETICA DE CALENDARIO PURA, SEM `Date` <<<
 * Idade nao tem fuso: e a diferenca entre duas datas de calendario. Quem
 * constroi `Date` para isso reintroduz a armadilha registrada em DECISOES.md
 * (17/08) — `new Date().toISOString()` e UTC, e depois das 21h em Sao Paulo ja
 * virou o dia seguinte, adiantando a data em um dia e recusando quem tem a
 * idade exata. Comparar (ano, mes, dia) como numeros nao tem essa borda.
 *
 * A DATA DE REFERENCIA e escolha de quem chama, e as duas regras do produto
 * divergem de proposito (ver `createReservation`): o condutor conta na data do
 * AGENDAMENTO, o garupa na data do PASSEIO.
 */
export function ageOnDate(birthdate: string, onDate: string): number | null {
  if (!isValidCalendarDate(birthdate) || !isValidCalendarDate(onDate)) return null;

  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ry, rm, rd] = onDate.split('-').map(Number);

  let age = ry - by;
  // Ainda nao fez aniversario ate a data de referencia: compara mes/dia direto.
  if (rm * 100 + rd < bm * 100 + bd) age -= 1;
  return age;
}

/** Rotulo 'HH:mm' em horario de Sao Paulo, para exibicao ao cliente. */
export function utcToLocalLabel(instant: Date): string {
  return formatTz(toZonedTime(instant, TIMEZONE), 'HH:mm', { timeZone: TIMEZONE });
}

/** Minutos desde 00:00 de um 'HH:mm[:ss]'. So aritmetica de relogio, sem fuso. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

/** Inverso de timeToMinutes: 570 -> '09:30'. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
