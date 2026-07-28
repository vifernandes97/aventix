// Painel do admin — PLACEHOLDER (CLAUDE.md secoes 13 e 14).
//
// ESTA TELA AINDA NAO E O PRODUTO. A secao 14 reserva este caminho para o
// CALENDARIO NATIVO (secao 11.1), que e a proxima tarefa da Fase 3. O que existe
// aqui hoje e o minimo para que a autenticacao seja verificavel ponta a ponta:
// uma rota protegida de verdade, que le a identidade pela fronteira e oferece
// saida. Sem ela nao haveria como provar que o cookie funciona.
//
// Server Component: chama getCurrentUser() direto, sem fetch. E o padrao que as
// demais telas de admin devem seguir.

import { getCurrentUser } from '@/lib/auth';

// A sessao vem de cookie; renderizar estaticamente serviria a pagina de um
// usuario para o proximo.
export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  // O proxy ja barrou quem nao tem sessao, entao aqui o usuario existe. A
  // leitura serve para EXIBIR a identidade, nao para autorizar de novo.
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Painel</h1>

        {/* Formulario HTML puro em vez de fetch: logout nao precisa de estado de
            cliente, e assim a tela continua funcionando sem JavaScript. */}
        <form action="/api/admin/logout" method="post">
          <button type="submit" className="rounded border px-3 py-1.5 text-sm">
            Sair
          </button>
        </form>
      </header>

      <p className="text-sm">
        Sessao ativa: <strong>{user?.email}</strong>
      </p>

      <p className="text-sm text-neutral-500">
        Calendario, reservas, clientes e configuracoes entram aqui nas proximas
        tarefas da Fase 3.
      </p>
    </main>
  );
}
