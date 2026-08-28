// GET/POST /api/admin/financial-config/card-machine-rates — taxas da maquininha
// por modalidade (CLAUDE.md secao 4-B.6 e 4-B.7).
//
// >>> ESTA TABELA NASCE VAZIA E ISSO E O ESTADO CORRETO HOJE <<<
// Os percentuais reais do Quadri Club nao chegaram. Lista vazia significa "nao
// configurado", e a Fase D deve RECUSAR registrar recebimento de maquininha
// enquanto a modalidade nao tiver taxa — nunca assumir zero, que produziria um
// liquido igual ao bruto, com aparencia de certo.

import { NextResponse } from 'next/server';

import {
  CardMachineRateDuplicateError,
  createCardMachineRate,
  listCardMachineRates,
} from '@/lib/financial-config';

import { duplicateRateResponse, rateSchema, validationErrorBody } from '../validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ rates: await listCardMachineRates() }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/admin/financial-config/card-machine-rates] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'corpo invalido: esperado JSON' }, { status: 400 });
  }

  const parsed = rateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const rate = await createCardMachineRate({
      modality: parsed.data.modalidade,
      rateBasisPoints: parsed.data.taxaBasisPoints,
    });
    return NextResponse.json({ rate }, { status: 201 });
  } catch (error) {
    if (error instanceof CardMachineRateDuplicateError) return duplicateRateResponse(error);

    console.error('[POST /api/admin/financial-config/card-machine-rates] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
