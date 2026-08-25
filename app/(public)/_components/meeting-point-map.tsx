// Mapa do ponto de encontro.
//
// >>> A SETTING GUARDA SO A URL, E O IFRAME E MONTADO AQUI <<<
// `settings.meeting_point_map_url` e DADO. Guardar o `<iframe ...>` inteiro no
// banco obrigaria a injeta-lo cru na pagina (dangerouslySetInnerHTML), o que faz
// de qualquer pessoa com acesso a settings alguem capaz de executar script na
// tela do cliente final (XSS). Montando a marcacao aqui, o banco nunca decide o
// que a pagina executa — ele so diz PARA ONDE o mapa aponta.
//
// A URL ainda e validada antes de virar `src` (lib/maps.ts): mesmo vinda de
// settings, ela precisa ser http(s). Sem isso, um valor `javascript:...` viraria
// execucao — a mesma classe de problema, entrando pela porta estreita. A regra
// mora num modulo `.ts` puro porque a suite nao tem ambiente de DOM e precisa
// testa-la sem renderizar o componente.

import { safeEmbedUrl } from '@/lib/maps';

/** Setting vazia/ausente e estado VALIDO: a tela omite o bloco inteiro. */
export function MeetingPointMap({ url, title }: { url: string; title: string }) {
  const embedUrl = safeEmbedUrl(url);
  if (!embedUrl) return null;

  return (
    <div className="mt-3">
      {/* Proporcao fixa em vez de width/height de 600x450 (o que o Google
          sugere): a tela de status e usada NO CELULAR, e altura fixa em pixel
          ou estoura a largura ou deixa o mapa numa tira inutilizavel. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-stone-800 sm:aspect-[16/9]">
        <iframe
          src={embedUrl}
          title={title}
          // O mapa e pesado e NAO pode competir com o resto da confirmacao: esta
          // tela e o unico comprovante que o cliente recebe (e-mail foi cortado
          // do go-live), entao data, horario e endereco pintam primeiro.
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
          style={{ border: 0 }}
        />
      </div>

      {/* >>> O LINK NAO E REDUNDANTE COM O MAPA. <<<
          Dois motivos, e os dois sao do dia do passeio: (a) o cliente vai querer
          abrir no Waze/Maps do proprio celular em vez de navegar num iframe
          pequeno; (b) se o iframe for bloqueado (bloqueador de anuncios, modo
          restrito, rede corporativa), o link e o unico endereco que sobra. Sem
          ele, mapa bloqueado = cliente sem saber onde e. */}
      <a
        href={embedUrl}
        target="_blank"
        // noopener/noreferrer: `target=_blank` sem eles da a pagina de destino
        // acesso a `window.opener`.
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
      >
        Abrir no aplicativo de mapas
        <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}

