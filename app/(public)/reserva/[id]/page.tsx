// Tela de acompanhamento da reserva (CLAUDE.md secao 14: /reserva/[id]).
//
// >>> POR QUE UMA PAGINA, E NAO O PASSO FINAL DO WIZARD <<<
// O passo `done` do wizard vive na memoria do navegador: um refresh, um toque no
// botao de voltar ou fechar a aba e o cliente perde o QR e qualquer noticia da
// propria reserva. Esta URL sobrevive a tudo isso e pode ser reaberta depois —
// e e ela que o wizard passa a abrir com router.replace.
//
// >>> O CONTEXTO QUE MUDA O PESO DESTA TELA (decisao de 21/08/2026) <<<
// O e-mail de confirmacao foi CORTADO do go-live: nao existe Resend, nao existe
// lib/notifications.ts. Enquanto for assim, o estado `confirmed` desta pagina e
// a UNICA confirmacao que o cliente recebe da compra. Por isso ele nao e um
// visto verde: traz data por extenso, trilha, duracao, ponto de encontro, o que
// levar e como falar com o tenant — o suficiente para o cliente printar a tela e
// CHEGAR NO LUGAR sem mais nada. Quando o e-mail entrar, esta tela continua
// certa; sem ele, ela e tudo.
//
// >>> ONDE ELA VAI MORAR DEPOIS <<<
// A secao 2-B preve /agendamento/{slug}/reserva/{id}. A Etapa 1 da migracao de
// URL e POS GO-LIVE (decisao de 20/08), entao a pagina nasce aqui e MUDA de
// lugar depois. Nao crie app/(public)/agendamento/ agora.
//
// Server Component: resolve as settings do tenant (server-only) e passa como
// prop para a view, que e Client Component por causa do polling. Mesmo caminho
// dos `labels` do wizard.

import { getSettings } from '@/lib/tenant';

import { ReservationStatusView, type StatusLabels } from './_components/status-view';

// A pagina nao le a reserva no servidor de proposito (a view busca por HTTP,
// que e o mesmo caminho do polling), mas o `dynamic` impede que o Next tente
// pre-renderizar e servir HTML estatico com settings de dez minutos atras.
export const dynamic = 'force-dynamic';

/**
 * `noindex`: a URL contem o id da reserva e e a credencial de acesso a ela.
 * Uma reserva indexada num buscador transformaria "link que so quem comprou
 * tem" em "link que qualquer um encontra".
 */
export const metadata = {
  title: 'Sua reserva',
  robots: { index: false, follow: false },
};

export default async function ReservationStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, settings] = await Promise.all([params, getSettings()]);

  // Chave ausente ou em branco e ESTADO VALIDO: a view omite o bloco inteiro em
  // vez de renderizar rotulo vazio. `support_whatsapp` nasce vazia no template
  // (o numero ainda nao foi informado pelo cliente) e as demais podem estar
  // vazias num tenant recem-semeado.
  const labels: StatusLabels = {
    business_name: settings.business_name,
    meeting_point: settings.meeting_point,
    what_to_bring: settings.what_to_bring,
    support_whatsapp: settings.support_whatsapp,
    reply_to_email: settings.reply_to_email,
  };

  return <ReservationStatusView reservationId={id} labels={labels} />;
}
