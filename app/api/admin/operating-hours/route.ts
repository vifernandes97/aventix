// GET/POST /api/admin/operating-hours — grade semanal (CLAUDE.md secoes 4.3 e 6).
//
// Camada FINA sobre lib/operating-hours.ts. Autenticacao pelo proxy.ts (que
// responde 401 antes desta funcao rodar) e tenant por getTenantId() — nunca do
// corpo. Ver o cabecalho de /api/admin/experiences/route.ts.

import { NextResponse } from 'next/server';

import {
  OperatingHoursOverlapError,
  createOperatingHours,
  listOperatingHours,
} from '@/lib/operating-hours';

import { overlapResponse, rangeSchema, validationErrorBody } from './validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ hours: await listOperatingHours() }, { status: 200 });
  } catch (error) {
    console.error('[GET /api/admin/operating-hours] erro inesperado:', error);
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

  const parsed = rangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorBody(parsed.error), { status: 422 });
  }

  try {
    const range = await createOperatingHours({
      weekday: parsed.data.diaDaSemana,
      opens: parsed.data.abre,
      closes: parsed.data.fecha,
    });
    return NextResponse.json({ range }, { status: 201 });
  } catch (error) {
    if (error instanceof OperatingHoursOverlapError) return overlapResponse(error);

    console.error('[POST /api/admin/operating-hours] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
