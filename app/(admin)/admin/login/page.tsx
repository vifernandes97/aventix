// Tela de login do admin (CLAUDE.md secoes 13 e 14).
//
// Caminho conforme a arvore da secao 14: `/app/(admin)/admin/login/page.tsx`.
// `(admin)` e route group — parenteses nao entram na URL, entao a rota publicada
// e /admin/login.
//
// Client Component porque o formulario tem estado (erro, "entrando..."). Por
// isso ele NAO importa lib/auth.ts, que e server-only e le segredos: a conversa
// e por fetch com /api/admin/login. Manter esta separacao e o que impede um
// segredo de ambiente ser empacotado no bundle do navegador.

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AdminLoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // replace, nao push: o botao "voltar" nao deve trazer o usuario de volta
        // para a tela de login ja autenticado.
        router.replace('/admin');
        // Sem o refresh, o Server Component de /admin pode ser servido do cache
        // do roteador, de quando ainda nao havia sessao.
        router.refresh();
        return;
      }

      // A API ja devolve a mensagem generica; o fallback cobre resposta sem corpo.
      const data = await response.json().catch(() => null);
      setError(data?.error ?? 'Nao foi possivel entrar. Tente novamente.');
    } catch {
      // Falha de rede e coisa distinta de credencial errada, e aqui pode dizer:
      // nao revela nada sobre a credencial.
      setError('Falha de conexao. Verifique a internet e tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Entrar no painel</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border px-3 py-2"
          />
        </div>

        {/* role="alert" para que leitor de tela anuncie o erro, que aparece
            depois do envio e fora do fluxo de leitura. */}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
