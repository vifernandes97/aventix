// POST /api/admin/logout — encerra a sessao do admin (CLAUDE.md secao 13).
//
// PROTEGIDA pelo proxy (esta sob /api/admin/ e nao esta na lista de excecoes de
// isProtectedPath). Consequencia assumida: deslogar sem sessao valida devolve
// 401 em vez de redirecionar. Nao e problema — quem nao tem sessao ja esta
// deslogado, e o proxy manda a tela para o login de qualquer forma.
//
// So POST: logout por GET seria disparavel por um <img src> em qualquer pagina
// que o dono abrisse, derrubando a sessao dele de fora.

import { NextResponse } from 'next/server';

import { destroySession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  await destroySession();

  // 303 e o status certo depois de um POST: obriga o navegador a seguir com GET.
  // Com 302 alguns clientes repetem o POST no destino.
  const loginUrl = new URL('/admin/login', request.url);
  return NextResponse.redirect(loginUrl, 303);
}
