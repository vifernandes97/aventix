// PUT/DELETE /api/admin/schedule-exceptions/{id} (CLAUDE.md secoes 6 e 7.2).
//
// Camada FINA sobre lib/schedule-exceptions.ts. Autenticacao pelo proxy.ts e
// tenant por getTenantId(), como na rota irma — ver o cabecalho de ../route.ts.
//
// >>> PUT, e nao PATCH — a diferenca em relacao a experiences e deliberada <<<
// Os campos de uma excecao sao INTERDEPENDENTES: `schedule_exceptions_closed_check`
// exige que dia aberto tenha opens e closes com closes > opens. Um PATCH parcial
// aceitaria `{ fechado: false }` sozinho sobre uma linha de dia fechado (horarios
// em NULL) — corpo plausivel, 500 do banco. PUT com a linha inteira faz a
// validacao de borda conseguir julgar sozinha se o resultado e legal.
//
// >>> AQUI EXISTE DELETE <<<
// Nada referencia schedule_exceptions, entao apagar nao deixa orfao nem quebra
// FK. E apagar NAO cancela reserva: a vaga vendida vive em
// reservation_resources.period, congelada na venda (secao 4.6). A grade governa
// o que ainda PODE SER VENDIDO — nunca o que ja foi.

import { NextResponse } from 'next/server';

import {
  ScheduleExceptionDateTakenError,
  ScheduleExceptionNotFoundError,
  deleteScheduleException,
  updateScheduleException,
} from '@/lib/schedule-exceptions';

import { exceptionSchema, toDomainInput, validationErrorBody } from '../validation';

export const dynamic = 'force-dynamic';

const NOT_FOUND = { error: 'excecao nao encontrada' };

/**
 * A coluna e `serial`. Um id nao numerico ('abc') faria o Postgres abortar com
 * 22P02 e a rota viraria 500 — mesma armadilha das rotas de reserva, onde o id
 * e uuid. Malformado responde 404, igual a inexistente e a excecao de outro
 * tenant: distinguir os tres so ajudaria quem esta sondando.
 */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const exceptionId = parseId((await context.params).id);
  if (exceptionId === null) return NextResponse.json(NOT_FOUND, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'corpo invalido: esperado JSON' }, { status: 400 });
  }

  const parsed = exceptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const exception = await updateScheduleException(exceptionId, toDomainInput(parsed.data));
    return NextResponse.json({ exception }, { status: 200 });
  } catch (error) {
    if (error instanceof ScheduleExceptionNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    // Mover a excecao para uma data que ja tem outra. Mesmo 409 do POST.
    if (error instanceof ScheduleExceptionDateTakenError) {
      return NextResponse.json(
        { error: 'ja existe uma excecao para essa data', code: 'data_ocupada', date: error.date },
        { status: 409 },
      );
    }

    console.error('[PUT /api/admin/schedule-exceptions/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const exceptionId = parseId((await context.params).id);
  if (exceptionId === null) return NextResponse.json(NOT_FOUND, { status: 404 });

  try {
    await deleteScheduleException(exceptionId);
    // 200 com corpo, e nao 204: a tela do admin le `response.json()` em todas as
    // respostas de escrita (o padrao que experiences estabeleceu), e um 204 sem
    // corpo faria esse parse lancar — erro na tela depois de uma operacao que
    // deu certo.
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (error) {
    if (error instanceof ScheduleExceptionNotFoundError) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    console.error('[DELETE /api/admin/schedule-exceptions/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
