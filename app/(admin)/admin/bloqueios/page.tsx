// CRUD de bloqueios pontuais (CLAUDE.md secoes 4.3, 6 e 14).
//
// Server Component lendo as libs direto, sem HTTP contra si mesmo — mesmo
// padrao das outras telas do admin. A ESCRITA passa pela API. O proxy.ts ja
// barrou quem nao tem sessao.

import { listBlackouts } from '@/lib/blackouts';
import { listActiveResources } from '@/lib/resources';
import { getSettings } from '@/lib/tenant';
import { todayLocalDate } from '@/lib/time';

import { AdminNav } from '../_components/admin-nav';
import { BlackoutManager } from './_components/blackout-manager';

export const dynamic = 'force-dynamic';

export default async function AdminBlackoutsPage() {
  const [blackouts, resources, settings] = await Promise.all([
    listBlackouts(),
    listActiveResources(),
    getSettings(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold">Bloqueios</h1>
        {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
        <p className="text-xs text-neutral-500">{settings.business_name}</p>
      </header>

      <AdminNav current="bloqueios" />

      <BlackoutManager
        blackouts={blackouts}
        resources={resources}
        today={todayLocalDate()}
        // Rotulo do TENANT (secao 3): num tenant de bote isto le "Bote".
        resourceLabel={settings.resource_label}
        resourceLabelPlural={settings.resource_label_plural}
      />
    </main>
  );
}
