// Aventix — implementacao Asaas do PaymentProvider (CLAUDE.md secoes 2 e 8).
//
// ============================================================================
// >>> ESTE E O UNICO ARQUIVO DO REPO QUE FALA "ASAAS" <<<
// O resto do sistema conversa pelo contrato de `provider.ts`. Toda traducao —
// status, unidade monetaria, formato de erro — mora aqui e em lugar nenhum mais.
// ============================================================================
//
// >>> REGRA DE PRIVACIDADE DA CREDENCIAL <<<
// A API key NUNCA aparece em log, mensagem de erro, telemetria ou resposta HTTP.
// Mesmo contrato que app/api/admin/reservations/[id]/route.ts aplica a CPF e
// documento: o dado sensivel trafega no lugar dele e nao vaza nem em depuracao.
// Se um dia entrar log de requisicao aqui, o header `access_token` e redigido
// ANTES — use `redactHeaders()`, que existe exatamente para isso. As mensagens
// de erro de configuracao citam COMPRIMENTO e PREFIXO da chave, nunca o valor.
//
// >>> AUTENTICACAO <<<
// Header `access_token: <chave>`. NAO e `Authorization: Bearer` — o Asaas
// devolve 401 sem explicar a diferenca, e o erro parece chave invalida.

import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { localToUtc } from '../time';
import { centsToReaisNumber } from './money';
import {
  type CardCharge,
  type ChargeSnapshot,
  type ChargeStage,
  type ChargePayer,
  type CreateCardChargeParams,
  type CreatePixChargeParams,
  type PaymentProvider,
  type PaymentState,
  type PixCharge,
  type PixQrCode,
  PaymentProviderApiError,
  PaymentProviderAuthError,
  PaymentProviderConfigError,
  PaymentProviderNetworkError,
} from './provider';

// -- configuracao ------------------------------------------------------------

type AsaasConfig = { apiKey: string; baseUrl: string };

let cachedConfig: AsaasConfig | null = null;

/** Prefixo de toda chave de API do Asaas (sandbox e producao). */
const API_KEY_PREFIX = '$aact_';

/**
 * Piso de sanidade do comprimento. A chave real passa de 150 caracteres; o que
 * esta checagem pega e chave TRUNCADA, nao chave curta legitima.
 */
const MIN_API_KEY_LENGTH = 50;

/**
 * Timeout por chamada HTTP.
 *
 * ESCOLHA: 10s. O trade-off e assimetrico e vale explicar, porque o valor
 * "obvio" (2-3s, como numa API interna) esta errado aqui.
 *
 * Esta chamada acontece DURANTE O CHECKOUT, com o cliente na tela, mas o custo
 * de estourar o timeout nao e "o cliente espera mais": e a reserva virar
 * `expired` e a vaga ser liberada (secao 5.2 passo 5 / caso de borda 9). Ou
 * seja, timeout curto demais transforma lentidao transitoria do provedor em
 * VENDA PERDIDA, com o cliente tendo ja preenchido seis passos de formulario.
 * Timeout longo demais so custa segundos de espera numa tela que avisa que esta
 * gerando a cobranca.
 *
 * 10s cobre com folga a latencia tipica (bem abaixo de 2s) e ainda deixa o pior
 * caso do fluxo inteiro — 3 chamadas em sequencia, cliente novo — em 30s, dentro
 * do limite de proxy do VPS. Nao aumente sem revisar esse pior caso.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Le e valida o ambiente. PREGUICOSO de proposito, mesmo motivo de
 * `getAuthConfig()` em lib/auth.ts: o Easypanel injeta variaveis em RUNTIME, e
 * validar no import quebraria o `next build` dentro do Docker.
 *
 * @throws {PaymentProviderConfigError} ausente, vazia ou visivelmente corrompida.
 */
function getConfig(): AsaasConfig {
  if (cachedConfig) return cachedConfig;

  const apiKey = process.env.ASAAS_API_KEY?.trim();
  const baseUrl = process.env.ASAAS_BASE_URL?.trim();

  const missing: string[] = [];
  if (!apiKey) missing.push('ASAAS_API_KEY');
  if (!baseUrl) missing.push('ASAAS_BASE_URL');

  if (missing.length > 0) {
    throw new PaymentProviderConfigError(
      `[asaas] variavel(is) de ambiente ausente(s): ${missing.join(', ')}. ` +
        'Sem elas nao ha como cobrar. Veja .env.example.',
    );
  }

  // ==========================================================================
  // A CHAVE COMECA COM CIFRAO, E O NEXT EXPANDE CIFRAO.
  //
  // Mesma armadilha ja medida com o hash bcrypt (secao 13 do CLAUDE.md): o
  // carregador de ambiente do Next expande `$var`, e `$aact_...` e lido como
  // variavel inexistente. Aspas simples e duplas NAO protegem — so a barra
  // invertida antes do cifrao. O sintoma sem esta checagem seria um 401 do
  // Asaas, que manda conferir a chave no painel em vez de olhar o .env.
  //
  // Por isso a mensagem cita a causa e o comprimento recebido, e NUNCA o valor.
  // ==========================================================================
  if (!apiKey!.startsWith(API_KEY_PREFIX)) {
    throw new PaymentProviderConfigError(
      `[asaas] ASAAS_API_KEY nao comeca com "${API_KEY_PREFIX}" (recebida com ` +
        `${apiKey!.length} caracteres). CAUSA MAIS COMUM: o cifrao inicial da chave ` +
        'foi expandido pelo carregador de ambiente e a chave chegou vazia ou truncada. ' +
        'Escreva ASAAS_API_KEY=\\$aact_... com barra invertida antes do cifrao ' +
        '(aspas NAO resolvem dentro do Next). No Easypanel vale a mesma regra.',
    );
  }

  if (apiKey!.length < MIN_API_KEY_LENGTH) {
    throw new PaymentProviderConfigError(
      `[asaas] ASAAS_API_KEY tem apenas ${apiKey!.length} caracteres — a chave do ` +
        'Asaas passa de 150. Valor TRUNCADO: confira se ele foi copiado inteiro e se ' +
        'o cifrao esta escapado (\\$aact_...).',
    );
  }

  cachedConfig = { apiKey: apiKey!, baseUrl: baseUrl!.replace(/\/+$/, '') };
  return cachedConfig;
}

/**
 * Valida a configuracao sem lancar — para o fail-fast do boot avisar e seguir,
 * igual `checkAuthConfig()`. Derrubar o processo por causa disto tiraria do ar
 * tambem o que nao depende de pagamento.
 */
export function checkAsaasConfig(): { ok: true } | { ok: false; message: string } {
  try {
    getConfig();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Somente para teste: esquece a config memorizada. */
export function invalidateAsaasConfigCache(): void {
  cachedConfig = null;
}

// -- token do webhook --------------------------------------------------------
//
// SEGREDO SEPARADO DA API KEY, de proposito (secao 8.1 regra 8). A API key
// AUTORIZA A COBRAR na conta do tenant; o token do webhook so prova que quem
// bateu na nossa porta e o Asaas. Reaproveitar a API key aqui a exporia num
// campo de configuracao de terceiro sem nenhum ganho.

/**
 * Compara em tempo constante, via sha256 (mesma tecnica de `lib/auth.ts`):
 * `timingSafeEqual` exige buffers do mesmo tamanho e LANCA se diferirem — o
 * proprio comprimento do token vazaria pelo throw. O hash iguala em 32 bytes.
 */
function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

/**
 * Confere o header `asaas-access-token` do webhook.
 *
 * NUNCA logue o argumento nem o valor esperado. Um token ausente no ambiente
 * faz esta funcao recusar TUDO — e o lado seguro: sem o segredo configurado nao
 * ha como distinguir o Asaas de qualquer um, e aceitar seria pior que recusar.
 */
export function verifyWebhookToken(received: string | null | undefined): boolean {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    console.error(
      '[asaas] ASAAS_WEBHOOK_TOKEN ausente: o webhook vai recusar TODAS as ' +
        'notificacoes (401) e nenhum pagamento sera confirmado por essa via. ' +
        'A reconciliacao (secao 8-B) segura o fluxo enquanto isso.',
    );
    return false;
  }
  if (!received) return false;

  return constantTimeEquals(received, expected);
}

/**
 * Headers prontos para log. A credencial vira um marcador de comprimento — util
 * para diagnosticar truncamento, inutil para quem quiser usar a chave.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = { ...headers };
  if (safe.access_token) safe.access_token = `<REDACTED:${safe.access_token.length} chars>`;
  return safe;
}

// -- transporte --------------------------------------------------------------

/** Corpo de erro do Asaas: `{ errors: [{ code, description }] }`. */
type AsaasErrorBody = { errors?: { code?: string; description?: string }[] };

/**
 * Redige documento (CPF/CNPJ) de um texto que PODE acabar em log.
 *
 * O corpo que mandamos ao Asaas carrega `cpfCnpj`, e a descricao de erro que ele
 * devolve pode ecoar o valor recebido. Essa descricao vira `detail` de
 * `PaymentProviderApiError`, que a rota loga com `console.error` — sem esta
 * funcao, um CPF chegaria ao log do servidor por um caminho que ninguem escreveu
 * de proposito. Mesma regra de dado sensivel de
 * app/api/admin/reservations/[id]/route.ts.
 *
 * Corta sequencias de 11 ou 14 digitos (CPF e CNPJ), com ou sem pontuacao.
 * Sobra o texto da mensagem, que e o que serve para diagnosticar.
 */
export function redactDocuments(text: string): string {
  return text.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, '<REDACTED:documento>');
}

/**
 * Chamada HTTP unica do modulo. Toda requisicao ao Asaas passa por aqui, para
 * que timeout, autenticacao, redacao e traducao de erro existam num lugar so.
 */
async function request<T>(
  path: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown },
): Promise<T> {
  const { apiKey, baseUrl } = getConfig();
  const url = `${baseUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // AbortSignal.timeout lanca TimeoutError, capturado no catch abaixo junto
      // com falha de DNS/conexao: para o chamador as duas sao a mesma coisa —
      // transitorio, tentar de novo pode resolver.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new PaymentProviderNetworkError(
      timedOut
        ? `[asaas] ${init.method} ${path} estourou o timeout de ${REQUEST_TIMEOUT_MS}ms`
        : `[asaas] falha de rede em ${init.method} ${path}`,
      { cause: error },
    );
  }

  if (response.status === 401 || response.status === 403) {
    // A chave NAO entra na mensagem. O comprimento basta para distinguir
    // "chave errada" de "chave comida pela expansao de variavel".
    throw new PaymentProviderAuthError(
      `[asaas] credencial recusada (HTTP ${response.status}) em ${init.method} ${path}. ` +
        `A chave configurada tem ${apiKey.length} caracteres e prefixo correto; ` +
        'confira se ela e do ambiente certo (sandbox x producao) e se segue valida.',
    );
  }

  const text = await response.text();

  if (!response.ok) {
    let detail = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text) as AsaasErrorBody;
      const descriptions = parsed.errors?.map((e) => e.description).filter(Boolean);
      if (descriptions?.length) detail = descriptions.join('; ');
    } catch {
      // corpo nao-JSON: fica o texto cru truncado
    }
    // O detail e logado pela rota; documento nunca pode passar por aqui.
    throw new PaymentProviderApiError(response.status, redactDocuments(detail));
  }

  // 204 e corpo vazio (DELETE) — nao ha o que parsear.
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PaymentProviderApiError(
      response.status,
      `resposta nao e JSON valido: ${text.slice(0, 200)}`,
    );
  }
}

// -- traducao de status ------------------------------------------------------

/**
 * Status do Asaas -> `payment_state` do Aventix. PONTO UNICO de traducao.
 *
 * Notas que valem para quem mexer aqui na Fase 2 tarefa 2 (webhook):
 * - `CONFIRMED` e `RECEIVED` sao ambos "pago" no Pix, que liquida na hora. A
 *   distincao so importa no CARTAO (v2), onde CONFIRMED chega na compra e
 *   RECEIVED so ~32 dias depois (secao 16).
 * - `OVERDUE` continua `pending`: vencido e devido, nao e estado terminal.
 * - Status desconhecido cai em `pending` de proposito — o Asaas adiciona valores
 *   sem aviso (secao 8.1 regra 5), e tratar novidade como "nao pago" e o lado
 *   seguro: no maximo a reconciliacao insiste, nunca confirma reserva a toa.
 */
export function toPaymentState(asaasStatus: string): PaymentState {
  switch (asaasStatus) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'paid';

    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    // ======================================================================
    // >>> `AWAITING_CHARGEBACK_REVERSAL` E IMPRECISO AQUI, E E DE PROPOSITO. <<<
    // O nome do status diz o contrario do que este mapeamento afirma: ele
    // significa que a disputa foi GANHA e o dinheiro esta voltando para o
    // lojista. Traduzi-lo como 'refunded' e dizer "o dinheiro esta fora"
    // enquanto ele esta a caminho de volta.
    //
    // Mantido assim porque as duas falhas nao custam o mesmo. Errar para
    // 'refunded' faz o dono cobrar de novo alguem que ja pagou —
    // constrangedor e RECUPERAVEL, com uma conversa. Errar para 'paid' faz o
    // sistema afirmar ter dinheiro que ainda nao voltou, e se a reversao nao
    // se completar o passeio saiu de graca, sem nada acusar.
    //
    // Quando o dinheiro efetivamente cair, o Asaas emite um status terminal e
    // processCharge converge sozinho na proxima leitura — a imprecisao dura o
    // tempo da reversao, e nao para sempre.
    //
    // NAO "conserte" isto sem trazer o dado que falta: quanto tempo esse
    // estado dura na pratica, e se ha evento proprio para o fim dele.
    // ======================================================================
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'refunded';

    case 'DELETED':
      return 'cancelled';

    default:
      return 'pending';
  }
}

/**
 * Status do Asaas -> `charge_stage` do Aventix. Ponto unico, vizinho do de
 * cima e pela mesma razao.
 *
 * ============================================================================
 * >>> ISTO E PARA A TELA, NAO PARA DECIDIR. <<<
 * `toPaymentState` governa o dinheiro. Esta funcao existe porque aquela colapsa
 * cinco status de CARTAO num `pending` so — o que e a traducao segura para
 * decidir e inutil para escrever a tela. Analise de risco pode DURAR, e um
 * cliente que ve a mesma mensagem de "aguardando pagamento" que veria antes de
 * pagar conclui que travou, tenta de novo e gera a segunda cobranca.
 * ============================================================================
 *
 * Status desconhecido cai em `aguardando`, pelo mesmo motivo do outro mapa: o
 * Asaas acrescenta valores sem aviso (secao 8.1 regra 5), e "ainda nao
 * resolvido" e a leitura que nao promete nada ao cliente.
 */
export function toChargeStage(asaasStatus: string): ChargeStage {
  switch (asaasStatus) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'pago';

    // Cartao em analise. `AUTHORIZED` entra aqui porque autorizado NAO e
    // capturado: o limite foi reservado e o dinheiro nao saiu, entao prometer
    // "pago" seria mentira que so se desfaz na captura.
    // `APPROVED_BY_RISK_ANALYSIS` e transitorio — o CONFIRMED vem atras — e
    // mostrar "aprovado" no meio do caminho faria a tela regredir se a captura
    // falhasse depois.
    case 'AWAITING_RISK_ANALYSIS':
    case 'APPROVED_BY_RISK_ANALYSIS':
    case 'AUTHORIZED':
      return 'em_analise';

    case 'REPROVED_BY_RISK_ANALYSIS':
    case 'CREDIT_CARD_CAPTURE_REFUSED':
      return 'recusado';

    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'estornado';

    case 'DELETED':
      return 'cancelado';

    default:
      return 'aguardando';
  }
}

// -- respostas da API --------------------------------------------------------

type AsaasCustomer = { id: string };

type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  /**
   * Liquido: o bruto menos a taxa DELES. Vem no corpo do webhook e na consulta
   * da cobranca. Opcional porque o Asaas so o preenche quando ha o que
   * descontar — tipicamente a partir do pagamento (secao 4-B.7).
   */
  netValue?: number | null;
  externalReference?: string | null;
  invoiceUrl?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
};

/**
 * Envelope de listagem do Asaas. So `data` interessa: a paginacao nao, porque
 * a busca por referencia externa e por chave unica nossa e nunca deveria voltar
 * mais de uma linha (ver a conferencia defensiva no metodo).
 */
type AsaasPaymentList = {
  data?: AsaasPayment[] | null;
};

type AsaasPixQrCode = {
  encodedImage: string;
  payload: string;
  expirationDate?: string | null;
};

/**
 * Data de pagamento do Asaas -> ISO 8601.
 *
 * O campo vem como 'YYYY-MM-DD' (data de calendario) ou como data/hora.
 *
 * DATA PURA VIRA MEIA-NOITE DE SAO PAULO, nao de UTC. MEDIDO: um pagamento de
 * 17/08 lido como `2026-08-17T00:00:00Z` vira `2026-08-16 21:00-03` no banco e
 * aparece como DIA ANTERIOR em toda tela e recibo — o cliente pagou dia 17 e o
 * comprovante diz 16. O Asaas opera no fuso de Brasilia, entao a data que ele
 * informa ja e local (secao 3: fuso nas bordas, UTC no banco).
 */
function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return localToUtc(value, '00:00').toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * `GET /payments/{id}/pixQrCode` — a chamada crua, num ponto unico.
 *
 * O QR e uma chamada SEPARADA da criacao da cobranca: `POST /payments` devolve
 * a cobranca sem QR nenhum. Os dois metodos publicos que precisam dele
 * (createPixCharge, no fim do fluxo de criacao, e getPixQrCode, sob demanda)
 * passam por aqui — duas copias da mesma URL e do mesmo mapeamento de campo
 * divergiriam no dia em que o Asaas renomear `encodedImage`.
 */
async function fetchPixQrCode(chargeId: string): Promise<PixQrCode> {
  const qr = await request<AsaasPixQrCode>(`/payments/${chargeId}/pixQrCode`, { method: 'GET' });

  return {
    qrCodeBase64: qr.encodedImage,
    copyPaste: qr.payload,
    expiresAt: toIsoOrNull(qr.expirationDate),
  };
}

/**
 * Garante que o pagador existe no provedor e devolve o id dele.
 *
 * Reutiliza o id quando ja existe. O Asaas ACEITA cadastro duplicado do mesmo
 * nome/telefone sem reclamar, entao "criar sempre" nao daria erro: daria um
 * cliente novo por reserva, e a base do tenant viraria lixo.
 *
 * Extraido na Fase E porque o cartao precisa do MESMO passo, palavra por
 * palavra. Duas copias divergiriam no primeiro campo novo — e a copia que
 * esquecesse o `onProviderCustomerCreated` voltaria a vazar cliente orfao a cada
 * falha de cobranca, que e exatamente o bug que aquele gancho existe para
 * fechar.
 */
async function ensureProviderCustomer(payer: ChargePayer): Promise<string> {
  if (payer.providerCustomerId) return payer.providerCustomerId;

  const created = await request<AsaasCustomer>('/customers', {
    method: 'POST',
    body: {
      name: payer.name,
      mobilePhone: payer.phone,
      ...(payer.email ? { email: payer.email } : {}),
      // Sem cpfCnpj o cadastro passa e a COBRANCA e que falha (ver taxId em
      // provider.ts). Mandamos quando existe para nao criar o cliente ja
      // condenado a nao conseguir ser cobrado.
      ...(payer.taxId ? { cpfCnpj: payer.taxId } : {}),
      externalReference: payer.externalReference,
    },
  });

  // Persiste ANTES de tentar a cobranca (ver ChargePayer): se o passo seguinte
  // falhar, este id continua valido e a proxima tentativa o reaproveita em vez
  // de criar outro cliente.
  await payer.onProviderCustomerCreated?.(created.id);

  return created.id;
}

/**
 * Corpo do `POST /payments`, identico nos dois meios de pagamento exceto pelo
 * `billingType`. Ponto unico para a conversao de dinheiro nao ter duas casas.
 */
function chargeBody(params: CreatePixChargeParams, providerCustomerId: string, billingType: string) {
  return {
    customer: providerCustomerId,
    billingType,
    // O Asaas cobra em REAIS com decimal; o banco guarda centavos. A travessia
    // e sempre por lib/payments/money.ts, nunca `/100` solto.
    value: centsToReaisNumber(params.amountCents),
    dueDate: params.dueDate,
    externalReference: params.externalReference,
    ...(params.description ? { description: params.description } : {}),
  };
}

/** Reais do provedor -> centavos inteiros, que e a unidade do banco. */
function reaisToCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value * 100);
}

/** `AsaasPayment` -> `ChargeSnapshot`. Ponto unico: getCharge e a busca por
 *  referencia externa devolvem o MESMO objeto, e um campo novo entra uma vez so. */
function toSnapshot(payment: AsaasPayment): ChargeSnapshot {
  return {
    chargeId: payment.id,
    state: toPaymentState(payment.status),
    stage: toChargeStage(payment.status),
    amountCents: reaisToCents(payment.value) ?? 0,
    externalReference: payment.externalReference ?? null,
    paidAt: toIsoOrNull(payment.paymentDate ?? payment.confirmedDate ?? payment.clientPaymentDate),
    // LIDO, nunca calculado (secao 4-B.7).
    netCents: reaisToCents(payment.netValue),
  };
}

// -- implementacao -----------------------------------------------------------

export const asaasProvider: PaymentProvider = {
  async createPixCharge(params: CreatePixChargeParams): Promise<PixCharge> {
    const providerCustomerId = await ensureProviderCustomer(params.payer);

    const payment = await request<AsaasPayment>('/payments', {
      method: 'POST',
      body: chargeBody(params, providerCustomerId, 'PIX'),
    });

    // QR Code: chamada SEPARADA e obrigatoria — `POST /payments` devolve a
    // cobranca sem QR nenhum.
    const qr = await fetchPixQrCode(payment.id);

    return {
      chargeId: payment.id,
      providerCustomerId,
      ...qr,
      invoiceUrl: payment.invoiceUrl ?? null,
    };
  },

  async createCardCharge(params: CreateCardChargeParams): Promise<CardCharge> {
    const providerCustomerId = await ensureProviderCustomer(params.payer);

    // >>> `creditCard` e `creditCardHolderInfo` NAO SAO ENVIADOS. <<<
    // Nao e omissao: e a decisao da secao 4-B.8. Mandar dados de cartao pela API
    // poe a nossa infraestrutura no escopo de PCI-DSS, e o Asaas nao oferece
    // tokenizacao client-side que permitisse evitar isso. O cliente digita o
    // cartao na `invoiceUrl`, que e pagina do provedor.
    const payment = await request<AsaasPayment>('/payments', {
      method: 'POST',
      body: chargeBody(params, providerCustomerId, 'CREDIT_CARD'),
    });

    // Sem fatura nao ha como pagar no cartao — nao existe segundo caminho, como
    // o copia-e-cola e para o Pix. Falhar aqui devolve a reserva ao caso de
    // borda 9 (expira, libera a vaga, cliente avisado), que e ruim; entregar um
    // botao que leva a lugar nenhum e pior, porque o cliente fica achando que
    // pagou.
    if (!payment.invoiceUrl) {
      throw new PaymentProviderApiError(
        502,
        `cobranca ${payment.id} criada sem invoiceUrl; nao ha como o cliente pagar no cartao`,
      );
    }

    return { chargeId: payment.id, providerCustomerId, invoiceUrl: payment.invoiceUrl };
  },

  async getPixQrCode(chargeId: string): Promise<PixQrCode> {
    return fetchPixQrCode(chargeId);
  },

  async getCharge(chargeId: string): Promise<ChargeSnapshot> {
    const payment = await request<AsaasPayment>(`/payments/${chargeId}`, { method: 'GET' });

    return toSnapshot(payment);
  },

  async findChargeByExternalReference(externalReference: string): Promise<ChargeSnapshot | null> {
    // `externalReference` e a chave que NOS geramos ("{uuid}:{kind}", secao
    // 4.6), entao a busca e por igualdade exata e no maximo uma cobranca
    // deveria casar.
    const list = await request<AsaasPaymentList>(
      `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=10`,
      { method: 'GET' },
    );

    // >>> CONFERE A REFERENCIA DE VOLTA, SEMPRE. <<<
    // O contrato em provider.ts exige isto e o motivo e concreto: se o Asaas
    // ignorar o filtro (parametro renomeado, versao de API diferente, erro
    // nosso de digitacao no nome do campo), ele responde 200 com a listagem
    // INTEIRA da conta do tenant. Confiar na primeira linha adotaria a cobranca
    // de outro cliente como se fosse o saldo deste — e o dinheiro de um
    // apareceria quitando a reserva do outro. Comparar aqui transforma esse
    // cenario em "nao achei", que e seguro.
    const matches = (list.data ?? []).filter((p) => p.externalReference === externalReference);

    if (matches.length === 0) return null;

    if (matches.length > 1) {
      // Ja existe duplicata no provedor — exatamente o que a Fase C existe para
      // impedir. Nao da para desfazer daqui (cancelar a "sobrando" exigiria
      // saber qual o cliente pagou), entao registra alto e adota a primeira,
      // que e a mais antiga e a que o cliente provavelmente recebeu.
      console.error(
        `[asaas] DUPLICATA: ${matches.length} cobrancas com externalReference=${externalReference}. ` +
          'Confira no painel do Asaas e cancele as excedentes que ninguem pagou.',
      );
    }

    return toSnapshot(matches[0]);
  },

  async cancelCharge(chargeId: string): Promise<void> {
    await request<unknown>(`/payments/${chargeId}`, { method: 'DELETE' });
  },
};
