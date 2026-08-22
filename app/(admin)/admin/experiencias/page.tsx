// CRUD de experiencias (CLAUDE.md secoes 7.2 e 14).
//
// Server Component: le o catalogo direto da lib, sem HTTP contra si mesmo —
// mesmo padrao de /admin sobre lib/calendar.ts (decisao de 03/08). A rota
// GET /api/admin/experiences existe e cumpre o contrato para consumidores fora
// deste processo; a ESCRITA e que passa por ela, do Client Component.
//
// O proxy.ts ja barrou quem nao tem sessao antes de chegar aqui.

import { listExperiences } from '@/lib/experiences';
import { getSettings } from '@/lib/tenant';

import { AdminNav } from '../_components/admin-nav';
import { ExperienceManager } from './_components/experience-manager';

// Catalogo muda quando o dono edita, e `router.refresh()` depois de cada
// operacao precisa reexecutar a consulta de verdade.
export const dynamic = 'force-dynamic';

export default async function AdminExperiencesPage() {
  const [experiences, settings] = await Promise.all([listExperiences(), getSettings()]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold">Experiências</h1>
        {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
        <p className="text-xs text-neutral-500">{settings.business_name}</p>
      </header>

      {/* Substitui o "Voltar para a agenda" solto: ate 22/08 esta pagina nao
          tinha link de ENTRADA nenhum, so de saida — so se chegava nela
          digitando a URL. */}
      <AdminNav current="experiencias" />

      <ExperienceManager experiences={experiences} />
    </main>
  );
}
