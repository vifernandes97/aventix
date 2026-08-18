// POST /api/webhooks/asaas — notificacao de pagamento (CLAUDE.md secao 8).
//
// ============================================================================
// >>> LEIA A SECAO 8.1 ANTES DE MEXER AQUI <<<
// Esta rota tem regras que parecem erradas para quem esta acostumado com API
// HTTP normal, e cada uma existe por uma falha operacional concreta:
//
// 1. RESPONDE SEMPRE 200 — inclusive quando da errado. O Asaas trata SO 200
//    como sucesso: 201, 204, 3xx, 4xx e 5xx contam como falha de entrega.
// 2. NAO REDIRECIONA. O Asaas nao segue redirect (um 308 conta como falha).
//    A URL cadastrada e exata, sem barra final. proxy.ts NAO inclui
//    /api/webhooks no matcher, e isso esta comentado la para nao ser desfeito.
// 3. RESPONDE RAPIDO (< 10s) e deixa efeito colateral para depois. O Asaas
//    corta em ~10s (Read Timed Out) e conta como falha.
// 4. IDEMPOTENTE. Entrega e at-least-once: o mesmo evento chega de novo.
// 5. VALIDACAO TOLERANTE. O Asaas acrescenta atributos sem aviso; schema
//    estrito derrubaria a fila no dia em que eles adicionarem um campo.
// 6. COBRANCA ORFA E NORMAL. Pix pessoal do dono na mesma conta gera evento:
//    loga e responde 200.
// 7. NUNCA 5xx POR REGRA DE NEGOCIO. **15 falhas consecutivas INTERROMPEM a
//    fila**; os eventos ficam retidos e sao DESCARTADOS depois de 14 dias. Um
//    500 repetido aqui nao atrasa uma confirmacao: apaga o dinheiro de vista.
// 8. AUTENTICACAO por `asaas-access-token`, token PROPRIO do webhook — nunca a
//    API key. E a UNICA resposta nao-200 permitida (401).
//
// A consequencia de tudo isso: falhou, respondemos 200 e o job de reconciliacao
// (secao 8-B, a cada 10 min) conserta. A fila viva vale mais que a resposta
// honesta — a fila e o que traz os proximos pagamentos.
// ============================================================================
//
// PRIVACIDADE: o corpo do webhook carrega dados do pagador (nome, e-mail,
// documento). NADA do payload entra em log — os logs abaixo citam so `event` e
// o id da cobranca, que sao opacos. Se acrescentar log de depuracao aqui, redija
// antes; `redactDocuments()` em lib/payments/asaas.ts existe para isso.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyWebhookToken } from '@/lib/payments/asaas';
import { processCharge } from '@/lib/payments/process';

export const dynamic = 'force-dynamic';

/**
 * Schema TOLERANTE (regra 5): so os campos que usamos, e SEM `.strict()`.
 * Campo desconhecido no corpo passa direto — e o comportamento desejado, nao
 * um descuido. `payment` inteiro e opcional porque o Asaas envia eventos que
 * nao sao de cobranca; sem `payment.id` nao ha o que processar.
 */
const bodySchema = z.object({
  id: z.string().optional(), // id do EVENTO (evt_...), quando presente
  event: z.string().optional(),
  payment: z.object({ id: z.string() }).optional(),
});

/** Eventos que este MVP processa. Qualquer outro e reconhecido e ignorado. */
const HANDLED_EVENTS = new Set([
  'PAYMENT_RECEIVED', // Pix caiu
  'PAYMENT_CONFIRMED', // no Pix chega junto com RECEIVED; no cartao (v2) e o que confirma
  'PAYMENT_OVERDUE', // vencido: nao muda estado, so sinaliza pendencia
]);

/** Resposta de sucesso. SEMPRE 200, corpo minimo. */
function ok(detail: string) {
  return NextResponse.json({ received: true, detail }, { status: 200 });
}

export async function POST(request: Request) {
  // -- regra 8: autenticacao ------------------------------------------------
  // Unico caminho que NAO responde 200. Vale a pena: um 401 aqui significa que
  // quem chamou nao e o Asaas, entao nao ha fila legitima para proteger.
  if (!verifyWebhookToken(request.headers.get('asaas-access-token'))) {
    console.warn('[webhook:asaas] token invalido ou ausente; recusado');
    return NextResponse.json({ error: 'nao autorizado' }, { status: 401 });
  }

  // A partir daqui NENHUM caminho responde diferente de 200.
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      // Corpo ilegivel nao tem conserto por repeticao — 200 e segue.
      console.warn('[webhook:asaas] corpo nao e JSON valido; ignorando');
      return ok('corpo ignorado');
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[webhook:asaas] corpo sem os campos minimos; ignorando');
      return ok('corpo ignorado');
    }

    const { id: eventId, event, payment } = parsed.data;

    if (!payment?.id) {
      console.info(`[webhook:asaas] evento ${event ?? '(sem tipo)'} sem cobranca; ignorando`);
      return ok('evento sem cobranca');
    }

    if (event && !HANDLED_EVENTS.has(event)) {
      // Assinar so o necessario e trabalho de configuracao no painel; aqui a
      // postura e reconhecer e ignorar, nunca falhar por evento inesperado.
      console.info(`[webhook:asaas] evento ${event} nao tratado neste MVP; ignorando`);
      return ok('evento nao tratado');
    }

    // -- regra 3 + 4: processa e responde -----------------------------------
    // O processamento e curto (uma consulta ao provedor + uma transacao) e
    // precisa terminar ANTES do 200: gravar o estado e justamente o que a
    // secao 8.2 manda fazer no handler. O que fica para depois sao os EFEITOS
    // (e-mail), marcados abaixo.
    const result = await processCharge(payment.id);

    console.info(
      `[webhook:asaas] ${event ?? '(sem tipo)'} ${payment.id}` +
        `${eventId ? ` (evento ${eventId})` : ''} -> ${result.outcome}`,
    );

    // ======================================================================
    // FASE 4 ENTRA AQUI: efeitos colaterais, SEMPRE assincronos (regra 3).
    //   - outcome 'confirmed'      -> e-mail de confirmacao ao cliente + dono
    //   - outcome 'recorded' com kind 'balance' -> recibo de saldo quitado
    //   - outcome 'refund_pending' -> avisar o dono para estornar
    // Nada disso pode ser aguardado dentro desta requisicao: o Asaas corta em
    // ~10s, e um provedor de e-mail lento derrubaria a fila inteira.
    // ======================================================================

    return ok(result.outcome);
  } catch (error) {
    // -- regra 7: nunca 5xx ---------------------------------------------------
    // Chega aqui o que processCharge NAO trata como regra de negocio: provedor
    // fora do ar, banco indisponivel, bug nosso. Mesmo assim responde 200, de
    // proposito: 15 falhas seguidas interrompem a fila e os eventos somem em 14
    // dias. Este pagamento especifico fica sem confirmar por ate 10 minutos, e o
    // job de reconciliacao (8-B) o pega — que e exatamente o papel dele.
    //
    // O console.error e o que faz isto NAO ser silencioso: e o sinal de que a
    // reconciliacao esta trabalhando por um problema real.
    console.error('[webhook:asaas] falha ao processar; respondendo 200 para nao interromper a fila:', error);
    return ok('erro registrado; sera reconciliado');
  }
}
