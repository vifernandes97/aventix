// Botao que alterna a sidebar do admin entre recolhida e expandida (desktop).
//
// >>> POR QUE ISTO E CLIENT, E SO ISTO <<<
// A AdminNav continua Server Component (a pagina ativa vem por prop, secao 11.1
// e comentario de admin-nav.tsx). O UNICO pedaco que precisa de interacao e este
// botao — mantido minusculo de proposito para nao arrastar a nav para o cliente.
//
// O estado NAO vive aqui: a fonte da verdade e o atributo `data-collapsed` no
// shell do admin (`[data-admin-shell]`, definido pelo layout a partir do cookie).
// O clique (a) vira o atributo no shell — o CSS reage na hora, sem ida ao
// servidor e sem pulo — e (b) grava a preferencia no cookie `admin_sidebar`, para
// o proximo SSR ja nascer no estado certo. Esse cookie e PREFERENCIA DE UI, nunca
// a sessao: nao encosta no `aventix_admin_session` (iron-session).

'use client';

// Preferencia dura um ano; nao ha nada sensivel nela, so recolhido/expandido.
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function SidebarToggle() {
  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const shell = event.currentTarget.closest<HTMLElement>('[data-admin-shell]');
    if (!shell) return;

    const next = shell.getAttribute('data-collapsed') !== 'true';
    shell.setAttribute('data-collapsed', next ? 'true' : 'false');

    document.cookie = `admin_sidebar=${
      next ? 'collapsed' : 'expanded'
    }; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Recolher ou expandir o menu"
      title="Recolher ou expandir o menu"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-neutral-600 hover:bg-neutral-100"
    >
      {/* Dois icones; o CSS mostra o certo para cada estado (globals.css). */}
      <svg
        className="admin-toggle-when-expanded h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 7l-5 5 5 5M18 7l-5 5 5 5" />
      </svg>
      <svg
        className="admin-toggle-when-collapsed h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M13 7l5 5-5 5M6 7l5 5-5 5" />
      </svg>
    </button>
  );
}
