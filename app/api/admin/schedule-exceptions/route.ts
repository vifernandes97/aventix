// GET/POST /api/admin/schedule-exceptions — excecoes de agenda (secoes 6 e 7.2).
//
// Camada FINA sobre lib/schedule-exceptions.ts, mesmo padrao de
// /api/admin/experiences sobre lib/experiences.ts: converter corpo em tipos,
// validar, delegar.
//
// AUTENTICACAO: nao ha checagem aqui de proposito. `/api/admin/*` esta no
// matcher do proxy.ts, que responde 401 em JSON antes desta funcao rodar.
// Repetir a verificacao daria a impressao de que a rota se protege sozinha e
// convidaria alguem a tirar o caminho do matcher um dia.
//
// TENANT: resolvido por getTenantId() dentro da lib. NUNCA vem do corpo —
// aceitar tenant do cliente seria deixar mexer na agenda dos outros.
//
// EXISTE DELETE na rota irma, ao contrario de experiences. Ver o cabecalho de
// lib/schedule-exceptions.ts sobre por que aqui e seguro e la nao e.

import { NextResponse } from 'next/server';

import {
  ScheduleExceptionDateTakenError,
  createScheduleException,
  listScheduleExceptions,
} from '@/lib/schedule-exceptions';

import { exceptionSchema, toDomainInput, validationErrorBody } from './validation';

// A grade muda quando o dono edita, e a tela precisa refletir na hora.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ exceptions: await listScheduleExceptions() }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/admin/schedule-exceptions] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // JSON quebrado e 400: o pedido nao chegou a ser compreensivel. Distinto do
    // 422 abaixo, onde o corpo foi entendido e as regras e que nao passam.
    return NextResponse.json({ error: 'corpo invalido: esperado JSON' }, { status: 400 });
  }

  const parsed = exceptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const exception = await createScheduleException(toDomainInput(parsed.data));
    return NextResponse.json({ exception }, { status: 201 });
  } catch (error) {
    // 409, nao 422: o corpo esta correto — o que conflita e o ESTADO do banco
    // (ja existe excecao para a data). A tela usa a distincao para oferecer
    // editar a excecao existente, em vez de acusar de invalida uma data que o
    // dono digitou certo. O `date` volta no corpo para a tela achar a linha.
    if (error instanceof ScheduleExceptionDateTakenError) {
      return NextResponse.json(
        { error: 'ja existe uma excecao para essa data', code: 'data_ocupada', date: error.date },
        { status: 409 },
      );
    }

    console.error('[POST /api/admin/schedule-exceptions] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
