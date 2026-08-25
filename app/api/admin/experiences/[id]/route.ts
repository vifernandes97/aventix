// PATCH /api/admin/experiences/{id} — edita uma experiencia (CLAUDE.md secao 7.2).
//
// Camada FINA sobre lib/experiences.ts. Autenticacao pelo proxy.ts e tenant por
// getTenantId(), como na rota irma — ver o cabecalho de ../route.ts.
//
// >>> POR QUE NAO EXISTE DELETE AQUI <<<
// reservations.experience_id referencia esta tabela: apagar quebraria o
// historico, ou seria barrado pela FK. Desativar e `PATCH { ativo: false }`, que
// tira a experiencia da venda, preserva as reservas e e reversivel.
//
// Editar duracao, buffer ou preco NAO afeta reserva ja vendida: os tres sao
// congelados na reserva (migration 0001 e total_price_cents). E o que permite
// esta tela existir sem trava nenhuma.

import { NextResponse } from 'next/server';

import { ExperienceNotFoundError, updateExperience } from '@/lib/experiences';

import { patchSchema, validationErrorBody } from '../validation';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // A coluna e `serial`. Um id nao numerico ('abc') faria o Postgres abortar com
  // 22P02 e a rota viraria 500 — mesma armadilha das rotas de reserva, onde o
  // id e uuid. Malformado responde 404, igual a inexistente e a experiencia de
  // outro tenant: distinguir os tres so ajudaria quem esta sondando.
  const experienceId = Number(id);
  if (!Number.isInteger(experienceId) || experienceId <= 0) {
    return NextResponse.json({ error: 'experiencia nao encontrada' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'corpo invalido: esperado JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  const { nome, duracaoMinutos, bufferMinutos, precoCentavos, modoPagamento, idadeMinimaGarupa, ativo } =
    parsed.data;

  try {
    const experience = await updateExperience(experienceId, {
      name: nome,
      durationMinutes: duracaoMinutos,
      bufferMinutes: bufferMinutos,
      priceCents: precoCentavos,
      paymentMode: modoPagamento,
      minPassengerAge: idadeMinimaGarupa,
      active: ativo,
    });

    return NextResponse.json({ experience }, { status: 200 });
  } catch (error) {
    if (error instanceof ExperienceNotFoundError) {
      return NextResponse.json({ error: 'experiencia nao encontrada' }, { status: 404 });
    }

    console.error('[PATCH /api/admin/experiences/{id}] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
