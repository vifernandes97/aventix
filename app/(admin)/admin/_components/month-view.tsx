// View de MES — grade de semanas completas (CLAUDE.md secao 11.1).
//
// Resumo apenas: horario + trilha + cor de status. Sem nome de cliente e sem
// recurso, que e a granularidade que a secao 11.1 define para o mes — e tambem
// o unico jeito de caber 30 dias numa tela.

import type { CalendarReservationSummary } from '@/lib/calendar';
import { STATUS_DOT, STATUS_LABEL, dayNumber, displayState, groupByDate, timeLabel } from './shared';

type Props = {
  dates: string[];
  /** Mes em foco ('YYYY-MM'): os dias de emenda das outras semanas saem esmaecidos. */
  month: string;
  reservations: CalendarReservationSummary[];
  today: string;
  buildHref: (date: string) => string;
};

/** Quantas reservas cabem num dia antes de virar "+N". */
const MAX_VISIBLE = 3;

const WEEKDAY_HEADERS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function MonthView({ dates, month, reservations, today, buildHref }: Props) {
  const byDate = groupByDate(reservations, dates);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7">
        {WEEKDAY_HEADERS.map((label) => (
          <div
            key={label}
            className="border-b border-r bg-neutral-50 px-1 py-1.5 text-center text-[11px] font-medium text-neutral-500 last:border-r-0 dark:bg-neutral-900"
          >
            {label}
          </div>
        ))}

        {dates.map((date) => {
          const items = byDate.get(date) ?? [];
          const isToday = date === today;
          const isOtherMonth = !date.startsWith(month);

          return (
            <a
              key={date}
              href={buildHref(date)}
              className={`flex min-h-24 flex-col gap-0.5 border-b border-r p-1 transition last:border-r-0 hover:bg-neutral-50 dark:hover:bg-neutral-900 ${
                isOtherMonth ? 'bg-neutral-50/60 text-neutral-400 dark:bg-neutral-950/60' : ''
              }`}
            >
              <span
                className={`mb-0.5 flex h-5 w-5 items-center justify-center self-start rounded-full text-[11px] tabular-nums ${
                  isToday ? 'bg-sky-600 font-semibold text-white' : ''
                }`}
              >
                {dayNumber(date)}
              </span>

              {items.slice(0, MAX_VISIBLE).map((reservation) => (
                <span
                  key={reservation.id}
                  className="flex items-center gap-1 truncate text-[11px]"
                  title={`${timeLabel(reservation.startAt)} ${reservation.experience.name} — ${STATUS_LABEL[displayState(reservation)]}`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[displayState(reservation)]}`}
                  />
                  <span className="shrink-0 font-medium tabular-nums">
                    {timeLabel(reservation.startAt)}
                  </span>
                  <span className="truncate opacity-80">{reservation.experience.name}</span>
                </span>
              ))}

              {items.length > MAX_VISIBLE && (
                <span className="text-[11px] font-medium text-neutral-500">
                  +{items.length - MAX_VISIBLE}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
