// GRUPO P — enderecos publicos: LP sob slug e raiz da plataforma (secao 2-B).
//
// Cobre a mudanca de topologia de 23/08:
//   /                        -> LOGIN da plataforma (nao pertence a tenant)
//   /agendamento/quadriclub  -> LP do tenant
//   /agendamento/{outro}     -> 404
//
// >>> POR QUE CHAMA O COMPONENTE DE PAGINA, E NAO A REDE <<<
// Estes sao Server Components, nao rotas de API: nao ha handler para invocar e
// subir um servidor Next dentro do Vitest seria trocar um teste deterministico
// por um teste de infraestrutura. Chamar a funcao exportada exercita exatamente
// o que o Next executa por requisicao — a resolucao do slug, a guarda e a
// escolha do que renderizar. O 200/404/307 de verdade e conferido por curl
// contra o `next dev`, que e o complemento e nao o substituto disto.
//
// As formas de erro abaixo foram MEDIDAS neste projeto (Next 16), nao supostas:
//   notFound()             -> digest 'NEXT_HTTP_ERROR_FALLBACK;404'
//   redirect('/admin/login') -> digest 'NEXT_REDIRECT;replace;/admin/login;307;'
// Se uma versao futura do Next mudar o formato, estes testes falham — e falhar
// e o comportamento certo: o 307 do redirect da raiz e requisito da secao 2-B,
// nao detalhe de implementacao.

import { beforeAll, describe, expect, it } from 'vitest';

import RootPage from '@/app/(public)/page';
import BookingPage, { generateMetadata } from '@/app/(public)/agendamento/[slug]/page';
import { BookingWizard } from '@/app/(public)/_components/booking-wizard';
import { SEED_TENANT_SLUG } from '@/lib/seed';

import { assertCatalogSeeded } from './helpers/db';

/**
 * Props que o wizard recebe. Derivada do proprio componente em vez de escrita a
 * mao: se a assinatura dele mudar, isto quebra na compilacao — que e o aviso que
 * um `Record<string, any>` engoliria.
 */
type WizardProps = React.ComponentProps<typeof BookingWizard>;

const params = (slug: string) => Promise.resolve({ slug });
const noSearch = Promise.resolve({});

/** Digest do erro, que e onde o Next carrega o significado. */
function digestOf(error: unknown): string {
  return String((error as { digest?: unknown })?.digest ?? '');
}

async function capture(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}

beforeAll(assertCatalogSeeded);

describe('P — LP sob o slug do tenant', () => {
  it('69. /agendamento/quadriclub renderiza o wizard com os dados do tenant', async () => {
    const element = (await BookingPage({
      params: params(SEED_TENANT_SLUG),
      searchParams: noSearch,
    })) as { type: unknown; props: WizardProps };

    // E o wizard, e nao um placeholder ou uma tela de erro.
    expect(element.type).toBe(BookingWizard);

    // E ele recebeu catalogo de verdade: sem isto o teste passaria com o wizard
    // montado sobre listas vazias, que e uma pagina que nao vende nada.
    expect(element.props.experiences.length).toBeGreaterThan(0);
    expect(element.props.activeResourceCount).toBeGreaterThan(0);
    expect(element.props.labels.business_name).toBe('Quadri Club');
  });

  it('70. o slug e case-insensitive e tolera espaco em volta', async () => {
    // Link colado de WhatsApp chega com maiuscula e espaco mais vezes do que se
    // imagina. Normalizar e barato; um 404 aqui seria uma venda perdida.
    const element = (await BookingPage({
      params: params(`  ${SEED_TENANT_SLUG.toUpperCase()}  `),
      searchParams: noSearch,
    })) as { type: unknown };

    expect(element.type).toBe(BookingWizard);
  });

  it('71. o parametro ?canal= continua chegando ao wizard', async () => {
    // Regressao: `params` passou a ser o slug da rota, e o searchParams virou
    // `search` dentro da pagina. Trocar um pelo outro compilaria e mataria em
    // silencio a atribuicao de origem (channel) da parceria Aventurando.
    const element = (await BookingPage({
      params: params(SEED_TENANT_SLUG),
      searchParams: Promise.resolve({ canal: 'aventurando' }),
    })) as { props: WizardProps };

    expect(element.props.channel).toBe('aventurando');
  });

  it('72. slug desconhecido responde 404, e NAO a pagina do Quadri Club', async () => {
    const error = await capture(() =>
      BookingPage({ params: params('slug-que-nao-existe'), searchParams: noSearch }),
    );

    expect(digestOf(error)).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('73. a metadata de slug desconhecido nao vaza a marca do tenant', async () => {
    // Sem esta guarda a aba do navegador anunciaria "Quadri Club — Agendamento"
    // numa pagina 404 — a marca do cliente carimbada num endereco que nao e dele.
    const meta = await generateMetadata({ params: params('slug-que-nao-existe') });

    expect(meta.title).toBe('Pagina nao encontrada');
    expect(JSON.stringify(meta)).not.toContain('Quadri Club');
  });
});

describe('P — a raiz e da plataforma, nao de um tenant', () => {
  it('74. a raiz redireciona para o login', async () => {
    const error = await capture(async () => RootPage());

    // `replace` e 307 vem do proprio redirect() do App Router.
    expect(digestOf(error)).toBe('NEXT_REDIRECT;replace;/admin/login;307;');
  });

  it('75. >>> a raiz NUNCA serve conteudo de tenant <<<', async () => {
    const error = await capture(async () => RootPage());
    const digest = digestOf(error);

    // Nao renderiza nada: a unica saida da raiz e o redirect.
    expect(digest).toContain('NEXT_REDIRECT');

    // E o destino nao e a LP de tenant nenhum. Mandar a raiz para
    // /agendamento/quadriclub seria o mesmo erro escondido atras de um redirect
    // — e so apareceria no dia do segundo cliente.
    expect(digest).not.toContain('/agendamento');
    expect(digest).toContain('/admin/login');
  });

  it('76. o redirect da raiz e 307, NUNCA 308', async () => {
    // 308 fica cacheado no navegador praticamente para sempre e sequestraria a
    // raiz no dia em que o site comercial nascer — inclusive para quem visitou
    // antes, que e justamente quem mais importa. Requisito da secao 2-B.
    const digest = digestOf(await capture(async () => RootPage()));

    expect(digest).toContain(';307;');
    expect(digest).not.toContain(';308;');
  });
});
