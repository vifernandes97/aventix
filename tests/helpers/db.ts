// Helpers de isolamento da suite (CLAUDE.md secao 11-B: o catalogo vem do seed).
//
// REGRA DE ISOLAMENTO: o CATALOGO (tenant, settings, resources, experiences,
// operating_hours) e PRE-CONDICAO — os testes assumem `npm run db:seed` rodado e
// nunca o apagam. As tabelas de MOVIMENTO sao zeradas antes de cada teste.
//
// `schedule_exceptions` e `blackouts` tambem entram na limpeza: o seed as deixa
// VAZIAS, entao zera-las restaura exatamente o estado semeado. Sem isso, uma
// excecao criada pelo teste 7 mudaria a grade vista pelo teste 9.
//
// RELOGIO: nenhum teste mocka o tempo do Node. O sistema usa now() do BANCO de
// proposito (decisao registrada em docs/DECISOES.md), entao lead time e
// expiracao se testam MANIPULANDO DADOS: hold_expires_at no passado, start_at
// explicito.

import { sql } from 'drizzle-orm';

import { applyDiscount } from '@/lib/basis-points';
import { db } from '@/lib/db/client';
import { SEED_PIX_DISCOUNT_BASIS_POINTS } from '@/lib/seed';
import { quadricicloTemplate } from '@/lib/templates/quadriciclo';
import { invalidateSettingsCache } from '@/lib/tenant';
import { localToUtc, todayLocalDate } from '@/lib/time';

export const TENANT_ID = 1;

// -- tenant vizinho (fixture de isolamento) ----------------------------------

/**
 * Prefixo dos slugs de tenant criados por FIXTURE.
 *
 * >>> O PREFIXO E O QUE TORNA A BARREIRA CONFIAVEL. <<<
 * Cinco arquivos (J, K, L, M, N) criam um segundo tenant para provar isolamento
 * e o apagam no afterAll. A barreira de multi-tenancy
 * (tests/o-barreira-multi-tenant.test.ts) precisa distinguir esses tenants
 * descartaveis de um tenant DE VERDADE que alguem tenha cadastrado — e faz isso
 * por este prefixo, nao por ordem de execucao de arquivo. Barreira que depende
 * de ordem alfabetica some no dia em que alguem renomeia um arquivo, sem avisar.
 *
 * Por isso o slug e feio de proposito: 'tenant-vizinho-j', nunca algo plausivel
 * como 'quadriclub-2'. Quem ler o teste daqui a seis meses tem que enxergar de
 * relance que aquilo e fixture, e nao um segundo cliente real.
 */
export const FIXTURE_TENANT_SLUG_PREFIX = 'tenant-vizinho-';

/**
 * Cria o tenant vizinho do arquivo de teste. `suffix` identifica o grupo ('j',
 * 'k', ...) e entra no slug, que e UNIQUE no banco desde a migration 0004.
 */
export async function insertFixtureTenant(id: number, suffix: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO tenants (id, name, slug)
    VALUES (${id}, ${`Tenant Vizinho ${suffix.toUpperCase()}`},
            ${FIXTURE_TENANT_SLUG_PREFIX + suffix.toLowerCase()})
    ON CONFLICT (id) DO NOTHING
  `);
}

/** Remove o tenant vizinho. Chamar no afterAll — ele nao e catalogo semeado. */
export async function removeFixtureTenant(id: number): Promise<void> {
  await db.execute(sql`DELETE FROM tenants WHERE id = ${id}`);
}

// -- experiencias do seed ----------------------------------------------------
//
// ============================================================================
// NAO VOLTE A FIXAR ID AQUI. Foi exatamente isso que quebrou a suite em 28/07.
//
// As constantes eram `EXP_CURTA = 1` e `EXP_LONGA = 2`, ids que o `serial`
// produziu na primeira vez que o seed rodou. O commit ce3e4c6 renomeou as duas
// trilhas no template; o seed reconcilia por NOME e nunca renomeia, entao elas
// nasceram de novo como ids 3 e 4, e a contagem por id passou a dar zero.
// Nenhuma linha de teste mudou: mudou o dado.
//
// Agora a suite le O MESMO TEMPLATE que o seed aplica e resolve os ids no
// banco em tempo de execucao. Renomear, reordenar ou repreçar no template
// passa a atravessar seed e testes junto, sem drift possivel.
// ============================================================================

/**
 * As duas experiencias do template, ordenadas por duracao.
 *
 * A suite raciocina em "uma curta e uma longa" (grade, buffer, sobreposicao),
 * nao em "Montanha e Fazenda". Derivar da DURACAO em vez da posicao no array
 * mantem a semantica dos testes mesmo se o cliente inverter qual trilha e a
 * mais longa — que ja aconteceu uma vez: ate ce3e4c6 a curta era a primeira do
 * array, depois passou a ser a segunda.
 */
const porDuracao = [...quadricicloTemplate.experiences].sort(
  (a, b) => a.durationMinutes - b.durationMinutes,
);

/** Linhas do template. Preco e duracao esperados saem daqui, nunca do banco. */
export const TEMPLATE_EXP = {
  curta: porDuracao[0],
  longa: porDuracao[porDuracao.length - 1],
};

/**
 * Ids reais no banco, resolvidos por assertCatalogSeeded (chamada no beforeAll
 * de cada arquivo). Sao zero ate la, o que nao incomoda porque nenhum teste os
 * le no topo do modulo, so dentro de caso ou de parametro default.
 */
export const EXP = { curta: 0, longa: 0 };

/** Experiencias criadas pela propria suite, para cobrir o modo 'deposit'. */
export const EXP_DEPOSIT_PCT = 900;
export const EXP_DEPOSIT_FIXED = 901;

/**
 * Parametros das duas experiencias acima. FONTE UNICA: o INSERT de
 * ensureDepositExperiences() le daqui, e os testes derivam daqui o valor
 * esperado do sinal e do saldo.
 *
 * Estes numeros NAO sao o catalogo do Quadri Club — sao fixture da suite, e e
 * por isso que nao saem do template.
 *
 * A razao original era que o catalogo real estava em `payment_mode: 'full'` e
 * nao permitia exercitar o modo 'deposit'. Isso MUDOU em 01/09, quando o
 * template passou a espelhar producao ('deposit' nas duas trilhas). A fixture
 * continua existindo por outra razao, que sempre foi a mais forte: ela cobre o
 * sinal por VALOR FIXO (`deposit_fixed_cents`), que o catalogo real nao usa e o
 * CRUD nem expoe — sem ela aquele ramo do calculo ficaria sem teste.
 *
 * Nomear os dois 17450 separadamente importa: um e o preco de uma experiencia,
 * o outro e metade do preco da outra, e a coincidencia numerica escondia isso.
 */
export const DEPOSIT_PCT_FIXTURE = { priceCents: 34900, depositPercent: 50 };
export const DEPOSIT_FIXED_FIXTURE = { priceCents: 17450, depositFixedCents: 99900 };

const MOVEMENT_TABLES = [
  'reservation_payments',
  'participants',
  'reservation_resources',
  'reservations',
  'customers',
  // vazias no seed; zerar restaura o estado semeado
  'blackouts',
  'schedule_exceptions',
];

/** Zera as tabelas de movimento. Chamar em beforeEach. Nunca toca no catalogo. */
export async function wipeMovement(): Promise<void> {
  for (const table of MOVEMENT_TABLES) {
    await db.execute(sql.raw(`DELETE FROM ${table}`));
  }
  invalidateSettingsCache();
}

/**
 * Verificacao de sanidade do catalogo, e resolucao dos ids das experiencias.
 *
 * Com o globalSetup (tests/global-setup.ts) migrando e semeando antes da suite,
 * esta funcao deixou de ser a guarda contra "esqueci o db:seed" e passou a ser
 * duas coisas: rede de seguranca (se o catalogo sumir no meio de uma rodada,
 * falha aqui com mensagem util em vez de espalhar erro pelos testes) e o lugar
 * que traduz template -> id real.
 *
 * TODA EXIGENCIA VEM DO TEMPLATE, nenhuma e numero solto. Era esse descompasso
 * (a checagem exigia id 1 e 2; o seed gravava o que o template mandasse) que
 * produzia o falso "catalogo nao semeado" com o catalogo intacto no banco.
 */
/**
 * O que o cliente PAGA por uma venda de `priceCents` (cheio) x `resources`.
 *
 * >>> ANCORA INDEPENDENTE, e nao "o que o codigo calculou" <<<
 * Recebe o preco CHEIO do template e o desconto SEMEADO, que sao as duas
 * decisoes de negocio, e refaz a conta. Nao le o total do banco nem chama
 * getDiscountBasisPoints: comparar o resultado com a mesma fonte que o produziu
 * faria o teste passar mesmo se a multiplicacao por resourcesNeeded sumisse (a
 * critica que o teste 15 ja fazia antes desta fase).
 *
 * Usa applyDiscount porque a REGRA testada aqui e "o preco vem do servidor", nao
 * "a aritmetica de basis points esta certa" — essa e o grupo S que prova, com
 * valores literais.
 */
export function precoEsperado(fullPriceCents: number, resources = 1): number {
  return applyDiscount(fullPriceCents * resources, SEED_PIX_DISCOUNT_BASIS_POINTS).payableCents;
}

export async function assertCatalogSeeded(): Promise<void> {
  const esperado = {
    resources: quadricicloTemplate.resources.filter((r) => r.active).length,
    hours: quadricicloTemplate.operatingHours.length,
    settings: Object.keys(quadricicloTemplate.settings).length,
  };

  const [row] = (
    await db.execute<{
      resources: number;
      hours: number;
      settings: number;
      desconto: number | null;
    }>(sql`
      SELECT (SELECT count(*)::int FROM resources
                WHERE tenant_id = ${TENANT_ID} AND active) resources,
             (SELECT count(*)::int FROM operating_hours
                WHERE tenant_id = ${TENANT_ID}) hours,
             (SELECT count(*)::int FROM settings
                WHERE tenant_id = ${TENANT_ID}) settings,
             (SELECT discount_basis_points FROM payment_method_discounts
                WHERE tenant_id = ${TENANT_ID} AND method = 'pix') desconto
    `)
  ).rows;

  const faltando: string[] = [];
  if (row.resources < esperado.resources) {
    faltando.push(`resources ativos: ${row.resources} de ${esperado.resources}`);
  }
  if (row.hours < esperado.hours) {
    faltando.push(`operating_hours: ${row.hours} de ${esperado.hours}`);
  }
  if (row.settings < esperado.settings) {
    faltando.push(`settings: ${row.settings} de ${esperado.settings}`);
  }
  // Desde a Fase A o PRECO DA VENDA depende desta linha. Sem a checagem, um
  // arquivo que deixasse a configuracao suja (o grupo S apaga e restaura a
  // tabela) faria os testes de preco falharem com "esperado 23249, recebido
  // 24999" — mensagem que aponta para o calculo, e nao para a causa.
  if (row.desconto !== SEED_PIX_DISCOUNT_BASIS_POINTS) {
    faltando.push(
      `desconto do pix: ${row.desconto ?? 'ausente'} (esperado ${SEED_PIX_DISCOUNT_BASIS_POINTS})`,
    );
  }

  // Resolve as experiencias por NOME do template. Diz qual esta faltando, em
  // vez de um "experiences=0" que nao ajuda ninguem a achar a causa.
  for (const [papel, item] of [
    ['curta', TEMPLATE_EXP.curta],
    ['longa', TEMPLATE_EXP.longa],
  ] as const) {
    const [found] = (
      await db.execute<{ id: number }>(sql`
        SELECT id FROM experiences
        WHERE tenant_id = ${TENANT_ID} AND name = ${item.name} AND active
      `)
    ).rows;

    if (!found) {
      faltando.push(`experiencia "${item.name}" (a ${papel}, ${item.durationMinutes} min)`);
      continue;
    }
    EXP[papel] = found.id;
  }

  if (faltando.length > 0) {
    throw new Error(
      `Catalogo incompleto no tenant ${TENANT_ID}: ${faltando.join('; ')}. ` +
        'O globalSetup deveria ter semeado; rode `npm run db:seed` e investigue por que ele nao bastou.',
    );
  }
}

/** Data futura ('YYYY-MM-DD') com o weekday pedido. 0=domingo .. 6=sabado. */
export function futureDate(weekday: number, minDaysAhead = 14): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Sabado e domingo tem grade 08:00-18:00 no seed; terca nao tem nenhuma. */
export const nextSaturday = () => futureDate(6);
export const nextSunday = () => futureDate(0);
export const nextTuesday = () => futureDate(2);

let customerSeq = 0;

/** Cria um cliente direto no banco (para montar cenario sem passar pelo dominio). */
export async function insertCustomer(name = 'Cliente Teste'): Promise<string> {
  customerSeq += 1;
  const phone = `1190000${String(customerSeq).padStart(4, '0')}`;
  const [row] = (
    await db.execute<{ id: string }>(sql`
      INSERT INTO customers (tenant_id, name, phone)
      VALUES (${TENANT_ID}, ${name}, ${phone})
      RETURNING id::text
    `)
  ).rows;
  return row.id;
}

let reservationSeq = 0;

/**
 * Ocupa um recurso com uma reserva ATIVA, por SQL cru.
 *
 * Monta cenario sem passar por createReservation de proposito: assim o teste de
 * disponibilidade nao depende da criacao estar correta, e vice-versa.
 */
export async function occupy(params: {
  date: string;
  /** 'HH:MM' local de Sao Paulo */
  startLocal: string;
  /** duracao + buffer, em minutos: e o que vai no period */
  minutes: number;
  resourceId: number;
  experienceId?: number;
  status?: 'pending_payment' | 'confirmed';
  customerId?: string;
  holdExpiresAt?: 'past' | null;
}): Promise<string> {
  const {
    date,
    startLocal,
    minutes,
    resourceId,
    // Avaliado a cada chamada, entao ja enxerga o id resolvido no beforeAll.
    experienceId = EXP.curta,
    status = 'confirmed',
    holdExpiresAt = null,
  } = params;

  const customerId = params.customerId ?? (await insertCustomer());
  reservationSeq += 1;
  const id = `00000000-0000-4000-8000-${String(reservationSeq).padStart(12, '0')}`;
  const startUtc = localToUtc(date, startLocal).toISOString();

  await db.execute(sql`
    INSERT INTO reservations
      (id, tenant_id, customer_id, experience_id, resources_needed, total_price_cents,
       start_at, duration_minutes, buffer_minutes,
       payment_mode, termo_version, termo_accepted_at, status, hold_expires_at)
    VALUES
      (${id}, ${TENANT_ID}, ${customerId}, ${experienceId}, 1, 10000,
       -- O snapshot da venda tem que FECHAR com o period inserido logo abaixo:
       -- o parametro minutes e duracao + buffer, entao aqui ele vai inteiro na
       -- duracao e o buffer fica zero. Fixture com snapshot divergente do
       -- proprio period seria dado que a aplicacao nunca produz.
       ${startUtc}::timestamptz, ${minutes}, 0,
       'full'::payment_mode, 'v1', now(),
       ${status}::reservation_status,
       ${holdExpiresAt === 'past' ? sql`now() - interval '1 minute'` : sql`NULL`})
  `);

  await db.execute(sql`
    INSERT INTO reservation_resources (reservation_id, resource_id, period, status)
    VALUES (${id}, ${resourceId},
            tstzrange(${startUtc}::timestamptz,
                      ${startUtc}::timestamptz + make_interval(mins => ${minutes})),
            ${status}::reservation_status)
  `);

  return id;
}

/** Contagens das tabelas de movimento, para provar rollback total. */
export async function movementCounts() {
  const [row] = (
    await db.execute<Record<string, number>>(sql`
      SELECT (SELECT count(*)::int FROM reservations) reservations,
             (SELECT count(*)::int FROM reservation_resources) reservation_resources,
             (SELECT count(*)::int FROM reservation_payments) reservation_payments,
             (SELECT count(*)::int FROM participants) participants,
             (SELECT count(*)::int FROM customers) customers
    `)
  ).rows;
  return row;
}

// -- settings ---------------------------------------------------------------

/**
 * Sobrescreve uma setting e invalida o cache EXPLICITAMENTE.
 *
 * Sem a invalidacao, o TTL de 60s de lib/tenant.ts serviria o valor antigo e o
 * teste passaria (ou falharia) pelo motivo errado.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO settings (tenant_id, key, value) VALUES (${TENANT_ID}, ${key}, ${value})
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value
  `);
  invalidateSettingsCache();
}

/** Le o valor atual, para o teste restaurar no teardown. */
export async function getSettingRaw(key: string): Promise<string | null> {
  const { rows } = await db.execute<{ value: string }>(
    sql`SELECT value FROM settings WHERE tenant_id = ${TENANT_ID} AND key = ${key}`,
  );
  return rows[0]?.value ?? null;
}

/** Restaura (ou remove) uma setting e invalida o cache. */
export async function restoreSetting(key: string, previous: string | null): Promise<void> {
  if (previous === null) {
    await db.execute(sql`DELETE FROM settings WHERE tenant_id = ${TENANT_ID} AND key = ${key}`);
  } else {
    await setSetting(key, previous);
    return;
  }
  invalidateSettingsCache();
}

// -- experiencias de teste (modo deposit) -----------------------------------

/**
 * Cria as experiencias de teste do grupo E. O seed so tem experiencias 'full',
 * e o modo 'deposit' precisa ser coberto.
 *
 * Faz DELETE antes do INSERT: se uma rodada anterior morreu no meio, a proxima
 * se cura sozinha em vez de acumular lixo.
 */
export async function ensureDepositExperiences(): Promise<void> {
  await removeDepositExperiences();
  await db.execute(sql`
    INSERT INTO experiences
      (id, tenant_id, name, duration_minutes, buffer_minutes, price_mode, price_cents,
       payment_mode, deposit_percent, deposit_fixed_cents, active)
    VALUES
      (${EXP_DEPOSIT_PCT}, ${TENANT_ID}, 'TESTE deposit percentual', 60, 15,
       'per_resource'::price_mode, ${DEPOSIT_PCT_FIXTURE.priceCents}, 'deposit'::payment_mode,
       ${DEPOSIT_PCT_FIXTURE.depositPercent}, NULL, true),
      (${EXP_DEPOSIT_FIXED}, ${TENANT_ID}, 'TESTE deposit fixo maior que o total', 60, 15,
       'per_resource'::price_mode, ${DEPOSIT_FIXED_FIXTURE.priceCents}, 'deposit'::payment_mode,
       NULL, ${DEPOSIT_FIXED_FIXTURE.depositFixedCents}, true)
  `);
}

/** Remove SO as experiencias que a suite criou. Nunca toca nas do seed. */
export async function removeDepositExperiences(): Promise<void> {
  await db.execute(
    sql`DELETE FROM experiences WHERE id IN (${EXP_DEPOSIT_PCT}, ${EXP_DEPOSIT_FIXED})`,
  );
}

// -- entrada padrao de createReservation ------------------------------------

/**
 * 'YYYY-MM-DD' de alguem com `years` anos completos HOJE (relogio real do
 * processo — nao e mock, e so a construcao do dado de entrada, igual
 * `hold_expires_at no passado` para lead time; a regra de "nao mockar o
 * relogio" e sobre o codigo em teste, nao sobre como a fixture calcula uma
 * data).
 *
 * Ancorado no dia de SAO PAULO (`todayLocalDate`), que e o fuso pelo qual o
 * servidor corta a maioridade. Derivar do UTC erraria por um dia depois das
 * 21h locais.
 */
export function birthdateYearsAgo(years: number): string {
  const [year, month, day] = todayLocalDate().split('-');
  return `${Number(year) - years}-${month}-${day}`;
}

/** Nasceu ha 30 anos: adulto de sobra, nao encosta na borda dos 18. */
const ADULT_BIRTHDATE = birthdateYearsAgo(30);

/**
 * CPF com digito verificador correto, para os cenarios que NAO estao testando
 * CPF. Nao e de ninguem: e uma sequencia que fecha a conta da Receita.
 */
export const VALID_CPF = '24971563792';

export function reservationInput(params: {
  experienceId: number;
  startAt: string;
  resourcesNeeded: number;
  phone?: string;
  operators?: number;
  passengers?: number;
  withDocuments?: boolean;
  /**
   * Data de nascimento aplicada a TODOS os operadores. Default: adulto.
   * `null` explicito testa operador SEM data de nascimento (rejeitado).
   */
  operatorBirthdate?: string | null;
  /**
   * Data de nascimento aplicada a TODOS os garupas. Default: adulto — as duas
   * experiencias do catalogo exigem idade minima do garupa (6 e 12), entao um
   * garupa sem data de nascimento e RECUSADO, e o default precisa ser um valor
   * que passe para os testes que nao estao testando idade. `null` explicito
   * exercita a ausencia.
   */
  passengerBirthdate?: string | null;
  /**
   * CPF do responsavel. Default: valido. Passe invalido ou vazio para exercitar
   * a recusa — o CPF e obrigatorio desde que o Asaas passou a exigi-lo para
   * emitir a cobranca.
   */
  cpf?: string;
  /**
   * O que o CLIENTE escolhe pagar agora (secao 4-B.4). Default 'full'.
   *
   * >>> NAO BASTA a experiencia estar em 'deposit' <<<
   * Desde a Fase B a experiencia OFERECE e o cliente ESCOLHE. Omitir aqui numa
   * experiencia que oferece sinal produz uma venda INTEGRAL, que e o
   * comportamento correto — e o que os testes 17a/17b/18 do grupo E passaram a
   * ter que declarar explicitamente.
   */
  paymentMethodMode?: 'full' | 'deposit';
  /**
   * COMO pagar (secao 4-B.2). Default 'pix'.
   *
   * `'card'` combinado com `paymentMethodMode: 'deposit'` e a combinacao
   * PROIBIDA — o sinal existe somente no Pix — e serve justamente para
   * exercitar a recusa (grupo Y).
   */
  paymentMethod?: 'pix' | 'card';
}) {
  const {
    experienceId,
    startAt,
    resourcesNeeded,
    phone = '(19) 99999-8888',
    operators = resourcesNeeded,
    passengers = 0,
    withDocuments = true,
    operatorBirthdate = ADULT_BIRTHDATE,
    passengerBirthdate = ADULT_BIRTHDATE,
    cpf = VALID_CPF,
    paymentMethodMode = 'full',
    paymentMethod = 'pix',
  } = params;

  return {
    experienceId,
    startAt,
    resourcesNeeded,
    customer: { name: 'Cliente Teste', phone, cpf },
    participants: [
      ...Array.from({ length: operators }, (_, i) => ({
        name: `Condutor ${i + 1}`,
        role: 'operator' as const,
        documentNumber: withDocuments ? `1234567890${i}` : null,
        birthdate: operatorBirthdate,
      })),
      ...Array.from({ length: passengers }, (_, i) => ({
        name: `Garupa ${i + 1}`,
        role: 'passenger' as const,
        birthdate: passengerBirthdate,
      })),
    ],
    termo: { version: 'v1', acceptedAt: new Date().toISOString() },
    emergencyContact: { name: 'Contato Emergência', phone: '(19) 98888-7777' },
    paymentMethodMode,
    paymentMethod,
  };
}

/**
 * Barreira: faz N chamadas largarem juntas.
 *
 * Promise.all so garante que as promises foram CRIADAS em sequencia; a primeira
 * ja pode ter ido ao banco antes de a segunda comecar. A barreira segura as duas
 * ate ambas estarem prontas, aproximando a largada de verdade.
 */
export function makeBarrier(n: number): () => Promise<void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = 0;

  return async () => {
    arrived += 1;
    if (arrived === n) release();
    await gate;
  };
}
