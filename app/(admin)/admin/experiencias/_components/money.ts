// Reais digitados <-> centavos inteiros (CLAUDE.md secao 3: dinheiro e inteiro
// em centavos, nunca float).
//
// >>> POR QUE ISTO NAO E UM parseFloat(x) * 100 <<<
// `parseFloat('325.49') * 100` da 32548.999999999996, e o Math.round esconde o
// problema ate o valor em que ele deixa de esconder. Aqui as duas partes sao
// separadas como TEXTO e so viram numero depois de concatenadas — nenhum ponto
// flutuante participa da conta.
//
// A conversao acontece na BORDA: o dono digita reais porque e assim que ele
// pensa no preco, e o que trafega e sai daqui e centavo inteiro.

/**
 * 'R$ 1.234,56' | '1234,56' | '1234.56' | '1234' -> 123456 centavos.
 *
 * @returns `null` quando o texto nao e um valor monetario reconhecivel. Cabe a
 *          quem chama transformar isso em mensagem — este modulo nao decide UI.
 *
 * AMBIGUIDADE DO PONTO, e como ela se resolve: em pt-BR o separador decimal e a
 * virgula e o ponto e milhar, mas gente digita '325.49' o tempo todo. A regra:
 *   - havendo virgula, ela e o decimal e todo ponto e milhar ('1.234,56');
 *   - sem virgula, um ponto seguido de EXATAMENTE 3 digitos e milhar ('1.234'),
 *     e qualquer outro ponto e decimal ('325.49' -> 325 reais e 49 centavos).
 * Nenhuma regra acerta 100% das intencoes — por isso o campo REESCREVE o valor
 * formatado quando perde o foco, e o dono ve o que foi entendido antes de
 * salvar. A regra reduz o engano; o eco e o que o elimina.
 */
export function parseReaisToCents(input: string): number | null {
  const cleaned = input
    .replace(/R\$/gi, '')
    // \s nao cobre o espaco estreito que o Intl usa em pt-BR ('R$ 1.234,56').
    .replace(/[\s  ]/g, '');

  if (cleaned === '') return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+([.,]\d+)?$/.test(cleaned)) return null;

  let integerPart: string;
  let decimalPart: string;

  if (cleaned.includes(',')) {
    const [int, dec = ''] = cleaned.split(',');
    integerPart = int.replace(/\./g, '');
    decimalPart = dec;
  } else if (/^\d+\.\d{3}$/.test(cleaned)) {
    // '1.234' — milhar sem centavos.
    integerPart = cleaned.replace('.', '');
    decimalPart = '';
  } else if (cleaned.includes('.')) {
    const [int, dec = ''] = cleaned.split('.');
    integerPart = int;
    decimalPart = dec;
  } else {
    integerPart = cleaned;
    decimalPart = '';
  }

  // Mais de duas casas nao e arredondado em silencio: '10,999' seria 10,99 ou
  // 11,00 dependendo de quem le, e adivinhar o preco de alguem e pior que pedir
  // para redigitar.
  if (decimalPart.length > 2) return null;
  if (!/^\d+$/.test(integerPart)) return null;
  if (decimalPart !== '' && !/^\d+$/.test(decimalPart)) return null;

  const cents = Number(`${integerPart}${decimalPart.padEnd(2, '0')}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 32549 -> '325,49'. Sem 'R$': o prefixo e desenhado ao lado do campo. */
export function centsToReaisInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
