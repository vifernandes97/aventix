// GET /api/admin/financial-config — configuracao financeira do tenant
// (CLAUDE.md secao 4-B.6).
//
// Camada FINA sobre lib/financial-config.ts. Autenticacao pelo proxy.ts (que
// responde 401 antes desta funcao rodar) e tenant por getTenantId() — nunca do
// corpo. Ver o cabecalho de /api/admin/experiences/route.ts.
//
// As DUAS configuracoes voltam juntas porque a tela mostra as duas juntas: sao
// leituras pequenas, de tabelas pequenas, e separa-las em dois GET so criaria a
// chance de a tela desenhar metade da configuracao.

import { NextResponse } from 'next/server';

import { listCardMachineRates, listPaymentDiscounts } from '@/lib/financial-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [discounts, cardMachineRates] = await Promise.all([
      listPaymentDiscounts(),
      listCardMachineRates(),
    ]);

    return NextResponse.json({ discounts, cardMachineRates }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/admin/financial-config] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
