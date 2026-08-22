// CRUD de excecoes de agenda (CLAUDE.md secoes 6, 7.2 e 14).
//
// Server Component: le a grade direto das libs, sem HTTP contra si mesmo —
// mesmo padrao de /admin sobre lib/calendar.ts e de /admin/experiencias sobre
// lib/experiences.ts (decisao de 03/08). A ESCRITA e que passa pela API, a
// partir do Client Component.
//
// O proxy.ts ja barrou quem nao tem sessao antes de chegar aqui.
//
// A grade SEMANAL vai junto como prop, e nao e enfeite: e o que deixa a
// precedencia da secao 6 visivel. Ao escolher a data, o formulario mostra lado a
// lado o que aquele dia da semana faz hoje e o que a excecao passa a mandar.

import { getWeeklyGrid } from '@/lib/operating-hours';
import { listScheduleExceptions } from '@/lib/schedule-exceptions';
import { getSettings } from '@/lib/tenant';
import { todayLocalDate } from '@/lib/time';

import { AdminNav } from '../_components/admin-nav';
import { ExceptionManager } from './_components/exception-manager';

// A grade muda quando o dono edita, e `router.refresh()` depois de cada
// operacao precisa reexecutar a consulta de verdade.
export const dynamic = 'force-dynamic';

export default async function AdminExceptionsPage() {
  const [exceptions, weeklyGrid, settings] = await Promise.all([
    listScheduleExceptions(),
    getWeeklyGrid(),
    getSettings(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold">Exceções de agenda</h1>
        {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
        <p className="text-xs text-neutral-500">{settings.business_name}</p>
      </header>

      <AdminNav current="excecoes" />

      <ExceptionManager
        exceptions={exceptions}
        weeklyGrid={weeklyGrid}
        // "Hoje" do fuso do tenant, resolvido no SERVIDOR: o relogio do
        // aparelho do dono pode estar errado, e e este valor que decide o
        // minimo do seletor de data e o corte entre passadas e futuras. A API
        // reaplica a regra — aqui e conveniencia, nao defesa.
        today={todayLocalDate()}
      />
    </main>
  );
}
