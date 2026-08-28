// Configuracao financeira do tenant (CLAUDE.md secao 4-B.6).
//
// Server Component lendo a lib direto, sem HTTP contra si mesmo — mesmo padrao
// de /admin, /admin/experiencias e /admin/horarios. A ESCRITA passa pela API, do
// Client Component. O proxy.ts ja barrou quem nao tem sessao.
//
// >>> NADA NO SISTEMA LE ESTES VALORES AINDA <<<
// A Fase 0 faz a configuracao existir e ser editavel, e mais nada. Ligar o
// desconto ao preco e Fase A; usar a taxa da maquininha no registro de
// recebimento e Fase D (secao 17). A tela diz isso ao dono em vez de deixa-lo
// crer que ja mudou alguma coisa na venda.

import { listCardMachineRates, listPaymentDiscounts } from '@/lib/financial-config';
import { getSettings } from '@/lib/tenant';

import { AdminNav } from '../_components/admin-nav';
import { FinancialConfigManager } from './_components/financial-config-manager';

export const dynamic = 'force-dynamic';

export default async function AdminFinancialPage() {
  const [discounts, cardMachineRates, settings] = await Promise.all([
    listPaymentDiscounts(),
    listCardMachineRates(),
    getSettings(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <header>
        <h1 className="text-lg font-semibold">Financeiro</h1>
        {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
        <p className="text-xs text-neutral-500">{settings.business_name}</p>
      </header>

      <AdminNav current="financeiro" />

      <FinancialConfigManager discounts={discounts} cardMachineRates={cardMachineRates} />
    </main>
  );
}
