// Configuracao financeira do tenant (CLAUDE.md secao 4-B.6).
//
// Server Component lendo a lib direto, sem HTTP contra si mesmo — mesmo padrao
// de /admin, /admin/experiencias e /admin/horarios. A ESCRITA passa pela API, do
// Client Component. O proxy.ts ja barrou quem nao tem sessao.
//
// Desde a Fase A o desconto governa o preco de venda; desde a Fase D a taxa da
// maquininha governa o liquido congelado no registro de recebimento.
//
// >>> O AVISO DE LIQUIDO PENDENTE E CONDICAO DA DECISAO DE 31/08 <<<
// Aquela decisao reverteu a de 28/08 e passou a PERMITIR registrar recebimento
// cuja modalidade nao tenha taxa configurada, gravando o liquido como NULL
// (jamais 0). Recusar nao impediria o dinheiro de ter sido recebido, impediria
// so o sistema de saber, o que viola a regra mais antiga e mais forte da secao
// 1. Mas permitir so e defensavel se alguem for LEMBRADO de voltar: sem esta
// contagem, teriamos trocado uma falha visivel (o registro recusado na hora)
// por uma invisivel (o liquido que nunca chega) — o padrao que ja mordeu este
// projeto tres vezes. Por isso ela mora aqui, na tela onde se conserta a causa.

import { listCardMachineRates, listPaymentDiscounts } from '@/lib/financial-config';
import { countReceiptsAwaitingNet } from '@/lib/payments/receive-in-cash';
import { getSettings } from '@/lib/tenant';

import { AdminNav } from '../_components/admin-nav';
import { FinancialConfigManager } from './_components/financial-config-manager';

export const dynamic = 'force-dynamic';

export default async function AdminFinancialPage() {
  const [discounts, cardMachineRates, settings, awaitingNet] = await Promise.all([
    listPaymentDiscounts(),
    listCardMachineRates(),
    getSettings(),
    countReceiptsAwaitingNet(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold">Financeiro</h1>
        {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
        <p className="text-xs text-neutral-500">{settings.business_name}</p>
      </header>

      <AdminNav current="financeiro" />

      {awaitingNet > 0 && (
        <p
          role="status"
          className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
        >
          <strong>
            {awaitingNet} recebimento{awaitingNet > 1 ? 's' : ''} na maquininha sem valor líquido
          </strong>
          . {awaitingNet > 1 ? 'Eles foram registrados' : 'Ele foi registrado'} quando a taxa da
          modalidade ainda não estava cadastrada. Cadastrar a taxa abaixo vale para os{' '}
          <strong>próximos</strong> registros e não preenche os anteriores — o valor deles precisa
          ser conferido no extrato, porque recalcular com a taxa de hoje mudaria o passado.
        </p>
      )}

      <FinancialConfigManager discounts={discounts} cardMachineRates={cardMachineRates} />
    </main>
  );
}
