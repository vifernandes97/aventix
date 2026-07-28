// Aventix — protecao das rotas de admin (CLAUDE.md secao 13).
//
// Next 16: este arquivo se chama `proxy.ts` e exporta `proxy`. E o antigo
// middleware renomeado; `middleware.ts` esta deprecado. Roda em runtime Node,
// que e o que permite a cadeia bcrypt/iron-session de lib/auth.ts resolver aqui.
//
// ESTE ARQUIVO NAO DECIDE NADA SOBRE AUTENTICACAO. Ele pergunta a lib/auth.ts
// (isProtectedPath, getUserFromRequest) e traduz a resposta em HTTP. Nao le
// cookie, nao le process.env, nao sabe o nome do cookie. Ver o cabecalho de
// lib/auth.ts para o porque.

import { NextResponse, type NextRequest } from 'next/server';

import { getUserFromRequest, isProtectedPath } from '@/lib/auth';

/**
 * ============================================================================
 * MATCHER — a lista mais perigosa do arquivo.
 * ============================================================================
 *
 * O proxy so e INVOCADO nestes dois prefixos. Todo o resto do site nao passa
 * por aqui de forma alguma: nem custo, nem risco de bloqueio acidental.
 *
 * >>> NUNCA acrescente /api/webhooks a este matcher. <<<
 * O webhook do Asaas (Fase 2) e chamado pelo Asaas, que nao tem sessao. Um 401
 * do proxy ali significa pagamento nao confirmado e, apos 15 falhas, fila de
 * webhook INTERROMPIDA (CLAUDE.md secao 8.1). O sintoma no cliente e
 * "paguei e a reserva nao confirmou", que nao aponta para este arquivo — e
 * exatamente o tipo de bug que custa um dia para achar.
 *
 * As rotas publicas (/, /reserva/*, /agenda/*, /api/availability,
 * /api/reservations, /api/termo, /api/shared/*) tambem ficam fora, pelo mesmo
 * mecanismo: nao casam com nenhum dos dois padroes.
 *
 * `:path*` casa zero ou mais segmentos, entao '/admin' (exato) e '/admin/x'
 * entram os dois.
 */
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Segunda barreira, redundante com o matcher de proposito: /admin/login e
  // /api/admin/login casam com o matcher (sao /admin/*), entao e AQUI que eles
  // sao liberados. Sem isto, logar seria impossivel — a tela de login exigiria
  // estar logado para ser exibida.
  if (!isProtectedPath(pathname)) return NextResponse.next();

  const user = await getUserFromRequest(request);
  if (user) return NextResponse.next();

  // Sem sessao. A resposta depende de quem perguntou:

  // API responde 401 em JSON. Redirecionar uma chamada fetch para uma pagina
  // HTML de login entregaria 200 com HTML onde o cliente espera JSON — o erro
  // apareceria como falha de parse, longe da causa.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'nao autenticado' }, { status: 401 });
  }

  // Tela vai para o login. Sem parametro `next` de retorno de proposito: um
  // destino vindo da URL e superficie de open redirect e exigiria validacao
  // propria, para uma comodidade que um admin de usuario unico nao sente.
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}
