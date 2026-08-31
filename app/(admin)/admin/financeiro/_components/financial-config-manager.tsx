'use client';

// Configuracao financeira: desconto por forma de pagamento e taxa da maquininha
// (CLAUDE.md secao 4-B.6 e 4-B.7).
//
// ============================================================================
// >>> OS DOIS AVISOS QUE ESTA TELA NAO PODE DEIXAR DE DAR <<<
//
// 1. O PRECO DO CATALOGO E O CHEIO; O DESCONTO E APLICADO POR CIMA, NA VENDA.
//    O dono NAO pode baixar o preco da experiencia para o valor-Pix, porque o
//    sistema desconta de novo. Ver o aviso renderizado abaixo, que traz a conta.
//
//    >>> ESTE AVISO JA DISSE O CONTRARIO, E ISSO E O PONTO. <<< Ate 31/08 ele
//    dizia "esta tela ainda nao muda o preco da venda", que era verdade na Fase
//    0 e virou MENTIRA quando a Fase A entrou, em 28/08. Um aviso que envelhece
//    junto com a fase que o motivou nao e detalhe de texto: e a tela instruindo
//    o dono a fazer exatamente o que ela existe para impedir.
//
// 2. A CONFIGURACAO VALE PARA O PROXIMO REGISTRO, NUNCA PARA O PASSADO (secao
//    4-B.7). Editar uma taxa aqui NAO reescreve o liquido de um recebimento ja
//    registrado. Sem o aviso, o dono corrige a taxa em novembro esperando ver o
//    numero de setembro mudar — e o fato de ele NAO mudar e a garantia de que a
//    conferencia com o extrato continua fechando. Desde a Fase D isso deixou de
//    ser hipotetico: ha valores congelados de verdade nas linhas de pagamento.
// ============================================================================
//
// O percentual e digitado como o dono pensa ('7' ou '7,5') e convertido para
// basis points por `parseBasisPoints` ANTES de sair daqui: a API so fala em
// inteiro, e a conversao acontece num algoritmo so, compartilhado com o servidor
// (lib/basis-points.ts e modulo PURO justamente para isso).

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { applyDiscount, formatBasisPoints, parseBasisPoints } from '@/lib/basis-points';
import type {
  CardMachineModalityName,
  CardMachineRateRow,
  PaymentDiscountRow,
  PaymentMethodName,
} from '@/lib/financial-config';

type Props = {
  discounts: PaymentDiscountRow[];
  cardMachineRates: CardMachineRateRow[];
};

const METHOD_LABEL: Record<PaymentMethodName, string> = {
  pix: 'Pix',
  card: 'Cartão',
};

const MODALITY_LABEL: Record<CardMachineModalityName, string> = {
  debit: 'Débito',
  credit: 'Crédito à vista',
  credit_installment: 'Crédito parcelado',
};

const MODALITIES: CardMachineModalityName[] = ['debit', 'credit', 'credit_installment'];

/**
 * Venda de exemplo do simulador de desconto.
 *
 * R$ 100,00 REDONDO, e nao o preco real de uma trilha, de proposito: com cem
 * reais o percentual se le de cabeca (7% -> R$ 7,00) e o dono confere a
 * configuracao sem precisar confiar na conta. Um preco real tambem funcionaria
 * hoje — desde a Fase A o catalogo guarda o CHEIO, que e a base correta —, mas
 * amarraria o exemplo a uma trilha especifica e o deixaria errado no dia em que
 * aquele preco mudasse.
 *
 * A mesma constante alimenta o aviso do topo, que precisa mostrar a conta do
 * desconto aplicado DUAS vezes.
 */
const EXAMPLE_CENTS = 10_000;

const moneyLabel = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export function FinancialConfigManager({ discounts, cardMachineRates }: Props) {
  const pixBasisPoints =
    discounts.find((d) => d.method === 'pix')?.discountBasisPoints ?? 0;

  // A conta do erro, calculada e nao escrita a mao: um exemplo digitado
  // envelhece junto com o percentual, que e a falha que esta faixa acabou de
  // sofrer. Aplicar duas vezes e literalmente o que aconteceria.
  const umaVez = applyDiscount(EXAMPLE_CENTS, pixBasisPoints);
  const duasVezes = applyDiscount(umaVez.payableCents, pixBasisPoints);

  return (
    <div className="flex flex-col gap-6">
      {/* Aviso 1 de 2 — ver o cabecalho. */}
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">
          O preço da experiência é o cheio. O desconto entra por cima, na venda.
        </p>
        <p className="mt-1 text-[13px] leading-relaxed">
          <strong>Não baixe o preço da experiência para o valor com desconto</strong> — o sistema
          desconta de novo, e o cliente passa a pagar menos do que você quer receber.
          {pixBasisPoints > 0 && (
            <>
              {' '}
              Com o Pix a {formatBasisPoints(pixBasisPoints)}%: cadastrando{' '}
              {moneyLabel(EXAMPLE_CENTS)} o cliente paga {moneyLabel(umaVez.payableCents)}; se você
              trocar o cadastro para {moneyLabel(umaVez.payableCents)}, ele passa a pagar{' '}
              {moneyLabel(duasVezes.payableCents)}.
            </>
          )}{' '}
          Nada acusa erro quando isso acontece: some do preço e aparece só na conciliação.
        </p>
      </div>

      <DiscountSection discounts={discounts} />
      <CardMachineSection rates={cardMachineRates} />
    </div>
  );
}

// ============================================================================
// Desconto por forma de pagamento
// ============================================================================

function DiscountSection({ discounts }: { discounts: PaymentDiscountRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-base font-semibold">Desconto por forma de pagamento</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-600">
          O valor cadastrado na experiência é o <strong>preço cheio</strong>. Quem paga por Pix
          recebe desconto; quem paga no cartão paga o cheio.{' '}
          <strong>O cartão nunca fica mais caro</strong> — é o Pix que fica mais barato.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {discounts.map((discount) => (
          <DiscountRow key={discount.method} discount={discount} />
        ))}
      </ul>
    </section>
  );
}

function DiscountRow({ discount }: { discount: PaymentDiscountRow }) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => formatBasisPoints(discount.discountBasisPoints));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const example = applyDiscount(EXAMPLE_CENTS, discount.discountBasisPoints);

  function open() {
    setValue(formatBasisPoints(discount.discountBasisPoints));
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (saving) return;

    const basisPoints = parseBasisPoints(value);
    if (basisPoints === null) {
      setError('Use um percentual como 7 ou 7,5 (no máximo duas casas decimais).');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/financial-config/discounts/${discount.method}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descontoBasisPoints: basisPoints }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 422 && Array.isArray(body?.fields)) {
          setError((body.fields as { message: string }[])[0]?.message ?? 'Revise o percentual.');
          return;
        }
        setError('Não foi possível salvar. Tente de novo em instantes.');
        return;
      }

      setEditing(false);
      router.refresh();
    } catch {
      setError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{METHOD_LABEL[discount.method]}</p>
          <p className="text-xs text-neutral-500">
            {discount.discountBasisPoints === 0
              ? 'Sem desconto — paga o valor cheio'
              : `${formatBasisPoints(discount.discountBasisPoints)}% de desconto`}
          </p>
        </div>

        {!editing && (
          <button
            type="button"
            onClick={open}
            className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Alterar
          </button>
        )}
      </div>

      {/* Simulador. Existe porque "7%" e abstrato e "R$ 93,00" nao e: o dono
          precisa ver o numero que o cliente veria antes de salvar. */}
      <p className="mt-2 text-xs text-neutral-600">
        Numa venda de {moneyLabel(EXAMPLE_CENTS)}, o cliente pagaria{' '}
        <strong>{moneyLabel(example.payableCents)}</strong>
        {example.discountCents > 0 && ` (desconto de ${moneyLabel(example.discountCents)})`}.
      </p>

      {editing && (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-700">Desconto</span>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-label={`Desconto do ${METHOD_LABEL[discount.method]} em porcento`}
              className="w-24 rounded border px-2 py-1 text-sm"
            />
            <span className="text-neutral-700">%</span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ============================================================================
// Taxas da maquininha
// ============================================================================

function CardMachineSection({ rates }: { rates: CardMachineRateRow[] }) {
  const router = useRouter();

  const [form, setForm] = useState<{ id: number | null; modality: CardMachineModalityName; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const configured = new Map(rates.map((rate) => [rate.modality, rate]));
  const missing = MODALITIES.filter((modality) => !configured.has(modality));

  function openCreate(modality: CardMachineModalityName) {
    setForm({ id: null, modality, value: '' });
    setError(null);
  }

  function openEdit(rate: CardMachineRateRow) {
    setForm({ id: rate.id, modality: rate.modality, value: formatBasisPoints(rate.rateBasisPoints) });
    setError(null);
  }

  async function save() {
    if (!form || saving) return;

    const basisPoints = parseBasisPoints(form.value);
    if (basisPoints === null) {
      setError('Use um percentual como 3,49 (no máximo duas casas decimais).');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const editing = form.id !== null;
      const response = await fetch(
        editing
          ? `/api/admin/financial-config/card-machine-rates/${form.id}`
          : '/api/admin/financial-config/card-machine-rates',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modalidade: form.modality, taxaBasisPoints: basisPoints }),
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 422 && Array.isArray(body?.fields)) {
          setError((body.fields as { message: string }[])[0]?.message ?? 'Revise os campos.');
          return;
        }
        // 409: outra linha ja ocupa a modalidade. Dizer QUAL evita que o dono
        // ache que o formulario recusou um percentual digitado certo.
        if (response.status === 409 && body?.code === 'modalidade_ocupada') {
          const conflict = body.conflict as { modality: CardMachineModalityName } | undefined;
          setError(
            conflict
              ? `Já existe taxa cadastrada para ${MODALITY_LABEL[conflict.modality]}. Edite a que já existe.`
              : 'Já existe taxa cadastrada para essa modalidade.',
          );
          return;
        }
        setError('Não foi possível salvar. Tente de novo em instantes.');
        return;
      }

      setForm(null);
      router.refresh();
    } catch {
      setError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(rate: CardMachineRateRow) {
    setRowError(null);

    try {
      const response = await fetch(
        `/api/admin/financial-config/card-machine-rates/${rate.id}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        setRowError('Não foi possível excluir. Tente de novo em instantes.');
        return;
      }

      setConfirmingId(null);
      router.refresh();
    } catch {
      setRowError('Falha de conexão. Verifique a internet e tente de novo.');
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-base font-semibold">Taxas da maquininha</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-600">
          Quanto a operadora do cartão desconta de cada recebimento na maquininha. Serve para o
          sistema saber <strong>quanto você recebeu de verdade</strong> — o cliente nunca vê isso e
          o preço dele não muda.
        </p>
      </header>

      {/* Aviso 2 de 2 — ver o cabecalho do arquivo. */}
      <div className="rounded border border-neutral-300 bg-neutral-50 p-3 text-[13px] leading-relaxed text-neutral-700">
        <p className="font-medium text-neutral-900">Vale para os próximos recebimentos.</p>
        <p className="mt-1">
          Alterar ou apagar uma taxa aqui <strong>não muda um recebimento já registrado</strong>. O
          valor recebido, a taxa da época e o líquido ficam guardados na própria reserva — é isso
          que faz a conferência com o extrato continuar fechando meses depois.
        </p>
      </div>

      {missing.length > 0 && (
        <p className="rounded border border-dashed border-neutral-300 p-3 text-[13px] leading-relaxed text-neutral-600">
          {missing.length === MODALITIES.length
            ? 'Nenhuma taxa cadastrada ainda.'
            : `Faltam: ${missing.map((m) => MODALITY_LABEL[m]).join(', ')}.`}{' '}
          Enquanto a operadora não informar os percentuais, <strong>deixe em branco</strong>. Um
          valor chutado viraria um líquido errado com cara de certo.
        </p>
      )}

      {rowError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {rowError}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {MODALITIES.map((modality) => {
          const rate = configured.get(modality);

          return (
            <li key={modality} className="rounded border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{MODALITY_LABEL[modality]}</p>
                  <p className="text-xs text-neutral-500">
                    {rate ? (
                      `${formatBasisPoints(rate.rateBasisPoints)}% de taxa`
                    ) : (
                      <span className="text-amber-700">Não configurado</span>
                    )}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => (rate ? openEdit(rate) : openCreate(modality))}
                    className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-100"
                  >
                    {rate ? 'Alterar' : 'Cadastrar'}
                  </button>
                  {rate && (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(rate.id)}
                      className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                    >
                      Excluir
                    </button>
                  )}
                </div>
              </div>

              {rate && confirmingId === rate.id && (
                <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm">
                  <p className="text-red-900">
                    Apagar a taxa de {MODALITY_LABEL[modality]}? A modalidade volta para{' '}
                    <strong>não configurada</strong>. Recebimentos já registrados não mudam.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => remove(rate)}
                      className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white"
                    >
                      Apagar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {form?.modality === modality && (
                <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-neutral-700">Taxa</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.value}
                      onChange={(event) =>
                        setForm((f) => (f === null ? null : { ...f, value: event.target.value }))
                      }
                      placeholder="3,49"
                      aria-label={`Taxa de ${MODALITY_LABEL[modality]} em porcento`}
                      className="w-24 rounded border px-2 py-1 text-sm"
                    />
                    <span className="text-neutral-700">%</span>
                  </label>

                  {error && (
                    <p role="alert" className="text-sm text-red-700">
                      {error}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving}
                      className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {saving ? 'Salvando…' : 'Salvar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(null)}
                      className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
