// GET /api/availability — expõe o motor de disponibilidade (CLAUDE.md secao 7.1).
//
// Camada FINA sobre getAvailability. Toda a regra vive em lib/availability.ts
// (secao 6); aqui so acontecem tres coisas: converter query string em tipos,
// validar a entrada e traduzir erro tipado em status HTTP.
//
// Rota PUBLICA, sem autenticacao: o formulario de agendamento a consome antes de
// qualquer login.
//
// TODO(Fase 4 — hardening): esta rota e publica, sem auth, e cada chamada faz
// consulta ao banco. Precisa de rate limiting por IP antes do go-live.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ExperienceNotFoundError,
  InvalidDateError,
  InvalidResourcesNeededError,
  getAvailability,
} from '@/lib/availability';
import { isValidCalendarDate } from '@/lib/time';

// A disponibilidade depende de now() e do estado do banco. Cachear estaticamente
// serviria grade velha — horario ja vendido continuaria aparecendo.
export const dynamic = 'force-dynamic';

// Query string chega SEMPRE como texto: z.coerce faz a conversao antes de validar.
const querySchema = z.object({
  experienceId: z.coerce
    .number({ message: 'experienceId: obrigatorio e deve ser um inteiro' })
    .int('experienceId: deve ser um inteiro')
    .positive('experienceId: deve ser maior que zero'),

  // Sem default de proposito: o formulario pergunta o numero de recursos ANTES
  // de pedir a grade (secao 6, passo 3), entao o cliente sempre sabe quantos
  // quer. Assumir 1 aqui esconderia um bug do chamador e devolveria uma grade
  // que nao corresponde ao que ele vai reservar.
  resourcesNeeded: z.coerce
    .number({ message: 'resourcesNeeded: obrigatorio e deve ser um inteiro' })
    .int('resourcesNeeded: deve ser um inteiro')
    .min(1, 'resourcesNeeded: deve ser no minimo 1'),

  // Formato E existencia no calendario: '2026-02-30' casa com o regex mas nao
  // existe, e sem essa checagem viraria silenciosamente 02/03 — a grade do dia
  // errado. isValidCalendarDate (lib/time.ts) ja faz as duas coisas.
  date: z
    .string({ message: 'date: obrigatorio no formato YYYY-MM-DD' })
    .refine(isValidCalendarDate, 'date: esperado YYYY-MM-DD de calendario valido'),
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const parsed = querySchema.safeParse({
    experienceId: params.get('experienceId') ?? undefined,
    resourcesNeeded: params.get('resourcesNeeded') ?? undefined,
    date: params.get('date') ?? undefined,
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

  try {
    // Repassa o resultado do motor INTEGRALMENTE: { slots, dayState }.
    // Nao reduzir para so os slots — o dayState e o que permite a tela
    // distinguir "fechado nesse dia" de "aberto, mas sem vaga" (secao 7.1).
    // slots vazio com dayState 'open' e 200 valido, nunca 404.
    const result = await getAvailability(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    // 404 — a experiencia pedida nao existe ou esta inativa
    if (error instanceof ExperienceNotFoundError) {
      return NextResponse.json({ error: 'experiencia nao encontrada' }, { status: 404 });
    }

    // 400 — entrada invalida que so o dominio sabe reprovar (o teto de
    // resourcesNeeded depende do numero de recursos ativos do tenant).
    // Erro de negocio NUNCA e 500: nao houve falha do servidor.
    if (error instanceof InvalidResourcesNeededError || error instanceof InvalidDateError) {
      return NextResponse.json({ error: 'parametros invalidos', detail: error.message }, { status: 400 });
    }

    // 500 — o detalhe vai para o log do servidor, nunca para a resposta
    console.error('[GET /api/availability] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
