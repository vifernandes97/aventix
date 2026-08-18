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

import { centsToReaisNumber } from './money';
import {
  type ChargeSnapshot,
  type CreatePixChargeParams,
  type PaymentProvider,
  type PaymentState,
  type PixCharge,
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
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'refunded';

    case 'DELETED':
      return 'cancelled';

    default:
      return 'pending';
  }
}

// -- respostas da API --------------------------------------------------------

type AsaasCustomer = { id: string };

type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  externalReference?: string | null;
  invoiceUrl?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
};

type AsaasPixQrCode = {
  encodedImage: string;
  payload: string;
  expirationDate?: string | null;
};

/**
 * Data de pagamento do Asaas -> ISO 8601.
 *
 * O campo vem como 'YYYY-MM-DD' (data de calendario) ou como data/hora. A
 * conversao passa por Date so quando ha hora; data pura vira meia-noite UTC.
 */
function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// -- implementacao -----------------------------------------------------------

export const asaasProvider: PaymentProvider = {
  async createPixCharge(params: CreatePixChargeParams): Promise<PixCharge> {
    const { payer } = params;

    // -- 1. cliente no provedor ------------------------------------------
    // Reutiliza o id quando ja existe. O Asaas ACEITA cadastro duplicado do
    // mesmo nome/telefone sem reclamar, entao "criar sempre" nao daria erro:
    // daria um cliente novo por reserva, e a base do tenant viraria lixo.
    let providerCustomerId = payer.providerCustomerId;

    if (!providerCustomerId) {
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
      providerCustomerId = created.id;

      // Persiste ANTES de tentar a cobranca (ver ChargePayer): se o passo
      // seguinte falhar, este id continua valido e a proxima tentativa o
      // reaproveita em vez de criar outro cliente.
      await payer.onProviderCustomerCreated?.(providerCustomerId);
    }

    // -- 2. cobranca ------------------------------------------------------
    const payment = await request<AsaasPayment>('/payments', {
      method: 'POST',
      body: {
        customer: providerCustomerId,
        billingType: 'PIX',
        // O Asaas cobra em REAIS com decimal; o banco guarda centavos. A
        // travessia e sempre por lib/payments/money.ts, nunca `/100` solto.
        value: centsToReaisNumber(params.amountCents),
        dueDate: params.dueDate,
        externalReference: params.externalReference,
        ...(params.description ? { description: params.description } : {}),
      },
    });

    // -- 3. QR Code (chamada separada, obrigatoria) -----------------------
    const qr = await request<AsaasPixQrCode>(`/payments/${payment.id}/pixQrCode`, {
      method: 'GET',
    });

    return {
      chargeId: payment.id,
      providerCustomerId,
      qrCodeBase64: qr.encodedImage,
      copyPaste: qr.payload,
      expiresAt: toIsoOrNull(qr.expirationDate),
      invoiceUrl: payment.invoiceUrl ?? null,
    };
  },

  async getCharge(chargeId: string): Promise<ChargeSnapshot> {
    const payment = await request<AsaasPayment>(`/payments/${chargeId}`, { method: 'GET' });

    return {
      chargeId: payment.id,
      state: toPaymentState(payment.status),
      // De volta para centavos inteiros, que e a unidade do banco.
      amountCents: Math.round(payment.value * 100),
      externalReference: payment.externalReference ?? null,
      paidAt: toIsoOrNull(
        payment.paymentDate ?? payment.confirmedDate ?? payment.clientPaymentDate,
      ),
    };
  },

  async cancelCharge(chargeId: string): Promise<void> {
    await request<unknown>(`/payments/${chargeId}`, { method: 'DELETE' });
  },
};
