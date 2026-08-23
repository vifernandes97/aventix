// Formulario publico de agendamento (CLAUDE.md secoes 7.1, 11-B e 14).
//
// >>> POR QUE NA RAIZ, E NAO EM /agendar <<<
// A secao 14 reserva `/(public)/page.tsx` — a raiz — para este formulario, e e
// o destino certo: o dominio aventix.com.br e divulgado direto ao cliente
// final, e /agendar obrigaria uma home a existir so para levar a ele. Este
// arquivo tambem PAGA a divida registrada em docs/ESTADO-ATUAL.md ("app/ nao
// usa o route group (public) que a secao 14 especifica"), substituindo o
// placeholder do create-next-app que ocupava a rota.
//
// Server Component: le catalogo, recursos e settings direto das libs, sem HTTP
// contra si mesmo — mesmo padrao de /admin (decisao de 03/08). A rota
// GET /api/experiences existe e cumpre o contrato da secao 7.1 para
// consumidores externos a este processo; quem faz HTTP daqui e o WIZARD, para
// a disponibilidade (que muda a cada dia escolhido) e para o POST final.
//
// PUBLICA: `proxy.ts` so protege /admin e /api/admin. Nao ha sessao aqui.

import { listPublicExperiences } from '@/lib/experiences';
import { listActiveResources } from '@/lib/resources';
import { getSettings } from '@/lib/tenant';

import { BookingWizard } from './_components/booking-wizard';
import type { PublicLabels } from './_components/shared';

// Disponibilidade e catalogo mudam sem aviso, e a pagina e a porta de entrada
// da venda: servir HTML estatico ofereceria trilha desativada ha dez minutos.
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ canal?: string }>;

/**
 * REGRA DE MARCA (rev 5): a UI publica exibe a marca do TENANT, nunca "Aventix".
 *
 * O layout raiz traz "Aventix — Painel", que e certo para o admin e errado
 * aqui: quem abre esta pagina e cliente do Quadri Club e nunca ouviu falar da
 * plataforma. Sobrescrever a metadata na rota publica era a contrapartida
 * prometida quando o titulo do layout foi corrigido.
 */
export async function generateMetadata() {
  const settings = await getSettings();
  return {
    title: `${settings.business_name} — Agendamento`,
    description: `Reserve seu passeio no ${settings.business_name}.`,
  };
}

export default async function BookingPage({ searchParams }: { searchParams: SearchParams }) {
  const [experiences, resources, settings, params] = await Promise.all([
    listPublicExperiences(),
    listActiveResources(),
    getSettings(),
    searchParams,
  ]);

  // Rotulos do TENANT (secao 3: texto de UI vem de settings, nunca hardcode).
  // Resolvidos aqui porque lib/tenant.ts e server-only e o wizard e Client
  // Component — mesmo caminho dos `panelLabels` do calendario do admin.
  const labels: PublicLabels = {
    business_name: settings.business_name,
    resource_label: settings.resource_label,
    resource_label_plural: settings.resource_label_plural,
    operator_label: settings.operator_label,
    passenger_label: settings.passenger_label,
    operator_document_label: settings.operator_document_label,
    meeting_point: settings.meeting_point,
    what_to_bring: settings.what_to_bring,
  };

  // Capacidade de UM recurso, para o texto do passo 2 e o teto de
  // participantes. O menor entre os ativos, e nao o primeiro: com capacidades
  // diferentes, usar o maior prometeria lugar que o recurso alocado pode nao
  // ter. Quem decide de verdade e createReservation, que soma a capacity dos
  // recursos que ELE alocou (decisao de 27/07).
  const capacityPerResource =
    resources.length > 0 ? Math.min(...resources.map((r) => r.capacity)) : 1;

  return (
    <BookingWizard
      experiences={experiences}
      activeResourceCount={resources.length}
      capacityPerResource={capacityPerResource}
      documentRequired={settings.operator_document_required === 'true'}
      labels={labels}
      channel={params.canal?.trim() || null}
    />
  );
}
