// Raiz de app.aventix.com.br — porta da PLATAFORMA, nao de nenhum tenant.
//
// ============================================================================
// >>> POR QUE A RAIZ NAO SERVE MAIS A LP DO QUADRI CLUB <<<
//
// Ate 23/08 este arquivo era o formulario publico de agendamento. Ele mudou de
// endereco para /agendamento/{slug} e a raiz ficou sem dono — de proposito.
//
// `app.aventix.com.br` e o endereco da plataforma; `aventix.com.br` sera o site
// comercial. Nenhum dos dois pertence a um cliente. Enquanto existe um tenant
// so, "a raiz e a LP do Quadri Club" parece economia; no dia do segundo cliente
// vira uma escolha que ninguem consegue justificar, e desfaze-la ja custaria
// mexer num endereco divulgado.
//
// >>> POR QUE LOGIN, E NAO REDIRECT PARA /agendamento/quadriclub <<<
// Mandar a raiz para a LP de um tenant especifico e o mesmo erro com outra
// roupa, e pior: ficaria escondido atras de um redirect. Quem chega na raiz sem
// contexto e o DONO (ou eu). O cliente final chega pelo link do ManyChat, que
// aponta direto para a LP.
//
// >>> 307, NUNCA 308 <<<
// `redirect()` do App Router emite 307 (temporario). E o que a secao 2-B exige,
// e o motivo e concreto: um 308 fica cacheado no navegador praticamente para
// sempre e SEQUESTRA a raiz no dia em que o site comercial nascer — inclusive
// nos navegadores de quem visitou antes, que e justamente quem mais importa.
//
// NAO use `permanentRedirect()` aqui. Ele emite 308.
// ============================================================================
//
// NAO E ROTA PROTEGIDA: `proxy.ts` so cobre /admin e /api/admin. Esta pagina
// apenas APONTA para o login; quem decide se ha sessao e o proxy, quando o
// navegador chegar em /admin/login.

import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/admin/login');
}
