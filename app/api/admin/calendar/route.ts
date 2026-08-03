// GET /api/admin/calendar — leitura do calendario do admin (CLAUDE.md secoes 7.2 e 11.1).
//
// Camada FINA sobre lib/calendar.ts, mesmo padrao de /api/availability sobre
// lib/availability.ts: aqui so acontecem tres coisas — converter query string em
// tipos, validar a entrada e projetar o payload conforme a view.
//
// AUTENTICACAO: nao ha checagem aqui de proposito. `/api/admin/*` esta no matcher
// do proxy.ts, que responde 401 em JSON antes de esta funcao ser chamada. Repetir
// a verificacao aqui daria a impressao de que a rota se protege sozinha e
// convidaria alguem a tirar o caminho do matcher um dia.
//
// SOMENTE LEITURA. O painel de detalhes e o cancelamento sao a proxima tarefa.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  CALENDAR_VIEWS,
  datesBetween,
  getCalendarReservations,
  toSummary,
} from '@/lib/calendar';
import { isValidCalendarDate } from '@/lib/time';

// Depende do estado do banco e da sessao. Cachear serviria agenda velha — reserva
// recem-confirmada sumindo da tela do dono e pior que uma tela lenta.
export const dynamic = 'force-dynamic';

/**
 * Teto do periodo. A view de mes pede no maximo 6 semanas (42 dias); 62 deixa
 * folga para qualquer view sem permitir que uma URL montada a mao peca dois anos
 * de agenda numa consulta.
 */
const MAX_RANGE_DAYS = 62;

const calendarDate = (param: string) =>
  z
    .string({ message: `${param}: obrigatorio no formato YYYY-MM-DD` })
    // Formato E existencia: '2026-02-30' casa com o regex e nao existe no
    // calendario; sem esta checagem viraria 02/03 silenciosamente.
    .refine(isValidCalendarDate, `${param}: esperado YYYY-MM-DD de calendario valido`);

const bothValid = (q: { from: string; to: string }) =>
  isValidCalendarDate(q.from) && isValidCalendarDate(q.to);

const querySchema = z
  .object({
    from: calendarDate('from'),
    to: calendarDate('to'),
    view: z.enum(CALENDAR_VIEWS, { message: `view: esperado um de ${CALENDAR_VIEWS.join(', ')}` }),
  })
  // As duas checagens abaixo so fazem sentido sobre datas VALIDAS. Sem esta
  // guarda, `from=2026-13-01` produz dois erros — o de formato e um "from nao
  // pode ser posterior a to" comparando lixo — e o segundo manda quem le para o
  // lado errado. Refinamento de objeto no Zod roda mesmo com issue nos campos.
  .refine((q) => !bothValid(q) || q.from <= q.to, {
    message: 'nao pode ser posterior a to',
    path: ['from'],
  })
  // Comparacao de string funciona porque YYYY-MM-DD e ordenavel lexicograficamente.
  .refine((q) => !bothValid(q) || datesBetween(q.from, q.to).length <= MAX_RANGE_DAYS, {
    message: `periodo maximo de ${MAX_RANGE_DAYS} dias`,
    path: ['to'],
  });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const parsed = querySchema.safeParse({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    view: params.get('view') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'parametros invalidos',
        fields: parsed.error.issues.map((issue) => ({
          param: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { from, to, view } = parsed.data;

  try {
    const reservations = await getCalendarReservations({ from, to });

    // Secao 11.1: a granularidade do PAYLOAD acompanha a view. Mes leva so
    // horario + trilha + status; nome de cliente e alocacao de recurso nao
    // atravessam a rede para uma tela que nao os desenha.
    return NextResponse.json(
      {
        view,
        from,
        to,
        reservations: view === 'month' ? reservations.map(toSummary) : reservations,
      },
      { status: 200 },
    );
  } catch (error) {
    // O detalhe vai para o log do servidor, nunca para a resposta.
    console.error('[GET /api/admin/calendar] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
