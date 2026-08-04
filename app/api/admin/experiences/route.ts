// GET/POST /api/admin/experiences — catalogo de experiencias (CLAUDE.md secao 7.2).
//
// Camada FINA sobre lib/experiences.ts, mesmo padrao de /api/admin/calendar
// sobre lib/calendar.ts: converter corpo em tipos, validar, delegar.
//
// AUTENTICACAO: nao ha checagem aqui de proposito. `/api/admin/*` esta no
// matcher do proxy.ts, que responde 401 em JSON antes desta funcao rodar.
// Repetir a verificacao daria a impressao de que a rota se protege sozinha e
// convidaria alguem a tirar o caminho do matcher um dia.
//
// TENANT: resolvido por getTenantId() dentro de lib/experiences.ts. NUNCA vem do
// corpo — aceitar tenant do cliente seria entregar o catalogo dos outros.
//
// NAO EXISTE DELETE nesta rota nem na irma. Desativar e PATCH { ativo: false }.

import { NextResponse } from 'next/server';

import { createExperience, listExperiences } from '@/lib/experiences';

import { createSchema, validationErrorBody } from './validation';

// Catalogo muda quando o dono edita, e a tela precisa refletir na hora.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Ativas E inativas: a tela nao esconde as desativadas (ver o comentario de
    // listExperiences sobre por que sumir seria pior que esmaecer).
    return NextResponse.json({ experiences: await listExperiences() }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/admin/experiences] erro inesperado:', error);
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

  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  const { nome, duracaoMinutos, bufferMinutos, precoCentavos, modoPagamento } = parsed.data;

  try {
    const experience = await createExperience({
      name: nome,
      durationMinutes: duracaoMinutos,
      bufferMinutes: bufferMinutos,
      priceCents: precoCentavos,
      paymentMode: modoPagamento,
    });

    return NextResponse.json({ experience }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/admin/experiences] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
