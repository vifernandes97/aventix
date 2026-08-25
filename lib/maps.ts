// Aventix — validacao da URL de embed do mapa (CLAUDE.md secao 3).
//
// >>> MODULO PURO, sem `server-only` e sem import de banco <<<
// Mesma razao de lib/cpf.ts: e usado pelo componente publico (que vai para o
// bundle do cliente) e precisa ser testavel em Node puro. A suite nao tem
// ambiente de DOM, entao a regra mora aqui, num `.ts`, em vez de dentro do
// `.tsx` do componente.
//
// >>> POR QUE ISTO EXISTE <<<
// `settings.meeting_point_map_url` guarda SO A URL, nunca HTML — settings e
// dado, e renderizar marcacao vinda do banco seria XSS (ver o comentario em
// lib/tenant.ts). Guardar URL fecha a porta larga, mas deixa uma estreita: uma
// URL `javascript:...` viraria execucao ao ser usada como `src`/`href`. Esta
// funcao fecha a estreita.

/**
 * Devolve a URL se ela for segura para usar como `src` de iframe / `href` de
 * link; `null` caso contrario.
 *
 * `null` e o caso NORMAL, nao um erro: setting vazia significa "este tenant nao
 * configurou mapa", e a tela simplesmente omite o bloco. Por isso URL
 * malformada tambem devolve `null` em vez de lancar — tela sem mapa serve, tela
 * quebrada nao, e esta e a tela de confirmacao do cliente que acabou de pagar.
 */
export function safeEmbedUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    // Lista de permissao, nao de bloqueio: so http(s) passa. Barra
    // `javascript:`, `data:`, `vbscript:` e qualquer esquema futuro sem
    // precisar prever cada um.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
