// Aventix — conversao de dinheiro para a borda do provedor de pagamento.
//
// O banco guarda CENTAVOS INTEIROS (CLAUDE.md secao 3: "inteiro em centavos,
// nunca float"). O Asaas — e provedor de pagamento em geral — espera reais com
// decimal (325.49). Esta e a UNICA travessia entre os dois mundos.
//
// >>> POR QUE NAO `cents / 100` <<<
// Divisao em ponto flutuante e correta na maioria dos valores e erra em alguns,
// e o erro nao aparece no numero: aparece na SERIALIZACAO. O risco real nao e
// "325.48999999" na tela, e um centavo de diferenca entre o que o banco diz que
// a reserva custa e o que o cliente foi cobrado — divergencia que so seria
// notada na conciliacao, depois do dinheiro ter entrado.
//
// A implementacao abaixo NAO usa aritmetica de ponto flutuante em momento
// nenhum: e manipulacao de string sobre o inteiro. Nao ha divisao para arredondar.

/**
 * Centavos inteiros -> string decimal com EXATAMENTE duas casas ("325.49").
 *
 * String e a forma canonica de proposito: e a unica representacao que nao pode
 * perder o zero final (32500 -> "325.00", nunca "325") nem ganhar residuo
 * binario. Quem precisa de numero passa por `centsToReaisNumber`.
 *
 * @throws {RangeError} valor nao inteiro — centavo fracionado nao existe.
 */
export function centsToReais(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`valor em centavos precisa ser inteiro, recebido ${cents}`);
  }

  const negative = cents < 0;
  // padStart(3) garante ao menos "0XX", de modo que 5 -> "005" -> "0.05".
  const digits = String(Math.abs(cents)).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Mesma conversao, como numero — para o corpo JSON do provedor.
 *
 * Passa OBRIGATORIAMENTE por `centsToReais`: o parse de uma string decimal com
 * duas casas produz o double mais proximo, e `JSON.stringify` o reserializa com
 * a representacao mais curta que faz round-trip, ou seja, a mesma string. Nao
 * existe caminho alternativo de conversao neste modulo, de proposito.
 */
export function centsToReaisNumber(cents: number): number {
  return Number(centsToReais(cents));
}
