// POST /api/admin/login — abre a sessao do admin (CLAUDE.md secao 13).
//
// Rota de admin que NAO exige sessao (a excecao vive em isProtectedPath, em
// lib/auth.ts). Camada FINA: nao compara senha, nao monta cookie, nao le
// process.env — so traduz corpo HTTP em chamada de lib/auth.ts e resultado em
// status.
//
// TODO(Fase 4 — hardening): ROTA DE LOGIN E ALVO PRIMARIO DE FORCA BRUTA.
// Hoje aceita tentativas ilimitadas. Antes do go-live precisa de rate limiting
// por IP + atraso progressivo (e, quando houver mais de um usuario, bloqueio
// temporario por conta). O custo do bcrypt (~250ms) atrasa um atacante, mas nao
// e defesa: nao impede milhares de tentativas em paralelo.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSession, verifyCredentials } from '@/lib/auth';

// Login depende de segredo do ambiente e escreve cookie: nada a cachear.
export const dynamic = 'force-dynamic';

/**
 * MENSAGEM UNICA para qualquer falha de credencial.
 *
 * Nunca diga "email nao encontrado" ou "senha incorreta": a diferenca conta a
 * quem tenta adivinhar QUAL das duas metades ele ja acertou, transformando um
 * problema de duas incognitas em dois problemas de uma.
 */
const GENERIC_ERROR = 'Credenciais invalidas';

// Validacao proposital de tamanho minimo 1 e nada mais: regra de formato ou de
// forca de senha AQUI so serviria para revelar o formato da credencial valida.
const bodySchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    // Corpo ilegivel tambem responde a mensagem generica, e nao "JSON invalido":
    // do ponto de vista de quem sonda, e a mesma resposta de credencial errada.
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  try {
    const ok = await verifyCredentials(parsed.data.email, parsed.data.password);

    if (!ok) {
      // O log registra a TENTATIVA, jamais o email tentado nem a senha: um log
      // de login falho com o email dentro vira lista de alvos se vazar.
      console.warn('[POST /api/admin/login] tentativa de login recusada');
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    await createSession(parsed.data.email);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    // Cai aqui quando a configuracao de ambiente esta quebrada (ADMIN_* ou
    // SESSION_SECRET ausente/mal formado). E erro do SERVIDOR, nao credencial
    // errada — devolver 401 aqui faria o dono trocar a senha achando que
    // esqueceu, enquanto o problema esta no .env.
    console.error('[POST /api/admin/login] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
