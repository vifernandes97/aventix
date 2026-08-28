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
// ============================================================================
// >>> A COR E O ROTULO SAEM DE status + paymentState, NUNCA SO DE status <<<
//
// Ate a Fase B este mapa era `Record<CalendarStatus, ...>` com
// `confirmed: 'Pago'`. Isso passou a ser uma AFIRMACAO FALSA no instante em que
// o sinal virou vendavel: uma reserva com metade paga e `confirmed`, e o bloco
// diria "Pago", em verde, na tela que o guia bate o olho antes do passeio sem
// abrir reserva nenhuma. Ele leva a pessoa e ninguem cobra o que falta.
//
// Nao e falta de informacao — a informacao estava ERRADA. Por isso a correcao e
// no rotulo, e nao um detalhe a mais no painel: o painel ninguem abre em massa.
//
// O estado de EXIBICAO tem tres valores, e nao dois. Ver `displayState`.
// ============================================================================

/**
 * O que o bloco COMUNICA — derivado, nunca lido cru do banco.
 *
 * 'partial' nao existe em `reservation_status`: e a combinacao confirmed +
 * saldo em aberto, que a secao 4-B.3 criou e a maquina de estados da secao 5
 * nao previa.
 */
export type CalendarDisplayState = 'pending_payment' | 'partial' | 'paid';

/**
 * >>> FAIL-SAFE: qualquer coisa que nao esteja QUITADA conta como devendo. <<<
 * Uma reserva paga marcada como "saldo" e um incomodo de dez segundos; uma
 * reserva devendo marcada como "Pago" e o passeio saindo sem cobrar. As duas
 * falhas nao custam a mesma coisa, entao o default nao e simetrico.
 */
export function displayState(reservation: {
  status: CalendarStatus;
  paymentState: 'pending' | 'partial' | 'settled';
}): CalendarDisplayState {
  if (reservation.status === 'pending_payment') return 'pending_payment';
  return reservation.paymentState === 'settled' ? 'paid' : 'partial';
}

export const STATUS_LABEL: Record<CalendarDisplayState, string> = {
  paid: 'Pago',
  partial: 'Saldo em aberto',
  pending_payment: 'Aguardando',
};

/**
 * Rotulo COM O VALOR quando ha espaco (dia e semana) — "Saldo R$ 162,74".
 *
 * A secao 11.1 pede o valor no marcador, e ele muda a natureza do aviso: "saldo
 * em aberto" o guia pode ler como pendencia burocratica; um numero em reais e
 * o que ele vai cobrar antes de a pessoa subir no quadriciclo.
 */
export function blockStatusLabel(reservation: {
  status: CalendarStatus;
  paymentState: 'pending' | 'partial' | 'settled';
  totalPriceCents: number;
  amountPaidCents: number;
}): string {
  const state = displayState(reservation);
  if (state !== 'partial') return STATUS_LABEL[state];

  const saldo = Math.max(0, reservation.totalPriceCents - reservation.amountPaidCents);
  return `Saldo ${moneyLabel(saldo)}`;
}

/**
 * Bloco preenchido (views de dia e semana).
 *
 * 'partial' NAO reusa o verde de 'paid': a distincao precisa sobreviver a uma
 * olhada rapida, e a cor e o que o olho pega antes do texto. Tambem nao reusa o
 * ambar de 'pending_payment', que significa outra coisa (ninguem pagou, a vaga
 * ainda pode cair). Laranja e um terceiro sinal para um terceiro estado.
 */
export const STATUS_BLOCK: Record<CalendarDisplayState, string> = {
  paid: 'border-emerald-600/70 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-50',
  partial:
    'border-orange-600/80 bg-orange-50 text-orange-950 dark:bg-orange-950/60 dark:text-orange-50',
  pending_payment:
    'border-amber-600/70 bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:text-amber-50',
};

/** Bolinha (view de mes, onde nao ha espaco para o bloco inteiro). */
export const STATUS_DOT: Record<CalendarDisplayState, string> = {
  paid: 'bg-emerald-600',
  partial: 'bg-orange-500',
  pending_payment: 'bg-amber-500',
};

/**
 * Status COMPLETO, para o painel de detalhes — que abre tambem em reserva
 * cancelada ou expirada, ao contrario da grade (secao 11.1), que so desenha as
 * ativas. Separado de STATUS_LABEL de proposito: aquele mapeia so os dois
 * status que a grade conhece, e o compilador garante que continue assim.
 */
export const DETAIL_STATUS_LABEL: Record<
  'pending_payment' | 'confirmed' | 'cancelled' | 'expired',
  string
> = {
  confirmed: 'Confirmada',
  pending_payment: 'Aguardando pagamento',
  cancelled: 'Cancelada',
  expired: 'Expirada',
};

export const DETAIL_STATUS_BADGE: Record<keyof typeof DETAIL_STATUS_LABEL, string> = {
  confirmed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  pending_payment: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  cancelled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  expired: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

// -- dinheiro ----------------------------------------------------------------

/**
 * Centavos (inteiro, secao 3) -> 'R$ 349,00'.
 *
 * A divisao por 100 acontece SO AQUI, na borda de exibicao. Todo o resto do
 * sistema trafega inteiro; um float subindo de volta para calculo seria a porta
 * de entrada do centavo perdido.
 */
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moneyLabel = (cents: number) => MONEY.format(cents / 100);

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

/**
 * Data de CALENDARIO de Sao Paulo de um instante ISO ('YYYY-MM-DD').
 *
 * Nunca `iso.slice(0, 10)`: as 22:00 de Sao Paulo ja sao o dia seguinte em UTC,
 * e a reserva apareceria um dia adiante. 'en-CA' porque e o locale cujo formato
 * numerico ja e ISO.
 */
const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
export const localDateOf = (iso: string) => LOCAL_DATE.format(new Date(iso));

/** 'Quarta-feira, 05 de agosto de 2026' a partir de um INSTANTE. */
export const fullDateLabelOf = (iso: string) => fullDateLabel(localDateOf(iso));

/** '05/08/2026 09:00' — usado nos carimbos (criada em, cancelada em). */
export function stampLabel(iso: string): string {
  const [y, m, d] = localDateOf(iso).split('-');
  return `${d}/${m}/${y} ${timeLabel(iso)}`;
}

/** Agrupa reservas por data de calendario de Sao Paulo, para as views de semana e mes. */
export function groupByDate<T extends CalendarReservationSummary>(
  reservations: T[],
  dates: string[],
): Map<string, T[]> {
  const byDate = new Map<string, T[]>(dates.map((d) => [d, []]));

  for (const reservation of reservations) {
    // A data vem do rotulo local, nao de `startAt.slice(0,10)` — ver localDateOf.
    byDate.get(localDateOf(reservation.startAt))?.push(reservation);
  }

  return byDate;
}
