// Aventix — validacao e normalizacao de CPF.
//
// >>> MODULO PURO, COMPARTILHADO ENTRE SERVIDOR E CLIENTE <<<
// Sem `server-only`, sem import de banco, sem dependencia nova: e aritmetica.
// Isso e proposital — o algoritmo do digito verificador precisa ser O MESMO nos
// dois lados. O front valida para o cliente errar cedo e barato; o servidor
// valida porque e ele que defende. Duas implementacoes divergiriam com o tempo,
// e a divergencia apareceria como "o formulario aceitou e o POST recusou".
//
// Contraste deliberado com `normalizePhone`, que vive em lib/reservations.ts e
// nao pode ser importado por Client Component (aquele modulo carrega Postgres),
// obrigando `types.ts` a manter uma checagem leve e separada. Aqui nao ha esse
// custo, entao nao ha duplicacao.
//
// >>> POR QUE VALIDAR O DIGITO, E NAO SO O COMPRIMENTO <<<
// O Asaas so recusa CPF invalido na criacao da COBRANCA, que acontece depois de
// a reserva ja existir. Um digito trocado ali derruba a cobranca, expira a
// reserva e devolve a vaga — o cliente perde o horario sem entender por que.
// Conferir onze digitos custa nada e transforma a falha mais cara do fluxo num
// aviso embaixo do campo.
//
// >>> PRIVACIDADE <<<
// CPF e dado sensivel. Nenhuma funcao deste modulo loga, e os erros que ele
// alimenta NUNCA ecoam o valor recebido — so dizem que e invalido. Mesmo
// contrato de app/api/admin/reservations/[id]/route.ts.

/** Reduz a digitos: aceita "123.456.789-09" e "12345678909" igualmente. */
export function normalizeCpf(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Digito verificador do CPF, pelo algoritmo da Receita Federal.
 *
 * Os dois ultimos digitos sao checksums dos anteriores: cada posicao recebe um
 * peso decrescente, soma-se tudo, e o digito e `11 - (soma % 11)`, virando 0
 * quando o resultado e 10 ou 11.
 *
 * Rejeita tambem os onze digitos repetidos ("111.111.111-11" e companhia): eles
 * PASSAM na aritmetica do checksum, mas nao sao CPFs validos, e sao exatamente
 * o que alguem digita para "preencher qualquer coisa".
 *
 * @param raw com ou sem pontuacao.
 */
export function isValidCpf(raw: string | null | undefined): boolean {
  const digits = normalizeCpf(raw);

  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Confere os dois digitos verificadores com o mesmo laco: o primeiro usa os 9
  // digitos iniciais (peso a partir de 10), o segundo usa 10 (peso a partir de 11).
  for (const [length, startWeight] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(digits[i]) * (startWeight - i);
    }

    const remainder = sum % 11;
    const expected = remainder < 2 ? 0 : 11 - remainder;

    if (Number(digits[length]) !== expected) return false;
  }

  return true;
}

/** Formata para exibicao: "12345678909" -> "123.456.789-09". Nao valida. */
export function formatCpf(raw: string | null | undefined): string {
  const digits = normalizeCpf(raw).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}
