// PUT/DELETE /api/admin/blackouts/{id} (CLAUDE.md secoes 4.3 e 6).
//
// PUT e nao PATCH pelo mesmo motivo dos outros dois CRUDs de grade: os campos
// sao interdependentes e a validacao precisa deles juntos.
//
// >>> DELETE existe e NAO mexe em reserva <<<
// Nada referencia blackouts. Apagar devolve o intervalo para a venda; as
// reservas que existiam continuam como estavam, porque a vaga delas vive em
// reservation_resources.period, congelado na venda (secao 4.6).

import { NextResponse } from 'next/server';

import {
  BlackoutNotFoundError,
  BlackoutResourceNotFoundError,
  deleteBlackout,
  updateBlackout,
} from '@/lib/blackouts';

import { blackoutSchema, validationErrorBody } from '../validation';

export const dynamic = 'force-dynamic';

const NOT_FOUND = { error: 'bloqueio nao encontrado' };

/** `serial`: id nao numerico abortaria a query com 22P02 e viraria 500. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const blackoutId = parseId((await context.params).id);
  if (blackoutId === null) return NextResponse.json(NOT_FOUND, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'corpo invalido: esperado JSON' }, { status: 400 });
  }

  const parsed = blackoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const blackout = await updateBlackout(blackoutId, {
      resourceId: parsed.data.recursoId,
      startLocal: parsed.data.inicio,
      endLocal: parsed.data.fim,
      reason: parsed.data.motivo,
    });
    return NextResponse.json({ blackout }, { status: 200 });
  } catch (error) {
    if (error instanceof BlackoutNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (error instanceof BlackoutResourceNotFoundError) {
      return NextResponse.json(
        {
          error: 'dados invalidos',
          fields: [{ param: 'recursoId', message: 'recursoId: recurso não encontrado' }],
        },
        { status: 422 },
      );
    }

    console.error('[PUT /api/admin/blackouts/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const blackoutId = parseId((await context.params).id);
  if (blackoutId === null) return NextResponse.json(NOT_FOUND, { status: 404 });

  try {
    await deleteBlackout(blackoutId);
    // 200 com corpo, e nao 204: a tela le response.json() em toda escrita.
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (error) {
    if (error instanceof BlackoutNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    console.error('[DELETE /api/admin/blackouts/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
