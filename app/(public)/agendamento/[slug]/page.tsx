// Formulario publico de agendamento (CLAUDE.md secoes 7.1, 11-B e 14).
//
// >>> POR QUE SOB /agendamento/{slug}, E NAO MAIS NA RAIZ <<<
// Ate 23/08 este arquivo era `/(public)/page.tsx` e a raiz servia a LP do
// Quadri Club. A raiz NAO pertence a tenant nenhum: `app.aventix.com.br` e o
// endereco da PLATAFORMA, e o dia em que existir um segundo cliente a raiz
// servindo a LP do primeiro passa a ser um bug de produto, nao uma escolha de
// atalho. A raiz agora leva ao login (ver `/(public)/page.tsx`).
//
// >>> [slug] DINAMICO, E NAO PASTA LITERAL `quadriclub` <<<
// A secao 2-B do CLAUDE.md previa pasta LITERAL na Etapa 1, com o argumento de
// que um slug desconhecido daria 404 de graca, enquanto `[slug]` sem guarda
// serviria a pagina do Quadri Club para qualquer coisa. O argumento e correto e
// a guarda e o que o resolve: `findTenantBySlug` + `notFound()` abaixo. Com ela,
// `[slug]` da o mesmo 404 e ainda entrega o que a pasta literal nao entrega — o
// slug deixa de ser DECORATIVO e passa a resolver o tenant de verdade, que e o
// ponto desta etapa.
//
// Server Component: le catalogo, recursos e settings direto das libs, sem HTTP
// contra si mesmo — mesmo padrao de /admin (decisao de 03/08). A rota
// GET /api/experiences existe e cumpre o contrato da secao 7.1 para
// consumidores externos a este processo; quem faz HTTP daqui e o WIZARD, para
// a disponibilidade (que muda a cada dia escolhido) e para o POST final.
//
// PUBLICA: `proxy.ts` so protege /admin e /api/admin. Nao ha sessao aqui.

import { notFound } from 'next/navigation';

import { listPublicExperiences } from '@/lib/experiences';
import { listActiveResources } from '@/lib/resources';
import { getSettings } from '@/lib/tenant';
import { assertResolvedTenantIsCurrent, findTenantBySlug } from '@/lib/tenant-slug';

import { BookingWizard } from '../../_components/booking-wizard';
import type { PublicLabels } from '../../_components/shared';

// Disponibilidade e catalogo mudam sem aviso, e a pagina e a porta de entrada
// da venda: servir HTML estatico ofereceria trilha desativada ha dez minutos.
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ canal?: string }>;
type RouteParams = Promise<{ slug: string }>;

/**
 * Tenant dono desta URL, ou 404.
 *
 * >>> A GUARDA E O MOTIVO DE `[slug]` PODER SER DINAMICO <<<
 * Sem ela, /agendamento/qualquer-coisa renderizaria a LP do Quadri Club: N
 * enderecos servindo a mesma pagina (conteudo duplicado para buscador) e, pior,
 * um cliente divulgando um link errado que FUNCIONA — o erro so apareceria no
 * dia em que o slug certo passasse a pertencer a outro tenant.
 *
 * `assertResolvedTenantIsCurrent` e a segunda metade, e cobre o caso oposto: o
 * slug existe, mas pertence a um tenant que o resto do sistema ainda nao serve.
 * Ver o cabecalho de lib/tenant-slug.ts.
 */
async function requireTenant(params: RouteParams) {
  const { slug } = await params;
  const tenant = await findTenantBySlug(slug);
  if (!tenant) notFound();

  assertResolvedTenantIsCurrent(tenant);
  return tenant;
}

/**
 * REGRA DE MARCA (rev 5): a UI publica exibe a marca do TENANT, nunca "Aventix".
 *
 * O layout raiz traz "Aventix — Painel", que e certo para o admin e errado
 * aqui: quem abre esta pagina e cliente do Quadri Club e nunca ouviu falar da
 * plataforma. Sobrescrever a metadata na rota publica era a contrapartida
 * prometida quando o titulo do layout foi corrigido.
 */
export async function generateMetadata({ params }: { params: RouteParams }) {
  // Resolve o tenant tambem aqui, e nao so no componente: o Next chama
  // generateMetadata para slug INEXISTENTE tambem, e sem esta guarda a aba do
  // navegador anunciaria "Quadri Club — Agendamento" numa pagina 404.
  const { slug } = await params;
  const tenant = await findTenantBySlug(slug);
  if (!tenant) return { title: 'Pagina nao encontrada' };

  const settings = await getSettings();
  return {
    title: `${settings.business_name} — Agendamento`,
    description: `Reserve seu passeio no ${settings.business_name}.`,
  };
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  // PRIMEIRO o tenant, e sozinho: as leituras abaixo sao do tenant de
  // getTenantId(), e so fazem sentido depois de a guarda confirmar que ele e o
  // mesmo que a URL resolveu. Buscar catalogo em paralelo com a validacao
  // significaria ler dados de um tenant para descartar depois — barato hoje,
  // mas e o habito que faz o vazamento nascer quando a Etapa 2 chegar.
  await requireTenant(params);

  const [experiences, resources, settings, search] = await Promise.all([
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
      channel={search.canal?.trim() || null}
    />
  );
}
