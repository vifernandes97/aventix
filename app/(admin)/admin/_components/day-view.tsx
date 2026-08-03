// View de DIA — eixo primario = RECURSO (CLAUDE.md secao 11.1).
//
// Uma coluna por recurso ativo, linhas de 15 min, bloco posicionado por
// grid-row/grid-column. Reserva multi-recurso atravessa as colunas.
//
// CSS GRID PURO, sem biblioteca de calendario (decisao de 28/07): o Aventix e
// uma grade tempo x recurso com reserva multi-recurso e buffer visivel, caso que
// as libs tratam como plugin secundario. Sobra layout + leitura de dados.

import type { CalendarReservationDetail, CalendarResourceRef, DayGrid } from '@/lib/calendar';
import {
  ROW_MINUTES,
  STATUS_BLOCK,
  STATUS_LABEL,
  minutesFromMidnight,
  minutesLabel,
  timeLabel,
} from './shared';

type Props = {
  date: string;
  reservations: CalendarReservationDetail[];
  resources: CalendarResourceRef[];
  dayGrid: DayGrid;
  resourceLabelPlural: string;
};

/** Agrupa indices de coluna em corridas contiguas: [0,1,3] -> [{start:0,len:2},{start:3,len:1}]. */
function contiguousRuns(indices: number[]): { start: number; len: number }[] {
  const sorted = [...indices].sort((a, b) => a - b);
  const runs: { start: number; len: number }[] = [];

  for (const index of sorted) {
    const last = runs.at(-1);
    if (last && index === last.start + last.len) last.len += 1;
    else runs.push({ start: index, len: 1 });
  }

  return runs;
}

export function DayView({ date, reservations, resources, dayGrid, resourceLabelPlural }: Props) {
  const columnOf = new Map(resources.map((r, i) => [r.id, i]));

  // -- eixo vertical ---------------------------------------------------------
  //
  // Comeca na grade de funcionamento, mas SE ESTENDE para caber qualquer reserva
  // fora dela. Uma reserva pode ter sido criada antes de o dono encurtar o
  // horario, ou o buffer pode passar do fechamento (secao 6: o buffer PODE
  // extrapolar o closes). Cortar o eixo no horario oficial esconderia da tela um
  // passeio que vai acontecer — o pior defeito possivel nesta tela.
  const marks = [
    ...dayGrid.ranges.flatMap((r) => [r.opensMinutes, r.closesMinutes]),
    ...reservations.flatMap((r) => [
      minutesFromMidnight(r.startAt, date),
      minutesFromMidnight(r.bufferEndAt, date),
    ]),
  ];

  if (marks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-neutral-500">
        {dayGrid.source === 'closed_exception'
          ? 'Fechado neste dia por exceção de agenda.'
          : 'O tenant não opera neste dia da semana.'}
      </p>
    );
  }

  // Arredonda para a meia hora cheia nas duas pontas, para o eixo comecar e
  // terminar num rotulo redondo.
  const axisStart = Math.floor(Math.min(...marks) / 30) * 30;
  const axisEnd = Math.ceil(Math.max(...marks) / 30) * 30;
  const rowCount = Math.max(1, (axisEnd - axisStart) / ROW_MINUTES);
  const rowOf = (minutes: number) => Math.round((minutes - axisStart) / ROW_MINUTES);

  // Rotulos de 30 em 30 min, na coluna do eixo.
  const halfHours = Array.from(
    { length: Math.floor((axisEnd - axisStart) / 30) + 1 },
    (_, i) => axisStart + i * 30,
  );

  // Reservas cujos recursos nao estao entre os ATIVOS (recurso desativado depois
  // de ja ter reserva). Nao tem coluna onde ser desenhada; some da grade e
  // aparece no rodape, em vez de sumir da tela.
  const orphans = reservations.filter((r) => !r.resources.some((res) => columnOf.has(res.id)));

  return (
    <>
      {/* Rolagem horizontal quando os recursos nao couberem (secao 11.1: nunca
          esconder recurso, nunca exigir configuracao do dono). */}
      <div className="overflow-x-auto overscroll-x-contain rounded-lg border">
        <div
          className="grid min-w-max"
          style={{
            gridTemplateColumns: `4.5rem repeat(${resources.length}, minmax(11rem, 1fr))`,
            gridTemplateRows: `2.5rem repeat(${rowCount}, 1.25rem)`,
          }}
        >
          {/* canto do eixo */}
          <div className="sticky top-0 z-30 border-b border-r bg-neutral-50 dark:bg-neutral-900" />

          {/* cabecalho: um recurso por coluna */}
          {resources.map((resource) => (
            <div
              key={resource.id}
              className="sticky top-0 z-30 flex items-center justify-center border-b border-r px-2 text-center text-xs font-medium bg-neutral-50 dark:bg-neutral-900"
            >
              {resource.name}
            </div>
          ))}

          {/* linhas de meia hora, atravessando todas as colunas */}
          {halfHours.slice(0, -1).map((minutes) => (
            <div
              key={`line-${minutes}`}
              aria-hidden
              className="border-t border-neutral-200 dark:border-neutral-800"
              style={{ gridColumn: '1 / -1', gridRow: `${2 + rowOf(minutes)} / span 2` }}
            />
          ))}

          {/* separadores verticais entre recursos */}
          {resources.map((resource, index) => (
            <div
              key={`col-${resource.id}`}
              aria-hidden
              className="border-r border-neutral-200 dark:border-neutral-800"
              style={{ gridColumn: 2 + index, gridRow: `2 / span ${rowCount}` }}
            />
          ))}

          {/* Rotulos de horario. O ultimo (o fechamento) fica de fora: cairia
              numa linha alem das declaradas, e o grid criaria uma faixa implicita
              so para ele. */}
          {halfHours.slice(0, -1).map((minutes) => (
            <div
              key={`label-${minutes}`}
              className="pr-2 text-right text-[11px] tabular-nums text-neutral-500"
              style={{ gridColumn: 1, gridRow: `${2 + rowOf(minutes)} / span 2` }}
            >
              {minutesLabel(minutes)}
            </div>
          ))}

          {/* blocos */}
          {reservations.flatMap((reservation) => {
            const startMinutes = minutesFromMidnight(reservation.startAt, date);
            const endMinutes = minutesFromMidnight(reservation.endAt, date);
            const bufferEndMinutes = minutesFromMidnight(reservation.bufferEndAt, date);

            const columns = reservation.resources
              .map((r) => columnOf.get(r.id))
              .filter((c): c is number => c !== undefined);

            // Corridas contiguas: se a reserva pegou os recursos 1 e 3 (com o 2
            // livre no meio), um unico bloco atravessando os tres MENTIRIA sobre
            // o recurso 2 estar ocupado. Um bloco por corrida.
            return contiguousRuns(columns).map((run) => {
              const rows = Math.max(1, rowOf(endMinutes) - rowOf(startMinutes));
              const bufferRows = rowOf(bufferEndMinutes) - rowOf(endMinutes);

              return (
                <div
                  key={`${reservation.id}-${run.start}`}
                  className="relative z-10 flex flex-col p-0.5"
                  style={{
                    gridColumn: `${2 + run.start} / span ${run.len}`,
                    gridRow: `${2 + rowOf(startMinutes)} / span ${rows + Math.max(0, bufferRows)}`,
                  }}
                >
                  {/*
                    TODO(proxima tarefa — painel de detalhes): este botao e o
                    ponto de entrada. O onClick abre o painel lateral com
                    participantes, documentos, saldo e a acao de cancelar. Por
                    ora e so foco/hover: a tarefa atual e LEITURA.
                  */}
                  <button
                    type="button"
                    aria-label={`${timeLabel(reservation.startAt)} ${reservation.experience.name}, ${reservation.customerName}`}
                    className={`flex-1 overflow-hidden rounded border-l-4 px-1.5 py-1 text-left transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${STATUS_BLOCK[reservation.status]}`}
                    style={{ minHeight: `${(rows * 1.25).toFixed(2)}rem` }}
                  >
                    <span className="block truncate text-[11px] font-semibold tabular-nums">
                      {timeLabel(reservation.startAt)}–{timeLabel(reservation.endAt)}
                    </span>
                    <span className="block truncate text-xs font-medium">
                      {reservation.customerName}
                    </span>
                    <span className="block truncate text-[11px] opacity-80">
                      {reservation.experience.name}
                    </span>
                    <span className="block truncate text-[10px] uppercase tracking-wide opacity-70">
                      {STATUS_LABEL[reservation.status]}
                      {run.len > 1 ? ` · ${run.len} ${resourceLabelPlural.toLowerCase()}` : ''}
                    </span>
                  </button>

                  {/* Buffer: faixa visual DISTINTA, hachurada, colada embaixo do
                      bloco. E tempo de limpeza — a vaga esta ocupada, mas nao ha
                      passeio acontecendo. Sem a distincao, o dono leria 105 min
                      de trilha onde ha 90. */}
                  {bufferRows > 0 && (
                    <div
                      className="rounded-b border border-t-0 border-dashed border-neutral-400/60 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(120,120,120,0.18)_3px,rgba(120,120,120,0.18)_6px)]"
                      style={{ height: `${(bufferRows * 1.25).toFixed(2)}rem` }}
                      title={`Buffer de ${reservation.bufferMinutes} min`}
                    />
                  )}
                </div>
              );
            });
          })}
        </div>
      </div>

      {orphans.length > 0 && (
        <p className="mt-3 rounded border border-amber-500/50 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {orphans.length} reserva(s) alocada(s) em {resourceLabelPlural.toLowerCase()} inativos, sem
          coluna na grade:{' '}
          {orphans.map((r) => `${timeLabel(r.startAt)} ${r.customerName}`).join(', ')}.
        </p>
      )}
    </>
  );
}
