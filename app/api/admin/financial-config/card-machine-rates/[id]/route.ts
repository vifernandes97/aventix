// PUT/DELETE /api/admin/financial-config/card-machine-rates/{id}
// (CLAUDE.md secao 4-B.6 e 4-B.7).
//
// PUT e nao PATCH pelo mesmo motivo das excecoes e da grade semanal: modalidade
// e percentual sao a identidade da linha, e um corpo parcial deixaria o chamador
// sem saber contra qual modalidade o percentual foi gravado.
//
// >>> NEM O PUT NEM O DELETE MEXEM EM RECEBIMENTO JA REGISTRADO <<<
// O percentual aplicado e o liquido sao congelados na linha do pagamento no
// instante do registro (secao 4-B.7). Esta tabela governa so o PROXIMO registro.
// Sem essa separacao, atualizar a taxa em novembro reescreveria o liquido da
// reserva de setembro, e a conferencia com o extrato quebraria sem nada acusar
// erro. A tela diz isso em voz alta.

import { NextResponse } from 'next/server';

import {
  CardMachineRateDuplicateError,
  CardMachineRateNotFoundError,
  deleteCardMachineRate,
  updateCardMachineRate,
} from '@/lib/financial-config';

import { duplicateRateResponse, rateSchema, validationErrorBody } from '../../validation';

export const dynamic = 'force-dynamic';

const NOT_FOUND = { error: 'taxa nao encontrada' };

/** `serial`: id nao numerico abortaria a query com 22P02 e viraria 500. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const rowId = parseId((await context.params).id);
  if (rowId === null) return NextResponse.json(NOT_FOUND, { status: 404 });

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
    const rate = await updateCardMachineRate(rowId, {
      modality: parsed.data.modalidade,
      rateBasisPoints: parsed.data.taxaBasisPoints,
    });
    return NextResponse.json({ rate }, { status: 200 });
  } catch (error) {
    if (error instanceof CardMachineRateNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (error instanceof CardMachineRateDuplicateError) return duplicateRateResponse(error);

    console.error(
      '[PUT /api/admin/financial-config/card-machine-rates/{id}] erro inesperado:',
      error,
    );
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const rowId = parseId((await context.params).id);
  if (rowId === null) return NextResponse.json(NOT_FOUND, { status: 404 });

  try {
    await deleteCardMachineRate(rowId);
    // 200 com corpo, e nao 204: a tela le response.json() em toda escrita, e um
    // 204 sem corpo faria esse parse lancar depois de uma operacao bem-sucedida.
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (error) {
    if (error instanceof CardMachineRateNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    console.error(
      '[DELETE /api/admin/financial-config/card-machine-rates/{id}] erro inesperado:',
      error,
    );
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
