// CRUD da grade semanal (CLAUDE.md secoes 4.3, 6 e 14).
//
// Server Component lendo a lib direto, sem HTTP contra si mesmo — mesmo padrao
// de /admin e /admin/experiencias. A ESCRITA passa pela API, do Client
// Component. O proxy.ts ja barrou quem nao tem sessao.
//
// As EXCECOES ja cadastradas vao junto como prop: uma faixa semanal editada
// aqui nao vale nos dias que tem excecao (secao 6), e a tela precisa dizer isso
// — senao o dono muda o horario de sabado, o sabado do feriado continua
// diferente, e ele conclui que a edicao nao pegou.

import { listOperatingHours } from '@/lib/operating-hours';
import { listScheduleExceptions } from '@/lib/schedule-exceptions';
import { getSettings } from '@/lib/tenant';
import { todayLocalDate } from '@/lib/time';

import { AdminNav } from '../_components/admin-nav';
import { WeeklyHoursManager } from './_components/weekly-hours-manager';

export const dynamic = 'force-dynamic';

export default async function AdminHoursPage() {
  const [hours, exceptions, settings] = await Promise.all([
    listOperatingHours(),
    listScheduleExceptions(),
    getSettings(),
  ]);

  const today = todayLocalDate();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold">Horários da semana</h1>
        {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
        <p className="text-xs text-neutral-500">{settings.business_name}</p>
      </header>

      <AdminNav current="horarios" />

      <WeeklyHoursManager
        hours={hours}
        // So as excecoes que ainda valem: as passadas nao afetam mais venda
        // nenhuma e so poluiriam o aviso.
        upcomingExceptions={exceptions.filter((e) => e.date >= today)}
      />
    </main>
  );
}
