// Painel do admin = CALENDARIO NATIVO (CLAUDE.md secoes 11.1 e 14).
//
// A secao 14 reserva `/admin` para o calendario, e e o destino certo: e a tela
// que o dono abre dez vezes por dia, em campo. Qualquer outra raiz obrigaria um
// clique a mais na tela mais usada do sistema.
//
// Server Component: le a sessao e os dados direto, sem fetch. Mesmo padrao do
// placeholder que ele substitui.
//
// >>> POR QUE NAO CHAMA GET /api/admin/calendar <<<
// A secao 11.1 diz que a tela le daquela rota. O que a regra protege e "UMA
// consulta por render, o front nunca busca por reserva ou por recurso" — e isso
// vale aqui integralmente: a mesma funcao (getCalendarReservations) faz a mesma
// unica query. Um Server Component chamando a propria API por HTTP adicionaria
// um salto de rede e obrigaria a repassar o cookie de sessao para si mesmo, sem
// nada em troca. E o padrao que o projeto ja usa: /api/availability e camada
// fina sobre lib/availability.ts, e o servidor chama a lib. A ROTA existe e
// atende ao contrato para os consumidores externos a este processo.
//
// A UNICA ESCRITA desta tela e o cancelamento, e ela nao acontece aqui: o painel
// de detalhes (Client Component) chama POST /api/admin/reservations/{id}/cancel,
// que por sua vez chama setReservationStatus (secao 4.6). Este Server Component
// continua so lendo.

import { getCurrentUser } from '@/lib/auth';
import {
  type CalendarView,
  datesBetween,
  getActiveExperiences,
  getActiveResources,
  getCalendarReservations,
  getDayGrid,
  isCalendarView,
  periodForView,
  shiftPeriod,
} from '@/lib/calendar';
import { resolveOpenReservationId } from '@/lib/reservation-list';
import { getSettings } from '@/lib/tenant';
import { isValidCalendarDate, todayLocalDate } from '@/lib/time';

import { AdminNav } from './_components/admin-nav';
import { Calendar } from './_components/calendar';
import { dayMonthLabel, fullDateLabel, monthYearLabel } from './_components/shared';

// Sessao em cookie + agenda que muda a cada reserva: renderizar estaticamente
// serviria a pagina de um usuario para o proximo, com dados velhos.
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ view?: string; date?: string; reserva?: string }>;

function periodLabel(view: CalendarView, date: string, from: string, to: string): string {
  if (view === 'day') return fullDateLabel(date);
  if (view === 'week') return `${dayMonthLabel(from)} – ${dayMonthLabel(to)}`;
  return monthYearLabel(date);
}

export default async function AdminCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  // O proxy ja barrou quem nao tem sessao; aqui a leitura serve para EXIBIR a
  // identidade, nao para autorizar de novo.
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);

  // Parametros de URL sao entrada de usuario: view desconhecida ou data
  // inexistente ('2026-02-30') caem no default em vez de quebrar a tela. Isto e
  // navegacao, nao API — 400 aqui seria uma tela de erro no lugar da agenda.
  const today = todayLocalDate();
  const view: CalendarView = params.view && isCalendarView(params.view) ? params.view : 'day';
  const date = params.date && isValidCalendarDate(params.date) ? params.date : today;

  const { from, to } = periodForView(view, date);
  const dates = datesBetween(from, to);

  // Parametro ADITIVO: `?reserva=` so ACRESCENTA uma forma de abrir o painel de
  // detalhe (o clique no bloco continua igual). resolveOpenReservationId devolve
  // null para param ausente, malformado, inexistente ou de outro tenant — nesses
  // casos a agenda renderiza exatamente como hoje, sem painel e sem erro. Ausente
  // nem toca o banco. Ver lib/reservation-list.ts.
  const [reservations, resources, experiences, settings, dayGrid, openReservationId] =
    await Promise.all([
      getCalendarReservations({ from, to }),
      getActiveResources(),
      getActiveExperiences(),
      getSettings(),
      // A grade de funcionamento so desenha linhas na view de dia.
      view === 'day' ? getDayGrid(date) : Promise.resolve(null),
      resolveOpenReservationId(params.reserva),
    ]);

  const href = (v: CalendarView, d: string) => `/admin?view=${v}&date=${d}`;

  return (
    <main className="mx-auto flex w-full max-w-[110rem] flex-col gap-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
          <h1 className="text-lg font-semibold">{settings.business_name || 'Agenda'}</h1>
          <p className="text-xs text-neutral-500">{user?.email}</p>
        </div>

        <form action="/api/admin/logout" method="post">
          <button type="submit" className="rounded border px-3 py-1.5 text-sm">
            Sair
          </button>
        </form>
      </header>

      <AdminNav current="agenda" />

      <Calendar
        view={view}
        date={date}
        today={today}
        dates={dates}
        periodLabel={periodLabel(view, date, from, to)}
        prevHref={href(view, shiftPeriod(view, date, -1))}
        nextHref={href(view, shiftPeriod(view, date, 1))}
        todayHref={href(view, today)}
        viewHrefs={{ day: href('day', date), week: href('week', date), month: href('month', date) }}
        // Calculado no servidor: shiftPeriod/periodForView vivem em modulo
        // server-only e nao podem atravessar para o cliente.
        dayHrefs={Object.fromEntries(dates.map((d) => [d, href('day', d)]))}
        reservations={reservations}
        resources={resources}
        experiences={experiences}
        dayGrid={dayGrid}
        // Null quando nao ha `?reserva=` valido: o painel nao abre e a tela e a
        // de sempre. So um id existente do proprio tenant abre o painel.
        openReservationId={openReservationId}
        resourceLabelPlural={settings.resource_label_plural}
        // Rotulos do TENANT para o painel (secao 3: texto de UI vem de
        // settings). Resolvidos aqui porque lib/tenant.ts e server-only; o
        // painel e Client Component e nao pode le-los sozinho.
        panelLabels={{
          operator: settings.operator_label,
          passenger: settings.passenger_label,
          document: settings.operator_document_label,
          resourcePlural: settings.resource_label_plural,
        }}
      />
    </main>
  );
}
