// PUT /api/admin/financial-config/discounts/{method} — desconto por metodo de
// pagamento (CLAUDE.md secao 4-B.1 e 4-B.6).
//
// >>> UPSERT PELO METODO, SEM POST E SEM DELETE <<<
// O conjunto de metodos e fechado pelo enum `payment_method` e a tela desenha os
// dois sempre. "Sem linha" e "0 bp" dizem a mesma coisa — o cliente paga o valor
// cheio —, entao criar e apagar seriam duas maneiras de expressar o que um
// numero ja expressa. O metodo vem na URL porque ELE e a identidade da linha.
//
// Contraste deliberado com card-machine-rates, que tem POST/PUT/DELETE e 409 de
// duplicata: la, ausencia significa NAO CONFIGURADO e precisa ser distinguivel
// de zero. Ver o cabecalho de lib/financial-config.ts.

import { NextResponse } from 'next/server';

import { setPaymentDiscount } from '@/lib/financial-config';

import { discountSchema, methodSchema, validationErrorBody } from '../../validation';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, context: { params: Promise<{ method: string }> }) {
  // Metodo fora do enum responde 404, e nao 422: ele e SEGMENTO DE URL, entao
  // "/discounts/boleto" e um endereco que nao existe — nao um corpo invalido.
  const method = methodSchema.safeParse((await context.params).method);
  if (!method.success) {
    return NextResponse.json({ error: 'metodo de pagamento nao encontrado' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'corpo invalido: esperado JSON' }, { status: 400 });
  }

  const parsed = discountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const discount = await setPaymentDiscount(method.data, parsed.data.descontoBasisPoints);
    return NextResponse.json({ discount }, { status: 200 });
  } catch (error) {
    console.error('[PUT /api/admin/financial-config/discounts/{method}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
