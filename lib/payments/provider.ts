// Aventix — contrato do provedor de pagamento (CLAUDE.md secao 2: "Asaas ...
// atras de `PaymentProvider`").
//
// >>> ESTE E O UNICO VOCABULARIO QUE O RESTO DO SISTEMA ENXERGA <<<
// Nada fora de `lib/payments/asaas.ts` importa modulo, tipo ou string com
// "asaas" no nome. Trocar de provedor (ou entrar um segundo, por tenant) deve
// custar uma implementacao nova deste arquivo, nao uma varredura no repo.
//
// >>> INTERFACE MINIMA DE PROPOSITO <<<
// Seis metodos: criar cobranca Pix, criar cobranca de CARTAO, reler o QR de uma
// cobranca ja criada, consultar cobranca, procurar cobranca pela referencia
// externa, cancelar cobranca. E o que o sistema usa. `receiveInCash` continua
// FORA — o dinheiro da maquininha nunca passa pelo provedor, entao nao ha
// cobranca a baixar la (secao 7.2). Metodo que ninguem chama e codigo morto que
// envelhece sem ninguem perceber, e a assinatura errada so aparece no dia em que
// alguem finalmente tenta usar.
//
// O quarto (`getPixQrCode`) entrou em 21/08/2026 com a tela de status
// (/reserva/[id]): a pagina sobrevive a refresh, entao o QR devolvido uma vez
// no 201 de POST /api/reservations nao basta — ela precisa reler o atual. Tem
// chamador real, que e o criterio do paragrafo acima.
//
// O quinto (`findChargeByExternalReference`) entrou na Fase C, pelo mesmo
// criterio: a cobranca do saldo e disparada por um BOTAO que o dono aperta no
// celular, em campo, e apertar duas vezes nao pode gerar duas cobrancas. As
// travas locais cobrem o caso comum, mas nenhuma delas cobre o processo morrer
// entre criar no provedor e gravar o id aqui — e nesse buraco a proxima
// tentativa criaria a segunda cobranca. Perguntar ao provedor pela referencia
// externa (unica e deterministica, secao 4.6) e a unica pergunta que atravessa
// esse buraco. Ver lib/payments/balance-charge.ts.
//
// >>> STATUS E DOMINIO NOSSO <<<
// `PaymentState` sai do enum `payment_state` do schema, nao do vocabulario do
// provedor (decisao de 2026-07-27 em docs/DECISOES.md). O Asaas distingue
// RECEIVED de CONFIRMED de um jeito que so importa no cartao; a traducao mora
// na implementacao, num ponto unico.
//
// `ChargeStage` (Fase E) segue a MESMA regra por um motivo novo: o cartao tem
// estados intermediarios — analise de risco, autorizado-sem-captura, captura
// recusada — que colapsam todos em `PaymentState='pending'`. Isso e correto para
// DECIDIR e insuficiente para EXIBIR: "em analise" e "recusado" precisam de
// telas diferentes. O estagio da a granularidade sem que uma unica palavra do
// vocabulario do Asaas atravesse este arquivo.

import type { chargeStage, paymentState } from '../db/schema';

/** Estado de UMA cobranca, no vocabulario do Aventix. DECIDE. */
export type PaymentState = (typeof paymentState.enumValues)[number];

/**
 * Estagio da cobranca no provedor, no vocabulario do Aventix. **EXIBE.**
 *
 * >>> NAO DECIDA NADA COM ISTO. <<< Ver o comentario do enum em db/schema.ts:
 * quem governa dinheiro e `PaymentState`, e um `if` sobre o estagio criaria uma
 * segunda fonte da verdade capaz de divergir da primeira.
 */
export type ChargeStage = (typeof chargeStage.enumValues)[number];

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

/**
 * Cobranca de CARTAO (Fase E, secao 4-B.8).
 *
 * Mesmos parametros da Pix: o que muda e o meio, nunca o valor nem a referencia.
 * Tipo proprio, e nao um campo `method` em `CreatePixChargeParams`, porque o
 * RETORNO e que difere — e e o retorno que impede reusar a chamada.
 */
export type CreateCardChargeParams = CreatePixChargeParams;

/**
 * ============================================================================
 * >>> SEM UMA LINHA DE DADO DE CARTAO. NEM AQUI, NEM EM LUGAR NENHUM. <<<
 *
 * O cliente e REDIRECIONADO para `invoiceUrl` e digita o cartao na pagina do
 * PROVEDOR. Nao existe formulario de cartao no wizard, e este tipo nao tem (nem
 * pode ganhar) campo de numero, CVV ou portador.
 *
 * O motivo e de conformidade, nao de gosto: a documentacao de PCI-DSS do Asaas
 * diz que, na integracao via API, "os dados passam pelo back-end da sua
 * aplicacao" e "sua infraestrutura permanece no escopo". E o Asaas NAO oferece
 * tokenizacao client-side — nao ha componente deles que capture o cartao no
 * navegador e devolva so um token. Ou o cliente digita numa pagina do Asaas, ou
 * o numero do cartao atravessa o nosso servidor.
 * ============================================================================
 */
export type CardCharge = {
  /** id da cobranca no provedor */
  chargeId: string;
  /** id do cliente no provedor (novo ou reaproveitado) — o chamador persiste */
  providerCustomerId: string;
  /**
   * Fatura hospedada no provedor. **NAO E NULAVEL, diferente de `PixCharge`.**
   *
   * No Pix ela e conveniencia: o QR ja e o caminho de pagamento, e uma fatura
   * ausente nao impede ninguem de pagar. No cartao ela E o caminho de pagamento,
   * o unico — sem ela a venda simplesmente nao tem como acontecer. Tipar como
   * `string` obriga a implementacao a falhar alto quando o provedor nao a
   * devolver, em vez de entregar ao wizard um botao que leva a lugar nenhum.
   */
  invoiceUrl: string;
};

/**
 * QR Code Pix de uma cobranca. Subconjunto de `PixCharge` — os campos que
 * mudam/expiram, sem os que so existem no instante da criacao (chargeId,
 * providerCustomerId, invoiceUrl).
 *
 * NUNCA PERSISTIR (secao 7.2): tem validade, e QR guardado no banco vira um
 * codigo que o app do banco recusa sem explicar por que.
 */
export type PixQrCode = {
  /** imagem do QR Code em base64, SEM o prefixo `data:` */
  qrCodeBase64: string;
  /** payload copia-e-cola do Pix */
  copyPaste: string;
  /** ISO 8601; `null` quando o provedor nao informa validade */
  expiresAt: string | null;
};

/** Estado atual de uma cobranca, ja traduzido. */
export type ChargeSnapshot = {
  chargeId: string;
  state: PaymentState;
  /** granularidade de EXIBICAO dentro de `state` — ver `ChargeStage` */
  stage: ChargeStage;
  amountCents: number;
  externalReference: string | null;
  /** ISO 8601 ou `null` se ainda nao pago */
  paidAt: string | null;
  /**
   * Valor LIQUIDO informado pelo provedor, em centavos — o bruto menos a taxa
   * dele. `null` enquanto ele nao informa (tipicamente antes de pagar).
   *
   * >>> LIDO, JAMAIS CALCULADO (secao 4-B.7). <<<
   * Para o que passa pelo provedor, a taxa e um fato dele e nos nao temos como
   * reproduzi-la: ela varia com metodo, parcelamento e antecipacao. Calcular
   * aqui produziria um numero com aparencia de certo, desmentido semanas depois
   * na conferencia com o extrato. So a MAQUININHA exige calculo nosso, porque
   * acontece fora do provedor (lib/payments/receive-in-cash.ts).
   */
  netCents: number | null;
};

export interface PaymentProvider {
  /** Cria (e garante o cliente de) uma cobranca Pix, com QR Code pronto. */
  createPixCharge(params: CreatePixChargeParams): Promise<PixCharge>;
  /**
   * Cria (e garante o cliente de) uma cobranca de CARTAO, devolvendo a fatura
   * hospedada no provedor — onde o cliente digita o cartao (secao 4-B.8).
   *
   * >>> POR QUE NAO E `createPixCharge` COM UM PARAMETRO A MAIS <<<
   * Nao e o meio de pagamento que separa os dois, e o RETORNO. `createPixCharge`
   * busca o QR Code numa chamada obrigatoria logo apos criar, e `PixCharge` exige
   * `qrCodeBase64` e `copyPaste` nao-nulos. Cobranca de cartao nao tem QR Pix:
   * aquela busca falharia, ou pior, devolveria algo que a tela renderizaria como
   * um QR que nenhum banco le. Um parametro `billingType` faria os dois caminhos
   * dividirem um tipo de retorno em que metade dos campos e mentira num deles.
   */
  createCardCharge(params: CreateCardChargeParams): Promise<CardCharge>;
  /**
   * QR Code ATUAL de uma cobranca ja criada.
   *
   * Existe porque o QR EXPIRA e por isso nunca e persistido (secao 7.2): quem
   * precisa dele busca na hora. `createPixCharge` ja devolve um na criacao;
   * este metodo e para todas as vezes seguintes.
   */
  getPixQrCode(chargeId: string): Promise<PixQrCode>;
  /** Estado atual da cobranca no provedor — fonte da verdade do pagamento. */
  getCharge(chargeId: string): Promise<ChargeSnapshot>;
  /**
   * Procura uma cobranca pela REFERENCIA EXTERNA (`"{reservationId}:{kind}"`).
   *
   * Existe para tornar a criacao de cobranca idempotente ATRAVESSANDO a morte
   * do processo: se o provedor criou e nos nao chegamos a gravar o id, esta e
   * a unica forma de descobrir isso antes de criar a segunda.
   *
   * @returns `null` quando nao existe cobranca com essa referencia.
   *
   * >>> A IMPLEMENTACAO E OBRIGADA A CONFERIR A REFERENCIA DE VOLTA. <<<
   * Um filtro de listagem que o provedor ignore devolveria cobrancas de OUTRAS
   * reservas, e adotar uma delas ligaria o saldo de um cliente ao pagamento de
   * outro. Confira campo a campo antes de devolver.
   */
  findChargeByExternalReference(externalReference: string): Promise<ChargeSnapshot | null>;
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
