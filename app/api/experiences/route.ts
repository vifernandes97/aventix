// GET /api/experiences — catalogo PUBLICO (CLAUDE.md secao 7.1).
//
// Rota publica, sem autenticacao: o formulario de agendamento a consome antes de
// qualquer login. Mesma natureza de /api/availability.
//
// >>> O QUE ELA DEVOLVE, E O QUE NAO DEVOLVE <<<
// So experiencias ATIVAS, e so os campos que o cliente precisa para escolher.
// Inativa nao aparece: o dono a tirou da venda, e listar seria oferecer o que
// nao esta a venda. `active` tambem NAO vai no payload — se toda linha e ativa,
// o campo so contaria ao mundo que existe um conceito de inativa.
//
// NAO CONFUNDIR com GET /api/admin/experiences, que devolve ativas E inativas,
// atras de sessao. Sao dois publicos diferentes com dois contratos diferentes,
// e por isso duas rotas em vez de uma com flag.
//
// TODO(Fase 4 — hardening): publica, sem auth, uma consulta ao banco por
// chamada. Precisa de rate limiting por IP antes do go-live, como
// /api/availability.

import { NextResponse } from 'next/server';

import { listPublicExperiences } from '@/lib/experiences';

// O catalogo muda quando o dono edita no admin, e a tela de agendamento nao
// pode oferecer uma trilha que saiu do ar ha dez minutos.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ experiences: await listPublicExperiences() }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/experiences] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
