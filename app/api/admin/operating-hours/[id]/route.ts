// PUT/DELETE /api/admin/operating-hours/{id} (CLAUDE.md secoes 4.3 e 6).
//
// PUT e nao PATCH pelo mesmo motivo das excecoes: weekday, abre e fecha sao
// interdependentes — `closes > opens` e a checagem de sobreposicao so podem ser
// julgadas com os tres juntos.
//
// >>> AQUI EXISTE DELETE, e ele NAO cancela reserva <<<
// Nada referencia operating_hours. Apagar a faixa do sabado tira o sabado da
// VENDA FUTURA; as reservas ja feitas no sabado continuam de pe, porque a vaga
// delas vive em reservation_resources.period, congelado na venda (secao 4.6).
// A tela diz isso em voz alta na confirmacao — sem o aviso, o dono apaga o
// sabado achando que cancelou os passeios de sabado.

import { NextResponse } from 'next/server';

import {
  OperatingHoursNotFoundError,
  OperatingHoursOverlapError,
  deleteOperatingHours,
  updateOperatingHours,
} from '@/lib/operating-hours';

import { overlapResponse, rangeSchema, validationErrorBody } from '../validation';

export const dynamic = 'force-dynamic';

const NOT_FOUND = { error: 'faixa nao encontrada' };

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

  const parsed = rangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const range = await updateOperatingHours(rowId, {
      weekday: parsed.data.diaDaSemana,
      opens: parsed.data.abre,
      closes: parsed.data.fecha,
    });
    return NextResponse.json({ range }, { status: 200 });
  } catch (error) {
    if (error instanceof OperatingHoursNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (error instanceof OperatingHoursOverlapError) return overlapResponse(error);

    console.error('[PUT /api/admin/operating-hours/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const rowId = parseId((await context.params).id);
  if (rowId === null) return NextResponse.json(NOT_FOUND, { status: 404 });

  try {
    await deleteOperatingHours(rowId);
    // 200 com corpo, e nao 204: a tela le response.json() em toda escrita, e um
    // 204 sem corpo faria esse parse lancar depois de uma operacao bem-sucedida.
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (error) {
    if (error instanceof OperatingHoursNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    console.error('[DELETE /api/admin/operating-hours/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
