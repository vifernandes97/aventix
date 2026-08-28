// Aventix — aritmetica de percentual em BASIS POINTS (CLAUDE.md secao 4-B).
//
// MODULO PURO: sem banco, sem `server-only`, sem efeito colateral. Mesma
// categoria de lib/cpf.ts e lib/maps.ts — pode ser importado pelo servidor E
// pelo cliente, e e de proposito: a tela do admin precisa mostrar ao dono o
// mesmo numero que o servidor vai calcular, e um segundo algoritmo "so para
// exibir" e como as duas metades divergem.
//
// ============================================================================
// >>> POR QUE BASIS POINT INTEIRO, E NAO PERCENTUAL EM float/numeric <<<
// ============================================================================
// 1 basis point = 0,01%. Logo 7% = 700, e 3,49% = 349.
//
// O sistema inteiro guarda dinheiro como INTEIRO EM CENTAVOS (secao 3: "nunca
// float"). Percentual em ponto flutuante fura essa regra pela porta dos fundos:
// `34999 * 0.07` e um double, e o resultado depende de como o motor arredonda.
// Com basis point nao ha ponto flutuante em lugar nenhum da conta — so
// multiplicacao e divisao de inteiros, e um unico arredondamento explicito.
//
// A conta cabe com folga no inteiro seguro do JS: o maior caso plausivel do
// Quadri Club e 34999 * 10000 = 349.990.000, contra um limite de ~9,007e15.
// Nao ha caminho realista para perda de precisao aqui.
// ============================================================================

/** 100% em basis points. 1 bp = 0,01%. */
export const BASIS_POINTS_SCALE = 10_000;

/**
 * A parte de `cents` correspondente a `basisPoints`, arredondada ao centavo.
 *
 * >>> ARREDONDAMENTO: `Math.round`, meio para CIMA, e ELE E A REGRA <<<
 * 34999 x 700 / 10000 = 2449,93 -> 2450. Nao ha aqui a escolha "para cima" da
 * secao 4-B.5: aquela regra governa a divisao ENTRADA/SALDO do sinal, onde
 * alguem precisa ficar com o centavo impar. Esta funcao calcula UMA parte, e o
 * complemento e sempre obtido por subtracao (ver `splitByBasisPoints`) — nunca
 * por um segundo calculo independente, que fecharia na maioria dos valores e
 * falharia em alguns.
 *
 * `Math.round` e totalmente especificado pelo ECMA-262 e opera aqui sobre um
 * quociente exato de inteiros: mesmo resultado em qualquer motor, hoje e daqui
 * a dois anos.
 *
 * @throws {RangeError} entrada nao inteira — centavo fracionado e bp fracionado
 * nao existem, e aceita-los silenciosamente propagaria o erro para o dinheiro.
 */
export function partOfCents(cents: number, basisPoints: number): number {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`valor em centavos precisa ser inteiro, recebido ${cents}`);
  }
  if (!Number.isInteger(basisPoints)) {
    throw new RangeError(`basis points precisa ser inteiro, recebido ${basisPoints}`);
  }
  if (cents < 0) {
    throw new RangeError(`valor em centavos nao pode ser negativo, recebido ${cents}`);
  }
  if (basisPoints < 0) {
    throw new RangeError(`basis points nao pode ser negativo, recebido ${basisPoints}`);
  }

  return Math.round((cents * basisPoints) / BASIS_POINTS_SCALE);
}

/**
 * Divide `cents` em (parte, resto), com o RESTO SEMPRE POR SUBTRACAO.
 *
 * `part + rest === cents` vale por CONSTRUCAO, jamais por coincidencia — que e
 * a mesma exigencia que a secao 4-B.5 faz para entrada e saldo do sinal.
 * Calcular as duas metades de forma independente produz um par que fecha na
 * maioria dos valores e falha em alguns, e a falha aparece como um centavo de
 * diferenca entre o que o sistema diz e o que o cliente pagou — no extrato,
 * semanas depois.
 */
export function splitByBasisPoints(
  cents: number,
  basisPoints: number,
): { part: number; rest: number } {
  const part = partOfCents(cents, basisPoints);
  return { part, rest: cents - part };
}

/**
 * Preco cheio -> preco com desconto do metodo (secao 4-B.1 e 4-B.2).
 *
 * >>> O CHEIO E O CADASTRADO; O DESCONTO SUBTRAI. NUNCA "cheio + taxa". <<<
 * Trilha da Montanha: 34999 com 700 bp -> desconto 2450, cliente paga 32549
 * (R$ 325,49) — exatamente o valor da tabela da secao 4-B.2.
 *
 * NADA CHAMA ESTA FUNCAO AINDA. A Fase 0 so faz a configuracao existir; ligar o
 * preco a ela e Fase A (secao 17). Ela nasce aqui, e nao na Fase A, porque a
 * REGRA DE ARREDONDAMENTO precisa ser decidida e provada uma vez so, no mesmo
 * lugar em que o percentual passou a ser armazenado.
 */
export function applyDiscount(
  fullPriceCents: number,
  discountBasisPoints: number,
): { discountCents: number; payableCents: number } {
  const { part, rest } = splitByBasisPoints(fullPriceCents, discountBasisPoints);
  return { discountCents: part, payableCents: rest };
}

/**
 * Valor bruto -> liquido, descontada a taxa da adquirente (secao 4-B.7).
 *
 * >>> SO PARA MAQUININHA <<<
 * Para o que passa pelo Asaas, o liquido e LIDO do Asaas (eles informam na
 * consulta da cobranca), nunca recalculado. So a maquininha exige conta, porque
 * acontece fora do provedor.
 *
 * O resultado desta funcao e para ser CONGELADO na linha do pagamento junto com
 * bruto, modalidade e percentual aplicado. Depois disso o sistema so LE. Ver o
 * cabecalho de cardMachineRates em lib/db/schema.ts.
 */
export function applyRate(
  grossCents: number,
  rateBasisPoints: number,
): { feeCents: number; netCents: number } {
  const { part, rest } = splitByBasisPoints(grossCents, rateBasisPoints);
  return { feeCents: part, netCents: rest };
}

// ============================================================================
// Formatacao — exibicao, nunca calculo
// ============================================================================

/** 700 -> '7', 349 -> '3,49', 0 -> '0'. Sem zeros a direita inuteis. */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100);
  if (fraction === 0) return String(whole);
  return `${whole},${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * '7' | '7,5' | '3,49' -> basis points. `null` quando nao e percentual valido.
 *
 * Aceita virgula E ponto: o dono digita virgula (pt-BR), e um `<input>` colado
 * de planilha vem com ponto. Recusar um dos dois viraria "valor invalido" sobre
 * um numero que a pessoa digitou certo.
 *
 * >>> A CONVERSAO NAO USA PONTO FLUTUANTE <<<
 * `Math.round(Number('3.49') * 100)` funcionaria para quase todo valor e erraria
 * em algum — e seria justamente o erro que o resto deste modulo evita. Aqui a
 * parte inteira e a decimal sao lidas como inteiros separados.
 */
export function parseBasisPoints(input: string): number | null {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;

  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
