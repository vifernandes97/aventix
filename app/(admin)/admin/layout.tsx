// Shell do admin.
//
// >>> POR QUE ESTE LAYOUT EXISTE, E POR QUE FAZ TAO POUCO <<<
// A sidebar (desktop) e a navbar (mobile) vivem em admin-nav.tsx, renderizadas
// POR PAGINA — porque a pagina ativa e marcada por prop (`current`), e um layout
// nao sabe a rota sem usePathname (que arrastaria as telas para o cliente). Logo
// este layout NAO renderiza a navegacao. Ele so faz uma coisa: dar o
// deslocamento do conteudo no desktop, para ele nao ficar sob a sidebar fixa.
//
// O estado recolhido/expandido vem do cookie `admin_sidebar` (PREFERENCIA DE UI,
// nao a sessao — nao encosta no iron-session), lido AQUI no servidor para o SSR
// ja nascer no estado certo: cookie viaja na requisicao, entao nao ha o pulo que
// localStorage causaria (servidor renderiza expandido, JS recolhe depois). O
// atributo `data-collapsed` no shell e a fonte da verdade que o CSS (globals.css)
// e o toggle (sidebar-toggle.tsx) compartilham.
//
// O deslocamento e condicionado, no CSS, a existir uma sidebar na subtree
// (`:has([data-admin-sidebar])`). Assim /admin/login — que fica sob este mesmo
// layout mas NAO renderiza sidebar — nao ganha deslocamento nenhum e continua
// identico. No mobile nada disto se aplica (a navbar horizontal manda).

import { cookies } from 'next/headers';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = (await cookies()).get('admin_sidebar')?.value === 'collapsed';

  return (
    <div data-admin-shell data-collapsed={collapsed ? 'true' : 'false'}>
      {children}
    </div>
  );
}
