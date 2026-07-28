// Aventix — FRONTEIRA UNICA de autenticacao do admin (CLAUDE.md secao 13).
//
// ============================================================================
// >>> TODO ACESSO A AUTENTICACAO PASSA POR AQUI. <<<
//
// Quem consome auth (proxy.ts, rotas /api/admin, telas de admin) chama as
// funcoes deste modulo e NUNCA le cookie ou process.env por conta propria.
// Mesmo padrao de getTenantId() em lib/tenant.ts, e pela mesma razao: o MVP
// tem UM usuario (o dono), a v2 tera varios com papeis (tabela admin_users,
// backlog). Se cada consumidor lesse o cookie sozinho, a v2 exigiria caçar
// leitura de sessao pelo codebase inteiro. Concentrado aqui, a evolucao troca
// a implementacao de getCurrentUser() e mais nada.
//
// A regra so vale enquanto ninguem escrever `cookies().get('aventix_...')` ou
// `process.env.ADMIN_*` fora deste arquivo. Um unico desvio fura a fronteira.
// ============================================================================
//
// MODULO SERVER-ONLY: le segredos do ambiente. Nao importe em Client Component
// — a tela de login (app/(admin)/admin/login/page.tsx) e client e por isso fala
// com a API por fetch, sem importar nada daqui.

import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcrypt';
import { sealData, unsealData } from 'iron-session';
import { cookies } from 'next/headers';

// -- identidade --------------------------------------------------------------

/**
 * Identidade do admin autenticado.
 *
 * >>> ESTE TIPO CRESCE NA v2. <<<
 * Vira `{ id: string; email: string; role: AdminRole }` lido de admin_users.
 * Hoje so tem email porque so existe um usuario e nao ha papel a distinguir.
 * Consumidores que so precisam saber "esta logado?" nao mudam.
 */
export type AdminUser = {
  email: string;
};

// -- cookie ------------------------------------------------------------------

/**
 * Nome do cookie de sessao. Exportado para teste e diagnostico, NAO para
 * consumidor ler o cookie por fora — para isso existe getCurrentUser().
 */
export const SESSION_COOKIE_NAME = 'aventix_admin_session';

/**
 * Validade da sessao. 8h cobre um dia de operacao sem relogar; passou disso, o
 * dono digita a senha de novo.
 *
 * O MESMO valor governa o `ttl` do selo (iron-session) e o `maxAge` do cookie.
 * Se divergissem, o pior caso seria um cookie que o navegador ainda manda mas
 * que o servidor recusa — sessao "morta viva", com o usuario deslogado sem
 * entender por que.
 */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

// -- configuracao de ambiente ------------------------------------------------

type AuthConfig = {
  adminEmail: string;
  adminPasswordHash: string;
  sessionSecret: string;
};

/**
 * Tamanho minimo do segredo de sessao, exigido pelo iron-session (a chave
 * deriva dele). Abaixo disso a propria biblioteca lanca — melhor recusar no
 * boot, com mensagem que diz o que fazer, do que no primeiro login.
 */
const MIN_SESSION_SECRET_LENGTH = 32;

/** Prefixos de hash bcrypt validos. Um hash truncado no .env e erro comum. */
const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

let cachedConfig: AuthConfig | null = null;

/**
 * Le e valida as variaveis de ambiente da autenticacao.
 *
 * PREGUICOSA DE PROPOSITO (nao valida no import do modulo). O Easypanel injeta
 * as variaveis em RUNTIME, nao no build (CLAUDE.md secao 2): validar no topo do
 * arquivo derrubaria o `next build` dentro do Docker, onde ADMIN_* legitimamente
 * ainda nao existem. O fail-fast de boot mora em instrumentation.ts, que so roda
 * quando o servidor sobe — que e o momento certo, e o que a tarefa pede.
 */
function getAuthConfig(): AuthConfig {
  if (cachedConfig) return cachedConfig;

  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();

  const missing: string[] = [];
  if (!adminEmail) missing.push('ADMIN_EMAIL');
  if (!adminPasswordHash) missing.push('ADMIN_PASSWORD_HASH');
  if (!sessionSecret) missing.push('SESSION_SECRET');

  if (missing.length > 0) {
    throw new Error(
      `[auth] variavel(is) de ambiente ausente(s): ${missing.join(', ')}. ` +
        'O admin nao pode subir sem elas. Veja .env.example; gere o hash com ' +
        '`npm run auth:hash -- "sua-senha"`.',
    );
  }

  if (sessionSecret!.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `[auth] SESSION_SECRET tem ${sessionSecret!.length} caracteres; o minimo e ` +
        `${MIN_SESSION_SECRET_LENGTH}. Gere um com \`openssl rand -base64 48\`.`,
    );
  }

  // Erro de copiar-e-colar que, sem esta checagem, so apareceria como "senha
  // errada" no login — sintoma que aponta para o lugar errado.
  //
  // A CAUSA MAIS PROVAVEL de cair aqui nao e hash errado, e CIFRAO NAO ESCAPADO
  // no .env: o carregador do Next (@next/env) expande variaveis, e o hash tem
  // tres cifroes ($2b$12$...), entao sem `\` antes de cada um ele chega com 50
  // caracteres em vez de 60. MEDIDO: aspas simples e duplas nao protegem.
  // Aconteceu no desenvolvimento desta propria tarefa — por isso a mensagem
  // gasta linhas explicando em vez de so dizer "hash invalido".
  if (!BCRYPT_PREFIXES.some((prefix) => adminPasswordHash!.startsWith(prefix))) {
    throw new Error(
      '[auth] ADMIN_PASSWORD_HASH nao parece um hash bcrypt (esperado comecar com ' +
        `${BCRYPT_PREFIXES.join(', ')}); valor recebido tem ${adminPasswordHash!.length} ` +
        'caracteres, bcrypt tem 60. CAUSA MAIS COMUM: os cifroes do hash nao estao ' +
        'escapados no .env e o Next os expandiu. Escreva ' +
        'ADMIN_PASSWORD_HASH=\\$2b\\$12\\$... com uma barra invertida antes de cada ' +
        'cifrao (aspas NAO resolvem). O .env guarda o HASH, nunca a senha em texto; ' +
        '`npm run auth:hash -- "sua-senha"` ja imprime a linha pronta.',
    );
  }

  cachedConfig = {
    adminEmail: adminEmail!,
    adminPasswordHash: adminPasswordHash!,
    sessionSecret: sessionSecret!,
  };

  return cachedConfig;
}

/**
 * Fail-fast de boot. Chamada por instrumentation.ts (CLAUDE.md secao 12 usa o
 * mesmo arquivo para o cron): valida a configuracao quando o servidor sobe, com
 * mensagem clara, em vez de deixar o erro aparecer no primeiro login.
 *
 * NAO lanca aqui dentro — quem chama decide o que fazer. Ver instrumentation.ts.
 */
export function checkAuthConfig(): { ok: true } | { ok: false; message: string } {
  try {
    getAuthConfig();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// -- credenciais -------------------------------------------------------------

/** Email e identificador, nao texto livre: comparacao insensivel a caixa e espaco. */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Comparacao de strings em tempo constante.
 *
 * Passa pelo sha256 antes porque timingSafeEqual exige buffers do MESMO tamanho
 * e lanca se diferirem — e o proprio tamanho do email vazaria pelo throw. O hash
 * iguala o comprimento (32 bytes sempre) sem revelar nada.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = createHash('sha256').update(a).digest();
  const bufferB = createHash('sha256').update(b).digest();
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Confere email + senha contra a credencial do ambiente.
 *
 * NUNCA logue os argumentos nem o hash: a senha em texto passa por aqui, e log
 * de aplicacao costuma ir parar em agregador de terceiro.
 *
 * >>> A v2 REESCREVE ESTA FUNCAO <<< para buscar o usuario em admin_users pelo
 * email e comparar com a coluna password_hash. A assinatura nao muda.
 */
export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  const config = getAuthConfig();

  const emailMatches = constantTimeEquals(normalizeEmail(email), normalizeEmail(config.adminEmail));

  // bcrypt.compare roda SEMPRE, mesmo com o email ja errado. Sair mais cedo
  // faria a resposta com email errado voltar em microssegundos e a com email
  // certo demorar os ~250ms do bcrypt — diferenca medivel de fora, que revela
  // qual email e o do dono. A senha e comparada exclusivamente por bcrypt,
  // nunca por ===.
  const passwordMatches = await bcrypt.compare(password, config.adminPasswordHash);

  return emailMatches && passwordMatches;
}

// -- sessao ------------------------------------------------------------------

/**
 * Conteudo selado dentro do cookie. Deliberadamente minimo: o cookie viaja no
 * navegador do usuario, entao nada sensivel entra aqui.
 */
type SessionPayload = {
  email: string;
};

/**
 * Le e valida um cookie selado.
 *
 * O iron-session assina E cifra (AES-256-GCM). Selo adulterado, cifrado com
 * outro segredo ou vencido faz unsealData lancar — o que aqui vira `null`, e
 * nao erro 500: cookie invalido e "nao logado", situacao normal.
 */
async function readSessionCookie(rawValue: string | undefined): Promise<AdminUser | null> {
  if (!rawValue) return null;

  try {
    const payload = await unsealData<SessionPayload>(rawValue, {
      password: getAuthConfig().sessionSecret,
      ttl: SESSION_TTL_SECONDS,
    });

    // unsealData devolve {} quando o selo expira, em vez de lancar.
    if (!payload?.email) return null;

    return { email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Admin autenticado na requisicao atual, ou null.
 *
 * ============================================================================
 * >>> ESTE E O PONTO UNICO QUE A v2 REESCREVE. <<<
 * Passa a ler a tabela admin_users e devolver { id, email, role }. Todo
 * consumidor (proxy, rotas de admin, Server Components) continua chamando esta
 * mesma funcao com a mesma assinatura, e nenhum deles muda.
 * ============================================================================
 *
 * Para Server Components e Route Handlers, que enxergam next/headers. O proxy
 * NAO pode usar esta — ver getUserFromRequest.
 */
export async function getCurrentUser(): Promise<AdminUser | null> {
  const cookieStore = await cookies();
  return readSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

/**
 * Forma minima de request que o proxy oferece. Evita importar tipo do
 * next/server aqui e mantem a funcao testavel com um objeto literal.
 */
type RequestWithCookies = {
  cookies: { get(name: string): { value: string } | undefined };
};

/**
 * Mesma pergunta de getCurrentUser, para quem NAO tem next/headers.
 *
 * POR QUE DUAS FUNCOES: `cookies()` do next/headers e ligada ao contexto de
 * requisicao do App Router e nao existe dentro do proxy — la o cookie chega no
 * NextRequest. As duas convergem para readSessionCookie, entao a regra de
 * validade da sessao continua definida num lugar so.
 */
export async function getUserFromRequest(request: RequestWithCookies): Promise<AdminUser | null> {
  return readSessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

/** Opcoes do cookie de sessao. Um lugar so, usado ao criar e ao destruir. */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Em producao o site e HTTPS (Easypanel/Traefik). Em dev o servidor e http
    // e um cookie `secure` simplesmente nao seria gravado — daí a condicional.
    secure: process.env.NODE_ENV === 'production',
    // 'lax' deixa o cookie viajar na navegacao normal para /admin e barra o
    // envio em POST cross-site, que e o vetor de CSRF que importa aqui.
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/**
 * Abre a sessao do admin. Chamada SO depois de verifyCredentials retornar true.
 *
 * v2: recebera o usuario inteiro e selara tambem id e papel.
 */
export async function createSession(email: string): Promise<void> {
  const payload: SessionPayload = { email: normalizeEmail(email) };

  const sealed = await sealData(payload, {
    password: getAuthConfig().sessionSecret,
    ttl: SESSION_TTL_SECONDS,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sealed, sessionCookieOptions());
}

/**
 * Encerra a sessao.
 *
 * Sobrescreve com valor vazio e maxAge 0 em vez de so `delete`: o delete depende
 * de o navegador casar o cookie pelos mesmos atributos, e a sobrescrita explicita
 * com o MESMO path e a forma que nao deixa duvida.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 });
}

// -- politica de rotas -------------------------------------------------------

/**
 * Rotas de admin que NAO exigem sessao. Sem estas o login e impossivel: a tela
 * pediria login para poder logar.
 */
const UNPROTECTED_ADMIN_PATHS = new Set(['/admin/login', '/api/admin/login']);

/**
 * Esta rota exige sessao de admin?
 *
 * A politica mora aqui, e nao espalhada pelo proxy, por ser decisao de
 * AUTENTICACAO — mesma razao das outras funcoes deste arquivo. O proxy so
 * pergunta e obedece.
 *
 * ATENCAO AO QUE FICA DE FORA (e mais importante que o que fica dentro):
 *
 *   /api/webhooks/*  — o webhook do Asaas (Fase 2) e chamado PELO ASAAS, que
 *                      nao tem cookie de sessao. Exigir login aqui devolveria
 *                      401 ao Asaas e NENHUM pagamento seria confirmado; pior,
 *                      15 falhas seguidas INTERROMPEM a fila de webhook
 *                      (CLAUDE.md secao 8.1, regra 7) e os eventos sao
 *                      descartados apos 14 dias. O webhook tem autenticacao
 *                      propria, por token (secao 8.1, regra 8).
 *
 *   rotas publicas   — /, /reserva/*, /agenda/*, /api/availability,
 *                      /api/reservations, /api/termo, /api/shared/*. O site de
 *                      reserva e publico por definicao: e a porta de entrada do
 *                      dinheiro.
 *
 * Esta funcao devolve false para tudo isso porque so reconhece /admin e
 * /api/admin. Isso e REDUNDANTE com o matcher do proxy, de proposito: se
 * alguem um dia afrouxar o matcher, a politica ainda segura.
 */
export function isProtectedPath(pathname: string): boolean {
  if (UNPROTECTED_ADMIN_PATHS.has(pathname)) return false;

  // A comparacao exata mais o prefixo com barra cobrem '/admin' e '/admin/x'
  // sem deixar passar '/admins' ou '/administrativo' — que um startsWith('/admin')
  // solto trataria como area protegida.
  const isAdminScreen = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminApi = pathname === '/api/admin' || pathname.startsWith('/api/admin/');

  return isAdminScreen || isAdminApi;
}
