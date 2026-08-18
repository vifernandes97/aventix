// Aventix — contrato do provedor de pagamento (CLAUDE.md secao 2: "Asaas ...
// atras de `PaymentProvider`").
//
// >>> ESTE E O UNICO VOCABULARIO QUE O RESTO DO SISTEMA ENXERGA <<<
// Nada fora de `lib/payments/asaas.ts` importa modulo, tipo ou string com
// "asaas" no nome. Trocar de provedor (ou entrar um segundo, por tenant) deve
// custar uma implementacao nova deste arquivo, nao uma varredura no repo.
//
// >>> INTERFACE MINIMA DE PROPOSITO <<<
// Tres metodos: criar cobranca Pix, consultar cobranca, cancelar cobranca. E o
// que o MVP usa. `receiveInCash` (modo sinal) e cartao (v2) estao FORA — metodo
// que ninguem chama e codigo morto que envelhece sem ninguem perceber, e a
// assinatura errada so aparece no dia em que alguem finalmente tenta usar.
//
// >>> STATUS E DOMINIO NOSSO <<<
// `PaymentState` sai do enum `payment_state` do schema, nao do vocabulario do
// provedor (decisao de 2026-07-27 em docs/DECISOES.md). O Asaas distingue
// RECEIVED de CONFIRMED de um jeito que so importa no cartao; a traducao mora
// na implementacao, num ponto unico.

import type { paymentState } from '../db/schema';

/** Estado de UMA cobranca, no vocabulario do Aventix. */
export type PaymentState = (typeof paymentState.enumValues)[number];

/**
 * Quem paga. `providerCustomerId` e o id do cliente NO PROVEDOR, quando ja
 * conhecido — o provedor de pagamento aceita cadastro duplicado do mesmo
 * cliente, entao reutilizar o id e o que impede um cadastro novo por reserva.
 */
export type ChargePayer = {
  /** id ja conhecido no provedor; `null` manda criar. */
  providerCustomerId: string | null;
  name: string;
  /** so digitos (formato de `customers.phone`) */
  phone: string;
  email: string | null;
  /**
   * CPF/CNPJ do pagador, so digitos. MEDIDO contra o sandbox do Asaas em
   * 17/08/2026: criar o CLIENTE sem ele responde 200, mas criar a COBRANCA Pix
   * responde 400 ("Para criar esta cobranca e necessario preencher o CPF ou
   * CNPJ do cliente"). Ou seja, e opcional no cadastro e obrigatorio na venda.
   */
  taxId: string | null;
  /** id do cliente no Aventix — vai como referencia externa no provedor */
  externalReference: string;

  /**
   * Chamado assim que um cliente NOVO e criado no provedor, ANTES de a cobranca
   * ser tentada.
   *
   * Existe por um motivo especifico: se a cobranca falhar depois, o id do
   * cliente recem-criado continua valido e precisa ficar gravado para a proxima
   * tentativa reutiliza-lo. Sem este gancho, o id so voltaria no retorno de
   * sucesso e uma falha na cobranca vazaria um cliente orfao no provedor a cada
   * tentativa.
   */
  onProviderCustomerCreated?: (providerCustomerId: string) => Promise<void>;
};

export type CreatePixChargeParams = {
  payer: ChargePayer;
  /** centavos inteiros — a conversao para a unidade do provedor e interna */
  amountCents: number;
  /** 'YYYY-MM-DD' (data de calendario, ja resolvida no fuso do tenant) */
  dueDate: string;
  /** "{reservationId}:{kind}" — unico e deterministico (secao 4.6) */
  externalReference: string;
  /** texto que o cliente ve na fatura */
  description?: string;
};

export type PixCharge = {
  /** id da cobranca no provedor */
  chargeId: string;
  /** id do cliente no provedor (novo ou reaproveitado) — o chamador persiste */
  providerCustomerId: string;
  /** imagem do QR Code em base64, SEM o prefixo `data:` */
  qrCodeBase64: string;
  /** payload copia-e-cola do Pix */
  copyPaste: string;
  /** ISO 8601; `null` quando o provedor nao informa validade */
  expiresAt: string | null;
  /** link da fatura hospedada no provedor (secao 7.1) */
  invoiceUrl: string | null;
};

/** Estado atual de uma cobranca, ja traduzido. */
export type ChargeSnapshot = {
  chargeId: string;
  state: PaymentState;
  amountCents: number;
  externalReference: string | null;
  /** ISO 8601 ou `null` se ainda nao pago */
  paidAt: string | null;
};

export interface PaymentProvider {
  /** Cria (e garante o cliente de) uma cobranca Pix, com QR Code pronto. */
  createPixCharge(params: CreatePixChargeParams): Promise<PixCharge>;
  /** Estado atual da cobranca no provedor — fonte da verdade do pagamento. */
  getCharge(chargeId: string): Promise<ChargeSnapshot>;
  /** Remove/cancela a cobranca no provedor. */
  cancelCharge(chargeId: string): Promise<void>;
}

// -- erros -------------------------------------------------------------------
//
// Tres causas que o chamador precisa DISTINGUIR, porque o desfecho de cada uma
// e diferente: configuracao errada e problema nosso e nao adianta repetir;
// rede/timeout e transitorio e a proxima tentativa pode passar; erro de negocio
// da API precisa da mensagem para ser entendido.

/** Ambiente ausente, vazio ou corrompido. Nao adianta repetir — o deploy esta errado. */
export class PaymentProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderConfigError';
  }
}

/** Credencial recusada (401/403). Configuracao, nao transitorio. */
export class PaymentProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderAuthError';
  }
}

/** Timeout ou falha de transporte. TRANSITORIO — a proxima tentativa pode passar. */
export class PaymentProviderNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PaymentProviderNetworkError';
  }
}

/** A API respondeu, recusando por regra de negocio (4xx com descricao). */
export class PaymentProviderApiError extends Error {
  readonly status: number;
  /** descricoes devolvidas pelo provedor, ja concatenadas */
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`provedor de pagamento recusou (HTTP ${status}): ${detail}`);
    this.name = 'PaymentProviderApiError';
    this.status = status;
    this.detail = detail;
  }
}
