// Pecas compartilhadas pelas tres views do calendario (CLAUDE.md secao 11.1).
//
// Pasta `_components`: o underscore a torna privada no App Router — nao vira
// rota, mesmo morando dentro de /admin.

import type { CalendarReservationSummary, CalendarStatus } from '@/lib/calendar';
import { localToUtc, utcToLocalLabel } from '@/lib/time';

/**
 * Granularidade de posicionamento da view de dia, em minutos.
 *
 * NAO e a granularidade da grade de venda (SLOT_GRANULARITY_MINUTES = 30, em
 * lib/availability.ts). Sao coisas diferentes: aquela decide quais horarios
 * existem para vender, esta decide a resolucao com que um bloco e DESENHADO. Com
 * buffer de 15 min, 30 min de resolucao nao conseguiria mostrar o buffer.
 */
export const ROW_MINUTES = 15;

/**
 * Minutos desde a meia-noite LOCAL da data de referencia.
 *
 * Pode passar de 1440 de proposito: um passeio que comeca 23:30 tem o fim do
 * buffer no dia seguinte, e travar em 1440 desenharia o bloco de tras para
 * frente. Calculado contra o instante da meia-noite, nunca por
 * `getHours()` — o dono pode abrir a tela com o aparelho em outro fuso, e a
 * agenda e sempre de Sao Paulo (secao 3).
 */
export function minutesFromMidnight(iso: string, date: string): number {
  return Math.round((new Date(iso).getTime() - localToUtc(date, '00:00').getTime()) / 60_000);
}

/** 'HH:mm' em Sao Paulo, independente do fuso do aparelho. */
export function timeLabel(iso: string): string {
  return utcToLocalLabel(new Date(iso));
}

/** 'HH:mm' a partir de minutos desde a meia-noite (aceita passar de 24h). */
export function minutesLabel(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Abreviacao de recurso para a view de semana, onde nao cabe o nome inteiro.
 *
 * DERIVADA do nome cadastrado, nunca hardcoded: o tenant chama o recurso de
 * "Quadriciclo 1" hoje, e o proximo pode chamar de "Buggy 3" ou "Caiaque Azul".
 * Regra: inicial + numero final ("Quadriciclo 1" -> "Q1"); sem numero, as duas
 * primeiras letras ("Caiaque Azul" -> "CA").
 */
export function abbreviateResource(name: string): string {
  const trimmed = name.trim();
  const initial = trimmed.match(/\p{L}/u)?.[0]?.toUpperCase();
  if (!initial) return '?';
  const trailingNumber = trimmed.match(/(\d+)\s*$/)?.[1];
  return trailingNumber ? `${initial}${trailingNumber}` : trimmed.slice(0, 2).toUpperCase();
}

// -- cores por status --------------------------------------------------------
//
// Hoje a cor sai do STATUS da reserva (confirmada x aguardando pagamento). O
// marcador de saldo em aberto da secao 11.1 le `paymentState` e entra junto com
// a Fase 2, quando esse campo deixa de ser 'pending' em toda reserva.

export const STATUS_LABEL: Record<CalendarStatus, string> = {
  confirmed: 'Pago',
  pending_payment: 'Aguardando',
};

/** Bloco preenchido (views de dia e semana). */
export const STATUS_BLOCK: Record<CalendarStatus, string> = {
  confirmed:
    'border-emerald-600/70 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-50',
  pending_payment:
    'border-amber-600/70 bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:text-amber-50',
};

/** Bolinha (view de mes, onde nao ha espaco para o bloco inteiro). */
export const STATUS_DOT: Record<CalendarStatus, string> = {
  confirmed: 'bg-emerald-600',
  pending_payment: 'bg-amber-500',
};

// -- rotulos de data em portugues -------------------------------------------
//
// Intl nativo em vez de locale de biblioteca: zero dependencia nova e zero
// bundle extra. `timeZone: 'UTC'` e obrigatorio — as datas aqui sao datas de
// CALENDARIO ancoradas em UTC (lib/calendar.ts), e deixar o Intl usar o fuso do
// aparelho mostraria o dia anterior para quem estiver a oeste.

const WEEKDAY_SHORT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const FULL = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 'seg.' */
export const weekdayShortLabel = (date: string) =>
  WEEKDAY_SHORT.format(asUtc(date)).replace('.', '');
/** '05 de ago.' */
export const dayMonthLabel = (date: string) => DAY_MONTH.format(asUtc(date));
/** 'Quarta-feira, 05 de agosto de 2026' */
export const fullDateLabel = (date: string) => capitalize(FULL.format(asUtc(date)));
/** 'Agosto de 2026' */
export const monthYearLabel = (date: string) => capitalize(MONTH_YEAR.format(asUtc(date)));
/** Numero do dia, sem zero a esquerda. */
export const dayNumber = (date: string) => String(asUtc(date).getUTCDate());

/** Agrupa reservas por data de calendario de Sao Paulo, para as views de semana e mes. */
export function groupByDate<T extends CalendarReservationSummary>(
  reservations: T[],
  dates: string[],
): Map<string, T[]> {
  const byDate = new Map<string, T[]>(dates.map((d) => [d, []]));

  for (const reservation of reservations) {
    // A data vem do rotulo local, nao de `startAt.slice(0,10)`: as 22:00 de Sao
    // Paulo ja sao o dia seguinte em UTC, e a reserva apareceria um dia adiante.
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(reservation.startAt));

    byDate.get(date)?.push(reservation);
  }

  return byDate;
}
