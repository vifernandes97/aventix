'use client';

// "Recebi na maquininha" — registro manual do saldo (CLAUDE.md secao 11.1,
// Fase D; regras em 4-B.6 e 4-B.7).
//
// >>> O GUIA CONFIRMA VENDO OS TRES NUMEROS. <<<
// "Recebido R$ 162,74 · taxa de credito a vista 5% · liquido R$ 154,60". Nada
// de calcular depois: o dono precisa enxergar, no instante do registro, que o
// cliente pagou um valor e o Quadri Club vai receber outro. O cliente final nao
// ve e nao paga a taxa.
//
// O calculo da previa usa `applyRate`, a MESMA funcao do servidor (modulo puro,
// sem `server-only`) — mesmo precedente da Fase A, em que o wizard chama a
// mesma `applyDiscount`. Duas implementacoes do mesmo percentual divergem, e a
// divergencia aparece como um centavo entre o que a tela mostrou e o que ficou
// gravado.
//
// >>> TAXA AUSENTE NUNCA VIRA ZERO, E NUNCA VIRA CAMPO EM BRANCO. <<<
// Sem taxa configurada o registro CONTINUA sendo possivel (decisao de 31/08 —
// recusar nao impede o dinheiro de ter sido recebido, impede so o sistema de
// saber), mas a tela diz em palavras que o liquido nao foi calculado. Campo
// vazio se le como zero, e zero e a mentira que faz o liquido parecer igual ao
// bruto.

import { useCallback, useMemo, useState } from 'react';

import { applyRate, formatBasisPoints } from '@/lib/basis-points';

import { moneyLabel } from './shared';

type Modality = 'debit' | 'credit' | 'credit_installment';

export type CardMachineRate = { modality: Modality; rateBasisPoints: number };

type Props = {
  reservationId: string;
  /** Saldo em aberto — vira o valor default, editavel. */
  balanceCents: number;
  rates: CardMachineRate[];
  /** Chamado depois de registrar, para o painel e a grade recarregarem. */
  onRegistered: () => void;
};

const MODALITY_LABEL: Record<Modality, string> = {
  debit: 'Débito',
  credit: 'Crédito à vista',
  credit_installment: 'Crédito parcelado',
};

const MODALITIES: readonly Modality[] = ['debit', 'credit', 'credit_installment'];

const CODE_MESSAGE: Record<string, string> = {
  saldo_ja_liquidado:
    'Este saldo já consta como pago — provavelmente o cliente pagou por Pix. Registrar de novo somaria o mesmo dinheiro duas vezes.',
  reserva_inativa: 'A reserva foi cancelada ou expirou.',
  saldo_indisponivel: 'A linha de saldo não pode receber registro.',
  valor_invalido: 'O valor recebido precisa ser maior que zero.',
  modalidade_invalida: 'Modalidade inválida.',
};

/** Centavos -> '162,74' para o input. Sem float: string sobre inteiro. */
function centsToInput(cents: number): string {
  const s = String(Math.abs(cents)).padStart(3, '0');
  return `${s.slice(0, -2)},${s.slice(-2)}`;
}

/** '162,74' | '162.74' | '162' -> centavos inteiros, ou null. */
function inputToCents(value: string): number | null {
  const cleaned = value.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function ReceiveInCash({ reservationId, balanceCents, rates, onRegistered }: Props) {
  const [open, setOpen] = useState(false);
  const [grossInput, setGrossInput] = useState(() => centsToInput(balanceCents));
  const [modality, setModality] = useState<Modality>('credit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const grossCents = useMemo(() => inputToCents(grossInput), [grossInput]);

  const rateBasisPoints = useMemo(() => {
    const found = rates.find((r) => r.modality === modality);
    // >>> `undefined` NAO cai para 0. <<< Ausente e "nao sei".
    return found ? found.rateBasisPoints : null;
  }, [rates, modality]);

  const preview = useMemo(() => {
    if (grossCents === null || rateBasisPoints === null) return null;
    return applyRate(grossCents, rateBasisPoints);
  }, [grossCents, rateBasisPoints]);

  const registrar = useCallback(async () => {
    if (saving || grossCents === null) return;

    setSaving(true);
    setError(null);
    setWarning(null);

    try {
      const response = await fetch(
        `/api/admin/reservations/${reservationId}/balance/receive-in-cash`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ valorBrutoCentavos: grossCents, modalidade: modality }),
        },
      );
      const body = (await response.json()) as {
        code?: string;
        detail?: string;
        providerCharge?: 'nao_havia' | 'cancelada' | 'falhou';
      };

      if (!response.ok) {
        setError(
          (body.code && CODE_MESSAGE[body.code]) ??
            body.detail ??
            `Não foi possível registrar (HTTP ${response.status}).`,
        );
        return;
      }

      // O saldo foi registrado, mas a cobranca Pix segue PAGAVEL. Isto precisa
      // ser dito alto: sem cancelar, o cliente paga de novo em casa achando que
      // ainda deve, e aquele dinheiro entra na conta sem aparecer no sistema.
      if (body.providerCharge === 'falhou') {
        setWarning(
          'Registrado, mas NÃO foi possível cancelar a cobrança Pix do saldo. ' +
            'Cancele no painel do Asaas, senão o cliente consegue pagar de novo.',
        );
      }

      setOpen(false);
      onRegistered();
    } catch {
      setError('Falha de rede ao registrar.');
    } finally {
      setSaving(false);
    }
  }, [saving, grossCents, reservationId, modality, onRegistered]);

  if (warning) {
    return (
      <p
        role="alert"
        className="mt-2 rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
      >
        {warning}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border px-3 py-2.5 text-sm font-medium dark:border-neutral-700"
      >
        Recebi na maquininha
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-neutral-600 dark:text-neutral-400">Valor recebido (R$)</span>
        <input
          type="text"
          inputMode="decimal"
          value={grossInput}
          onChange={(event) => setGrossInput(event.target.value)}
          className="rounded border px-2 py-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-neutral-600 dark:text-neutral-400">Modalidade</span>
        <select
          value={modality}
          onChange={(event) => setModality(event.target.value as Modality)}
          className="rounded border px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {MODALITIES.map((m) => (
            <option key={m} value={m}>
              {MODALITY_LABEL[m]}
            </option>
          ))}
        </select>
      </label>

      {/* OS TRES NUMEROS, antes de confirmar. */}
      {grossCents === null ? (
        <p className="text-xs text-red-700 dark:text-red-300">Valor inválido.</p>
      ) : preview && rateBasisPoints !== null ? (
        <p className="rounded bg-neutral-100 px-2 py-1.5 text-xs tabular-nums dark:bg-neutral-900">
          Recebido <strong>{moneyLabel(grossCents)}</strong> · taxa de{' '}
          {MODALITY_LABEL[modality].toLowerCase()} {formatBasisPoints(rateBasisPoints)}% · líquido{' '}
          <strong>{moneyLabel(preview.netCents)}</strong>
        </p>
      ) : (
        // Nao e campo em branco: e uma frase. Ver o cabecalho.
        <p className="rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
          Líquido <strong>não calculado</strong>: a taxa de{' '}
          {MODALITY_LABEL[modality].toLowerCase()} não está configurada em Financeiro. O
          recebimento é registrado assim mesmo, e o líquido fica pendente.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={registrar}
          disabled={saving || grossCents === null}
          className="flex-1 rounded-md bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? 'Registrando…' : 'Confirmar recebimento'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border px-3 py-2.5 text-sm dark:border-neutral-700"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
