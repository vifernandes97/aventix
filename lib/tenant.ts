// Aventix — tenant atual + settings cacheadas (CLAUDE.md secoes 3 e 4.2).
//
// PONTO UNICO de acesso ao tenant e as settings. Duas convencoes do CLAUDE.md
// secao 3 dependem deste modulo existir:
//   - toda query de negocio filtra por tenant_id;
//   - todo texto de UI vem de settings, nunca hardcoded.
//
// MODULO SERVER-ONLY: settings sao lidas do Postgres. Nao importe em Client
// Component — se um valor precisa chegar ao cliente, um Server Component
// passa como prop. E para isso que serve o `import 'server-only'` abaixo.
//
// Consequencia MEDIDA: em processo Node cru (script `tsx` avulso, sem a condicao
// de exportacao `react-server`) este modulo LANCA no import — "This module cannot
// be imported from a Client Component module". Por isso scripts/seed.ts nao o
// importa e declara o tenant id localmente. Dentro do Next (rotas, Server
// Components, instrumentation) o import resolve normalmente.

import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from './db/client';
import { settings } from './db/schema';

// -- tenant atual ------------------------------------------------------------

// MVP: tenant unico e fixo (Quadri Club). Multi-tenant-ready no schema desde a
// primeira migration, mas resolvido por constante aqui.
const DEFAULT_TENANT_ID = 1;

/**
 * Tenant da requisicao atual.
 *
 * >>> ESTE E O PONTO UNICO A MUDAR NA v2. <<<
 * Quando o tenant passar a vir do dominio (aventix.com.br vs. dominio proprio)
 * ou da sessao do admin, a resolucao entra AQUI e mais nada no codebase muda —
 * desde que ninguem tenha escrito `tenant_id = 1` a mao em outro lugar.
 */
export function getTenantId(): number {
  return DEFAULT_TENANT_ID;
}

// -- chaves ------------------------------------------------------------------

/**
 * Chaves de settings do MVP (CLAUDE.md secao 4.2). Uniao de literais para que
 * um erro de digitacao seja erro de compilacao, e nao `undefined` em producao.
 */
export type SettingKey =
  | 'resource_label'
  | 'resource_label_plural'
  | 'operator_label'
  | 'passenger_label'
  | 'operator_document_required'
  | 'operator_document_label'
  | 'meeting_point'
  | 'what_to_bring'
  | 'business_name'
  | 'reply_to_email'
  | 'deposit_policy_text'
  | 'single_experience_per_slot'
  | 'min_lead_minutes';

/**
 * Subconjunto booleano. Tipar isto separado impede, em tempo de compilacao,
 * chamar getBooleanSetting com uma chave de texto (ex.: 'business_name').
 */
export type BooleanSettingKey = 'operator_document_required' | 'single_experience_per_slot';

/**
 * Subconjunto numerico. Mesmo proposito do BooleanSettingKey: impede em tempo de
 * compilacao chamar getNumberSetting com uma chave de texto.
 */
export type NumberSettingKey = 'min_lead_minutes';

/**
 * Defaults para chave ausente. A tabela settings comeca vazia (o seed e tarefa
 * separada) e chave faltando NAO pode lancar: o formulario publico e a porta de
 * entrada do dinheiro, e tela feia vende enquanto tela quebrada nao vende.
 */
const SETTING_DEFAULTS: Record<SettingKey, string> = {
  resource_label: 'Recurso',
  resource_label_plural: 'Recursos',
  operator_label: 'Operador',
  passenger_label: 'Passageiro',
  // default seguro: coletar documento a toa incomoda; deixar de coletar um
  // documento obrigatorio vira problema operacional no dia do passeio.
  operator_document_required: 'true',
  operator_document_label: 'Documento',
  meeting_point: '',
  what_to_bring: '',
  // NUNCA 'Aventix' aqui. Regra de marca (rev 5): a UI publica exibe a marca do
  // TENANT; "Aventix" e o nome da plataforma e nao substitui a marca do cliente.
  // Vazio + warn e o comportamento correto ate o seed rodar.
  business_name: '',
  reply_to_email: '',
  deposit_policy_text: '',
  // default explicito do CLAUDE.md secao 4.2
  single_experience_per_slot: 'false',
  // antecedencia minima entre agora e o inicio do passeio (secao 6).
  // '0' e valido e significa "aceito reserva ate a hora do passeio".
  min_lead_minutes: '60',
};

const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

// -- cache -------------------------------------------------------------------

type CacheEntry = {
  data: Readonly<Record<SettingKey, string>>;
  /** chaves que cairam no default (avisadas uma vez, na carga) */
  missing: readonly SettingKey[];
  loadedAt: number;
};

/**
 * TTL de 60s. Rede de seguranca para o cenario de multiplos containers: cada
 * processo tem seu proprio cache, e invalidateSettingsCache num deles nao
 * alcanca os outros. Com o TTL, o pior caso e 60s de valor velho, nao valor
 * velho para sempre.
 */
const CACHE_TTL_MS = 60_000;

// Indexado por tenantId desde ja: custo zero hoje, multi-tenant-ready depois.
// Mesmo padrao de globalThis de lib/db/client.ts — sobrevive ao hot-reload do
// Next em dev, que reavalia o modulo e zeraria um Map de escopo de modulo.
const globalForSettings = globalThis as unknown as {
  settingsCache?: Map<number, CacheEntry>;
};

const settingsCache: Map<number, CacheEntry> = globalForSettings.settingsCache ?? new Map();

if (process.env.NODE_ENV !== 'production') globalForSettings.settingsCache = settingsCache;

/**
 * Descarta o cache do tenant informado, ou de todos se omitido.
 * Chamada pela tela de configuracoes do admin ao salvar (Fase 3).
 */
export function invalidateSettingsCache(tenantId?: number): void {
  if (tenantId === undefined) settingsCache.clear();
  else settingsCache.delete(tenantId);
}

// -- carga -------------------------------------------------------------------

function warnMissing(tenantId: number, keys: readonly SettingKey[]): void {
  for (const key of keys) {
    console.warn(
      `[tenant ${tenantId}] setting '${key}' ausente no banco; usando default ` +
        `${JSON.stringify(SETTING_DEFAULTS[key])}. Rode o seed do tenant.`,
    );
  }
}

async function loadSettings(tenantId: number): Promise<CacheEntry> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.tenantId, tenantId));

  // Chaves desconhecidas no banco sao ignoradas de proposito: uma linha extra
  // em settings nunca deve derrubar a leitura das demais.
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const data = {} as Record<SettingKey, string>;
  const missing: SettingKey[] = [];

  for (const key of SETTING_KEYS) {
    const value = stored.get(key);
    if (value === undefined) {
      data[key] = SETTING_DEFAULTS[key];
      missing.push(key);
    } else {
      data[key] = value;
    }
  }

  // Uma vez por carga de cache (~1x/60s por processo), nao a cada leitura:
  // 12 avisos por requisicao viram ruido que treina todo mundo a ignorar log.
  if (missing.length > 0) warnMissing(tenantId, missing);

  // Congelado: o objeto e compartilhado entre todos os leitores do cache;
  // mutar por engano contaminaria as proximas requisicoes.
  return { data: Object.freeze(data), missing, loadedAt: Date.now() };
}

async function getCacheEntry(tenantId: number): Promise<CacheEntry> {
  const cached = settingsCache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

  const entry = await loadSettings(tenantId);
  settingsCache.set(tenantId, entry);
  return entry;
}

// -- API publica -------------------------------------------------------------

/**
 * Todas as settings do tenant atual, com defaults ja aplicados nas ausentes.
 * Le do cache quando valido.
 */
export async function getSettings(): Promise<Record<SettingKey, string>> {
  const entry = await getCacheEntry(getTenantId());
  return entry.data;
}

/** Uma setting do tenant atual (default aplicado se ausente). */
export async function getSetting(key: SettingKey): Promise<string> {
  const entry = await getCacheEntry(getTenantId());
  return entry.data[key];
}

/**
 * Setting booleana do tenant atual.
 *
 * OBRIGATORIO usar isto em vez de ler a string direto. `settings.value` e text,
 * entao "false" e uma STRING — e em JS toda string nao-vazia e truthy. Um
 * `if (s.single_experience_per_slot)` ligaria a exclusividade de experiencia
 * mesmo com o dono tendo desligado, sem erro nenhum aparecendo. A comparacao
 * mora aqui, num lugar so.
 *
 * A normalizacao (trim + lowercase) e defesa na LEITURA: se o CRUD de settings
 * gravar 'True' ou ' true', a comparacao exata leria false — e em
 * operator_document_required isso vai na direcao insegura, deixando de exigir
 * documento. Nao depender de ninguem lembrar de normalizar na escrita.
 */
export async function getBooleanSetting(key: BooleanSettingKey): Promise<boolean> {
  return (await getSetting(key)).trim().toLowerCase() === 'true';
}

/**
 * Setting numerica (inteiro) do tenant atual.
 *
 * OBRIGATORIO usar isto em vez de `Number(valor)` no ponto de uso. `settings.value`
 * e text — a mesma armadilha do getBooleanSetting em outra roupa: `"60" + 30` da
 * `"6030"`, e um valor corrompido no banco vira NaN silencioso que faz o motor de
 * disponibilidade descartar todos os candidatos ou nenhum, sem erro aparecendo.
 * A conversao e a validacao moram num lugar so.
 *
 * Valor ausente, vazio, nao-numerico ou negativo cai no default da chave, com
 * warn identificando a chave e o valor cru. ZERO E VALIDO: min_lead_minutes '0'
 * significa "aceito reserva ate a hora do passeio" — nao e ausencia.
 */
export async function getNumberSetting(key: NumberSettingKey): Promise<number> {
  const raw = await getSetting(key);
  const parsed = Number.parseInt(raw.trim(), 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    const fallback = Number.parseInt(SETTING_DEFAULTS[key], 10);
    console.warn(
      `[tenant ${getTenantId()}] setting '${key}' invalida: ${JSON.stringify(raw)} ` +
        `nao e inteiro >= 0. Usando default ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
}
