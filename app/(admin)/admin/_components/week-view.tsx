// View de SEMANA — 7 colunas de dia (CLAUDE.md secao 11.1).
//
// AQUI O EIXO DE RECURSO COLAPSA. Sete dias x N recursos nao cabe numa tela de
// celular, que e onde esta tela e usada (secao 11.1: "usada no celular, em
// campo"). O recurso vira uma etiqueta abreviada dentro do card — a informacao
// continua na tela, deixa de ser eixo. Quem precisa do eixo de recurso abre o
// dia. A grade tempo x recurso propriamente dita e a view de DIA.

import type { CalendarReservationDetail } from '@/lib/calendar';
import {
  STATUS_BLOCK,
  STATUS_LABEL,
  abbreviateResource,
  dayNumber,
  groupByDate,
  timeLabel,
  weekdayShortLabel,
} from './shared';

type Props = {
  dates: string[];
  reservations: CalendarReservationDetail[];
  today: string;
  buildHref: (date: string) => string;
  /** Abre o painel de detalhes. Recebe o ID DA RESERVA — ver a nota em DayView. */
  onSelect: (reservationId: string) => void;
};

export function WeekView({ dates, reservations, today, buildHref, onSelect }: Props) {
  const byDate = groupByDate(reservations, dates);

  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-lg border">
      <div className="grid min-w-max" style={{ gridTemplateColumns: 'repeat(7, minmax(9rem, 1fr))' }}>
        {dates.map((date) => {
          const isToday = date === today;

          return (
            <div key={date} className="flex min-h-64 flex-col border-r last:border-r-0">
              {/* O cabecalho leva ao dia: e o caminho natural de "vi algo na
                  semana, quero ver em qual recurso esta". */}
              <a
                href={buildHref(date)}
                className={`border-b px-2 py-1.5 text-center text-xs transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  isToday ? 'bg-sky-50 font-semibold dark:bg-sky-950/50' : 'bg-neutral-50 dark:bg-neutral-900'
                }`}
              >
                <span className="block capitalize text-neutral-500">{weekdayShortLabel(date)}</span>
                <span
                  className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full tabular-nums ${
                    isToday ? 'bg-sky-600 text-white' : ''
                  }`}
                >
                  {dayNumber(date)}
                </span>
              </a>

              <div className="flex flex-1 flex-col gap-1 p-1">
                {(byDate.get(date) ?? []).map((reservation) => (
                  <button
                    key={reservation.id}
                    type="button"
                    // Mesmo ponto de entrada da view de dia, mesmo argumento: o
                    // id da RESERVA. Aqui a reserva ja e um card so, mesmo
                    // ocupando varios recursos.
                    onClick={() => onSelect(reservation.id)}
                    aria-label={`Ver reserva de ${timeLabel(reservation.startAt)}, ${reservation.experience.name}, ${reservation.customerName}`}
                    className={`rounded border-l-4 px-1.5 py-1 text-left transition hover:brightness-95 focus:outline-none focus-visible:ring-2 ${STATUS_BLOCK[reservation.status]}`}
                  >
                    <span className="flex items-baseline justify-between gap-1">
                      <span className="text-[11px] font-semibold tabular-nums">
                        {timeLabel(reservation.startAt)}
                      </span>
                      {/* Recurso abreviado, derivado do nome cadastrado. */}
                      <span className="shrink-0 rounded bg-black/10 px-1 text-[10px] font-medium tabular-nums dark:bg-white/15">
                        {reservation.resources.map((r) => abbreviateResource(r.name)).join(' ')}
                      </span>
                    </span>
                    <span className="block truncate text-xs font-medium">
                      {reservation.customerName}
                    </span>
                    <span className="block truncate text-[11px] opacity-80">
                      {reservation.experience.name}
                    </span>
                    <span className="block truncate text-[10px] uppercase tracking-wide opacity-70">
                      {STATUS_LABEL[reservation.status]}
                    </span>
                  </button>
                ))}

                {(byDate.get(date) ?? []).length === 0 && (
                  <span className="px-1 py-2 text-[11px] text-neutral-400">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
