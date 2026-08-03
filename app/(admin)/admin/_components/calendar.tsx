'use client';

// Casca do calendario: navegacao, chips de filtro e troca de view (CLAUDE.md secao 11.1).
//
// POR QUE ESTE E O UNICO COMPONENTE DE CLIENTE: so o filtro por experiencia
// precisa de estado interativo. Navegacao e troca de view sao LINKS — mudam a
// URL, o servidor renderiza de novo. Isso mantem o periodo compartilhavel por
// link, o botao voltar do navegador funcionando e a tela util sem JavaScript.
//
// IMPORTA SO TIPOS de lib/calendar.ts (`import type`, apagado na compilacao):
// aquele modulo e server-only e um import de valor quebraria o build. Tudo que e
// calculo de periodo chega pronto, por prop, do Server Component.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CalendarReservationDetail, CalendarResourceRef, CalendarView, DayGrid } from '@/lib/calendar';
import { DayView } from './day-view';
import { MonthView } from './month-view';
import { ReservationPanel, type PanelLabels } from './reservation-panel';
import { STATUS_DOT, STATUS_LABEL } from './shared';
import { WeekView } from './week-view';

type Props = {
  view: CalendarView;
  date: string;
  today: string;
  /** Todas as datas do periodo, em ordem. */
  dates: string[];
  periodLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  viewHrefs: Record<CalendarView, string>;
  /** `date` de cada dia -> href da view de dia. Calculado no servidor. */
  dayHrefs: Record<string, string>;
  reservations: CalendarReservationDetail[];
  resources: CalendarResourceRef[];
  experiences: { id: number; name: string }[];
  /** Só na view de dia. */
  dayGrid: DayGrid | null;
  resourceLabelPlural: string;
  /** Rotulos do tenant para o painel (secao 3), resolvidos no servidor. */
  panelLabels: PanelLabels;
};

const VIEW_LABEL: Record<CalendarView, string> = {
  day: 'Dia',
  week: 'Semana',
  month: 'Mês',
};

export function Calendar(props: Props) {
  const { view, date, today, dates, reservations, experiences } = props;

  const router = useRouter();

  // Reserva aberta no painel. Guarda o ID, nao o objeto: o painel busca o
  // detalhe completo por conta propria, e um objeto guardado aqui ficaria velho
  // no instante em que o estado da reserva mudasse.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filtro por experiencia: TODAS marcadas por padrao. Um calendario que abre
  // escondendo reserva seria uma armadilha operacional.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(experiences.map((e) => e.id)),
  );

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // FILTRO NO FRONT, sobre o que ja veio (secao 11.1: uma query por render).
  // Refazer a consulta a cada chip seria ir ao banco para exibir um subconjunto
  // de dados que ja estao na memoria do navegador — e, no meio do toque, um
  // piscar de tela em campo, com conexao de celular.
  const visible = reservations.filter((r) => selected.has(r.experience.id));
  const hiddenCount = reservations.length - visible.length;

  return (
    <section className="flex flex-col gap-3">
      {/* -- navegacao -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <a
            href={props.prevHref}
            aria-label="Período anterior"
            className="flex h-9 w-9 items-center justify-center rounded-md border text-lg leading-none transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ‹
          </a>
          <a
            href={props.nextHref}
            aria-label="Próximo período"
            className="flex h-9 w-9 items-center justify-center rounded-md border text-lg leading-none transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ›
          </a>
          <a
            href={props.todayHref}
            className="ml-1 rounded-md border px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Hoje
          </a>
          <h2 className="ml-2 text-sm font-semibold sm:text-base">{props.periodLabel}</h2>
        </div>

        {/* troca de view */}
        <div className="flex rounded-md border p-0.5">
          {(Object.keys(VIEW_LABEL) as CalendarView[]).map((option) => (
            <a
              key={option}
              href={props.viewHrefs[option]}
              aria-current={option === view ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm transition ${
                option === view
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {VIEW_LABEL[option]}
            </a>
          ))}
        </div>
      </div>

      {/* -- filtro + legenda ------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {experiences.map((experience) => {
          const on = selected.has(experience.id);
          return (
            <button
              key={experience.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(experience.id)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                on
                  ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                  : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
              }`}
            >
              {experience.name}
            </button>
          );
        })}

        <span className="ml-auto flex items-center gap-3 text-[11px] text-neutral-500">
          {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((status) => (
            <span key={status} className="flex items-center gap-1">
              <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
              {STATUS_LABEL[status]}
            </span>
          ))}
        </span>
      </div>

      {/* Um chip desligado esconde reserva: dizer QUANTAS evita o dono concluir
          que o dia está vazio quando ele mesmo filtrou. */}
      {hiddenCount > 0 && (
        <p className="text-[11px] text-neutral-500">
          {hiddenCount} reserva(s) escondida(s) pelo filtro de experiência.
        </p>
      )}

      {/* -- a grade ---------------------------------------------------------- */}
      {view === 'day' && props.dayGrid && (
        <DayView
          date={date}
          reservations={visible}
          // Sem filtro: o eixo de horarios nao pode encolher quando um chip
          // desliga. Ver a nota em DayView.axisReservations.
          axisReservations={reservations}
          resources={props.resources}
          dayGrid={props.dayGrid}
          resourceLabelPlural={props.resourceLabelPlural}
          onSelect={setSelectedId}
        />
      )}

      {view === 'week' && (
        <WeekView
          dates={dates}
          reservations={visible}
          today={today}
          buildHref={(d) => props.dayHrefs[d]}
          onSelect={setSelectedId}
        />
      )}

      {view === 'month' && (
        <MonthView
          dates={dates}
          month={date.slice(0, 7)}
          reservations={visible}
          today={today}
          buildHref={(d) => props.dayHrefs[d]}
        />
      )}

      <p className="text-[11px] text-neutral-400">
        {visible.length} reserva(s) ativa(s) no período. Toque num bloco para ver o detalhe.
      </p>

      {selectedId && (
        <ReservationPanel
          // `key` remonta o painel ao trocar de reserva: sem ela, o React
          // reaproveitaria a instancia e o passo de confirmacao ja digitado
          // sobreviveria para a proxima reserva aberta — o clique acidental que
          // a confirmacao existe para evitar.
          key={selectedId}
          reservationId={selectedId}
          labels={props.panelLabels}
          onClose={() => setSelectedId(null)}
          // POR QUE router.refresh() E NAO REMOVER O BLOCO NO FRONT:
          // a pagina e Server Component com force-dynamic, entao o refresh
          // re-executa o render no servidor e a grade volta da MESMA unica query
          // do periodo (secao 11.1) — do banco, que e a fonte da verdade. Tirar
          // o bloco na mao exigiria reimplementar no cliente a regra "so reserva
          // ativa aparece" e deixaria a tela divergir de qualquer outra mudanca
          // ocorrida no meio tempo (um hold que expirou, um cancelamento feito
          // no celular). Custa uma ida ao servidor; paga com uma tela que nunca
          // mente sobre a agenda.
          onCancelled={() => router.refresh()}
        />
      )}
    </section>
  );
}
