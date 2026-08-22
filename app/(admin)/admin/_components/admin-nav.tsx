// Navegacao entre as telas do admin.
//
// >>> POR QUE ISTO EXISTE <<<
// Ate 22/08 a tela /admin/experiencias nao era alcancavel por link nenhum:
// `grep` por "/admin/experiencias" fora da propria pasta nao achava nada, e so
// se chegava nela digitando a URL. Com as telas de grade entrando, seriam
// quatro paginas invisiveis — e o objetivo delas e exatamente o contrario,
// tirar o dono da dependencia do desenvolvedor para mudar a propria agenda.
//
// Server Component: nao tem estado nem interacao alem dos links. A pagina atual
// vem por prop, e nao de usePathname, para nao arrastar este componente (e as
// telas que o usam) para o cliente so por causa de um destaque visual.

import Link from 'next/link';

const LINKS = [
  { key: 'agenda', href: '/admin', label: 'Agenda' },
  { key: 'excecoes', href: '/admin/excecoes', label: 'Exceções' },
  { key: 'horarios', href: '/admin/horarios', label: 'Horários' },
  { key: 'bloqueios', href: '/admin/bloqueios', label: 'Bloqueios' },
  { key: 'experiencias', href: '/admin/experiencias', label: 'Experiências' },
] as const;

export type AdminNavKey = (typeof LINKS)[number]['key'];

export function AdminNav({ current }: { current: AdminNavKey }) {
  return (
    <nav
      aria-label="Seções do painel"
      // Rola na horizontal no celular: a tela do admin e usada EM CAMPO
      // (secao 11.1), e cinco links quebrariam em duas linhas num aparelho
      // estreito, comendo altura util da agenda.
      className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0"
    >
      {LINKS.map((link) => {
        const active = link.key === current;
        return (
          <Link
            key={link.key}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 rounded px-3 py-1.5 text-sm ${
              active
                ? 'bg-neutral-900 font-medium text-white'
                : 'border text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
