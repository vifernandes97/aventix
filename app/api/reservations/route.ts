// POST /api/reservations — cria a reserva ponta a ponta (CLAUDE.md secao 7.1).
//
// A rota nao tem regra de negocio: valida a FORMA do corpo, captura o que so
// ela enxerga (IP e user-agent do aceite) e traduz os erros tipados de
// lib/reservations.ts em status HTTP. A transacao inteira vive em
// createReservation.
//
// NAO HA PROTECAO CONTRA DUPLO CLIQUE. Duas requisicoes identicas em sequencia
// criam DUAS reservas quando ha recursos sobrando — com os 2 quadris do Quadri
// Club e resourcesNeeded=1, isso e alcancavel. A defesa natural e desabilitar o
// botao no formulario (Fase 3); se ainda ocorrer depois disso, entra chave de
// idempotencia no corpo. Registrado de proposito, sem solucao inventada agora.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { InvalidDateError, ExperienceNotFoundError, InvalidResourcesNeededError } from '@/lib/availability';
import { createChargeForReservation } from '@/lib/payments/charge';
import {
  PaymentProviderAuthError,
  PaymentProviderConfigError,
} from '@/lib/payments/provider';
import {
  InvalidCompositionError,
  InvalidCustomerDataError,
  InvalidPhoneError,
  SlotUnavailableError,
  createReservation,
} from '@/lib/reservations';

export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'esperado YYYY-MM-DD');

/** Instante ISO. Validado aqui para virar 400 (forma), nao 422 (regra de negocio). */
const isoInstant = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'esperado data/hora ISO 8601');

const bodySchema = z.object({
  experienceId: z.number().int().positive(),
  startAt: isoInstant,
  resourcesNeeded: z.number().int().positive(),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    email: z.string().nullish(),
    cpf: z.string().nullish(),
    birthdate: isoDate.nullish(),
  }),
  participants: z
    .array(
      z.object({
        name: z.string().min(1),
        birthdate: isoDate.nullish(),
        role: z.enum(['operator', 'passenger']),
        documentNumber: z.string().nullish(),
      }),
    )
    .min(1),
  termo: z.object({
    version: z.string().min(1),
    acceptedAt: isoInstant,
  }),
  emergencyContact: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
  }),
  channel: z.string().nullish(),
});

/**
 * IP de origem. Atras do proxy do VPS, o real esta no PRIMEIRO valor de
 * x-forwarded-for (os seguintes sao os proxies). E prova juridica do aceite
 * (secao 10) — so a rota tem acesso a ele.
 */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim() || null;
  return request.headers.get('x-real-ip');
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'corpo invalido', detail: 'JSON malformado' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'corpo invalido',
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await createReservation({
      ...parsed.data,
      acceptance: {
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
      },
    });

    // Passo 5 da secao 5.2, FORA da transacao acima. A rota costura os dois
    // porque cada um tem escopo transacional proprio e porque e aqui que os
    // erros ja viram HTTP. Falha aqui dentro JA deixou a reserva `expired` e a
    // vaga livre (caso de borda 9) — o catch abaixo so escolhe o status.
    const payment = await createChargeForReservation(result.reservationId);

    return NextResponse.json({ ...result, payment }, { status: 201 });
  } catch (error) {
    // 404 — experiencia inexistente ou inativa
    if (error instanceof ExperienceNotFoundError) {
      return NextResponse.json({ error: 'experiencia nao encontrada' }, { status: 404 });
    }

    // 409 — grade mudou entre a consulta e o POST, ou corrida perdida
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json(
        { error: 'horario indisponivel', detail: error.reason },
        { status: 409 },
      );
    }

    // 422 — o corpo esta bem formado, mas a composicao viola regra de negocio
    if (error instanceof InvalidCompositionError) {
      return NextResponse.json(
        { error: 'composicao invalida', detail: error.reason },
        { status: 422 },
      );
    }

    // 400 — dado de entrada invalido que so o dominio sabe reprovar
    if (
      error instanceof InvalidResourcesNeededError ||
      error instanceof InvalidPhoneError ||
      error instanceof InvalidCustomerDataError ||
      error instanceof InvalidDateError
    ) {
      return NextResponse.json({ error: 'dados invalidos', detail: error.message }, { status: 400 });
    }

    // 500 — falha de CONFIGURACAO do provedor de pagamento. E problema nosso,
    // nao do cliente e nao do provedor: repetir nao adianta enquanto o ambiente
    // nao for corrigido. A mensagem do erro (que cita a causa provavel) fica no
    // log do servidor; a resposta nao vaza nada sobre credencial.
    if (error instanceof PaymentProviderConfigError || error instanceof PaymentProviderAuthError) {
      console.error('[POST /api/reservations] pagamento mal configurado:', error.message);
      return NextResponse.json(
        {
          error: 'pagamento indisponivel',
          detail: 'Nao foi possivel gerar a cobranca. A reserva foi liberada; tente novamente em instantes.',
        },
        { status: 500 },
      );
    }

    // 502 — o provedor de pagamento falhou (timeout, rede, recusa da API). A
    // reserva ja foi expirada e a vaga liberada; o cliente pode tentar de novo.
    if (error instanceof Error && error.name.startsWith('PaymentProvider')) {
      console.error('[POST /api/reservations] falha ao criar cobranca:', error.message);
      return NextResponse.json(
        {
          error: 'falha ao gerar a cobranca',
          detail: 'Nao foi possivel gerar o Pix agora. A reserva foi liberada; tente novamente.',
        },
        { status: 502 },
      );
    }

    // 500 — loga o detalhe no servidor, nunca vaza na resposta
    console.error('[POST /api/reservations] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
