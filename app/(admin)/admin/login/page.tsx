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
  const [showPassword, setShowPassword] = useState(false);
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
          {/* O botao de mostrar/ocultar fica DENTRO do campo (posicao absoluta);
              o input ganha pr-10 para o texto nao correr por baixo do icone. */}
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded border py-2 pl-3 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              // aria-label e title descrevem a ACAO (o que o clique fara);
              // aria-pressed comunica o estado atual ao leitor de tela.
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              aria-pressed={showPassword}
              aria-controls="password"
              // tabIndex -1: nao entra no fluxo de Tab entre os campos; o usuario
              // que usa teclado envia o form direto, e quem quer ver a senha
              // clica com o mouse.
              tabIndex={-1}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 hover:text-neutral-700"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
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

// Icones do toggle de senha: SVG inline, sem dependencia (mesma linha da nav).
// aria-hidden porque a semantica ja esta no aria-label do botao.

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a15.8 15.8 0 0 1-3.4 3.9" />
      <path d="M6.6 7.6A15.6 15.6 0 0 0 2.5 12S6 18 12 18a9.5 9.5 0 0 0 3.5-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
