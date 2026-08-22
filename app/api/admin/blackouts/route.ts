// GET/POST /api/admin/blackouts — bloqueios pontuais (CLAUDE.md secoes 4.3 e 6).
//
// Camada FINA sobre lib/blackouts.ts. Autenticacao pelo proxy.ts e tenant por
// getTenantId() — ver o cabecalho de /api/admin/experiences/route.ts.

import { NextResponse } from 'next/server';

import {
  BlackoutResourceNotFoundError,
  createBlackout,
  listBlackouts,
} from '@/lib/blackouts';

import { blackoutSchema, validationErrorBody } from './validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ blackouts: await listBlackouts() }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/admin/blackouts] erro inesperado:', error);
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

  const parsed = blackoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const blackout = await createBlackout({
      resourceId: parsed.data.recursoId,
      startLocal: parsed.data.inicio,
      endLocal: parsed.data.fim,
      reason: parsed.data.motivo,
    });
    return NextResponse.json({ blackout }, { status: 201 });
  } catch (error) {
    // 422 e nao 404: o recurso e um campo do CORPO, nao o alvo da rota. Um
    // 404 aqui diria que o BLOQUEIO nao existe, que nao e o caso.
    if (error instanceof BlackoutResourceNotFoundError) {
      return NextResponse.json(
        {
          error: 'dados invalidos',
          fields: [{ param: 'recursoId', message: 'recursoId: recurso não encontrado' }],
        },
        { status: 422 },
      );
    }

    console.error('[POST /api/admin/blackouts] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
