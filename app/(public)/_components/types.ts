// Estado do wizard e as validacoes de conveniencia.
//
// >>> ESTAS VALIDACOES NAO SAO DEFESA <<<
// Elas existem para o cliente saber CEDO que falta um condutor, em vez de
// descobrir no POST depois de preencher tudo. A defesa real e createReservation
// (secao 5.2), que refaz cada uma dentro da transacao e devolve 422. Um cliente
// que burle o front nao consegue gravar nada invalido.
//
// Desde 17/08/2026 nao ha excecao: toda regra deste arquivo tem contrapartida
// no servidor, incluindo a maioridade do condutor e o CPF do responsavel.

import { isValidCpf, normalizeCpf } from '@/lib/cpf';
import type { PublicExperience } from '@/lib/experiences';
// lib/time.ts e modulo PURO (so date-fns-tz), como lib/cpf.ts: pode ser
// importado pelo Client Component. Nao confundir com lib/tenant.ts /
// lib/reservations.ts, que sao server-only.
import { ageOnDate, utcToLocalDate } from '@/lib/time';

import { ageFromBirthdate } from './shared';

export type Role = 'operator' | 'passenger';

/** Um participante do formulario. O responsavel e um destes, com contato junto. */
export type PersonForm = {
  /** Chave estavel de lista: o indice quebraria ao remover alguem do meio. */
  key: string;
  name: string;
  birthdate: string;
  role: Role;
  documentNumber: string;
};

export type ResponsibleForm = PersonForm & {
  phone: string;
  email: string;
  /**
   * CPF do responsavel. So do RESPONSAVEL, nao de cada participante: quem paga
   * e ele, e e o CPF do pagador que o Asaas exige para emitir a cobranca. Pedir
   * de todo mundo seria coletar dado sensivel sem uso.
   */
  cpf: string;
};

/** Contato a acionar em caso de necessidade durante o passeio (passo 5, bloco 1). */
export type EmergencyContactForm = {
  name: string;
  phone: string;
};

/** As tres formas de pagar da secao 4-B.2. `pix_deposit` so quando a experiencia oferece sinal. */
export type PaymentChoice = 'pix_full' | 'pix_deposit' | 'card';

export type WizardState = {
  experience: PublicExperience | null;
  resourcesNeeded: number;
  /**
   * COMO o cliente escolheu pagar — as tres formas da secao 4-B.2, num valor so.
   *
   * ==========================================================================
   * >>> UM CAMPO, NAO DOIS, PARA A COMBINACAO PROIBIDA NAO EXISTIR. <<<
   * O servidor recebe duas dimensoes (`paymentMethod` e `paymentMethodMode`), e
   * uma das quatro combinacoes e invalida: cartao com sinal (o sinal existe
   * somente no Pix). Guardar as duas separadas aqui criaria um estado
   * REPRESENTAVEL e proibido, que so seria pego no 422 do servidor — depois de o
   * cliente preencher os passos seguintes.
   *
   * Com um valor unico a combinacao invalida nao tem como ser escrita, e a
   * traducao para os dois campos do corpo acontece num ponto so, no submit.
   * ==========================================================================
   *
   * Nasce 'pix_full', que e o caminho que sempre existe.
   */
  paymentChoice: PaymentChoice;
  date: string | null;
  /** Instante ISO do slot escolhido — vai cru para o POST. */
  startAt: string | null;
  responsible: ResponsibleForm;
  /** Participantes ALEM do responsavel. */
  others: PersonForm[];
  emergencyContact: EmergencyContactForm;
  /** Checkbox 1 do passo 5 — obrigatorio, so habilita apos scroll-to-end do termo. */
  termoAccepted: boolean;
  /** Checkbox 2 do passo 5 — opcional, sem efeito no servidor. */
  imageConsent: boolean;
};

export const emptyEmergencyContact = (): EmergencyContactForm => ({ name: '', phone: '' });

/**
 * Checagem LEVE de conveniencia (mesma ressalva do topo do arquivo: nao e
 * defesa). So conta digitos — a normalizacao completa de telefone brasileiro
 * (normalizePhone, com a regra do DDI e do 10/11 digitos) vive em
 * lib/reservations.ts, que importa Postgres e nao pode entrar num Client
 * Component. O servidor reaplica a regra real e recusa o que passar daqui.
 */
export function hasValidEmergencyContact(contact: EmergencyContactForm): boolean {
  return contact.name.trim().length > 0 && contact.phone.replace(/\D/g, '').length >= 10;
}

/** Idade minima para conduzir. Ver a nota em `minorOperators`. */
export const MIN_OPERATOR_AGE = 18;

export const emptyPerson = (key: string, role: Role = 'passenger'): PersonForm => ({
  key,
  name: '',
  birthdate: '',
  role,
  documentNumber: '',
});

// ============================================================================
// Validacao do passo de participantes
// ============================================================================

export type PeopleValidation = {
  /** Todos os participantes, responsavel primeiro — a ordem que vai no POST. */
  everyone: PersonForm[];
  operators: number;
  capacity: number;
  /** Bloqueia o avanco. Vazio = pode seguir. */
  errors: string[];
  /** Campos individuais em erro, por `key` do participante. */
  perPerson: Record<string, string[]>;
};

export function validatePeople(params: {
  state: WizardState;
  capacityPerResource: number;
  documentRequired: boolean;
  labels: { operator: string; passenger: string; document: string; resource: string };
}): PeopleValidation {
  const { state, capacityPerResource, documentRequired, labels } = params;

  const everyone: PersonForm[] = [state.responsible, ...state.others];
  const operators = everyone.filter((p) => p.role === 'operator').length;

  // Capacidade = soma das capacities dos recursos alocados (decisao de 27/07).
  // Aqui todos os recursos tem a mesma, entao multiplicar da o mesmo numero; o
  // servidor faz a soma real dos recursos que ELE alocou, e e a dele que vale.
  const capacity = capacityPerResource * state.resourcesNeeded;

  // Regra de idade do garupa: vem da EXPERIENCIA escolhida, nunca de constante
  // (a Montanha exige 12 e a Fazenda 6). Sem experiencia ou sem horario
  // escolhido a checagem nao roda — nos passos anteriores nao ha o que validar,
  // e o servidor cobre o caso de qualquer jeito.
  const minPassengerAge = state.experience?.minPassengerAge ?? 0;
  const tripDate = state.startAt ? utcToLocalDate(new Date(state.startAt)) : null;

  const errors: string[] = [];
  const perPerson: Record<string, string[]> = {};

  const addPersonError = (key: string, message: string) => {
    (perPerson[key] ??= []).push(message);
  };

  for (const person of everyone) {
    if (!person.name.trim()) addPersonError(person.key, 'Informe o nome.');

    if (!person.birthdate) {
      addPersonError(person.key, 'Informe a data de nascimento.');
    } else if (ageFromBirthdate(person.birthdate) === null) {
      addPersonError(person.key, 'Data de nascimento inválida.');
    }

    // Idade minima do GARUPA, quando a experiencia exigir (0 = sem minimo).
    //
    // A conta e na DATA DO PASSEIO (`state.startAt`), nao hoje — uma crianca que
    // completa a idade antes de viajar pode ir. Por isso usa `ageOnDate` e nao
    // `ageFromBirthdate`, que ancora em hoje e serve para o condutor.
    //
    // ESPELHO do servidor (createReservation), nao a defesa: um POST direto e
    // recusado com 422 de qualquer forma. Existe para o cliente descobrir no
    // passo 4, e nao depois de preencher tudo e ir pagar.
    if (person.role === 'passenger' && minPassengerAge > 0 && tripDate) {
      const age = person.birthdate ? ageOnDate(person.birthdate, tripDate) : null;
      if (age !== null && age < minPassengerAge) {
        addPersonError(
          person.key,
          `${labels.passenger} precisa ter ${minPassengerAge} anos ou mais na data do passeio.`,
        );
      }
    }

    if (person.role === 'operator') {
      const age = ageFromBirthdate(person.birthdate);

      // JA TEM ESPELHO NO SERVIDOR desde 17/08/2026: createReservation recusa
      // operador sem 18 anos completos na data do agendamento (e recusa tambem
      // operador sem data de nascimento, que antes passava). Esta checagem
      // voltou a ser o que as outras sao: conveniencia, para o cliente errar
      // cedo. Um POST direto com menor responde 422.
      if (age !== null && age < MIN_OPERATOR_AGE) {
        addPersonError(
          person.key,
          `${labels.operator} precisa ter ${MIN_OPERATOR_AGE} anos ou mais.`,
        );
      }

      if (documentRequired && !person.documentNumber.trim()) {
        addPersonError(person.key, `${labels.document} é obrigatório para ${labels.operator}.`);
      }
    }
  }

  if (!state.responsible.phone.trim()) {
    addPersonError(state.responsible.key, 'Informe o telefone.');
  }

  // CPF do responsavel. Diferente das outras checagens deste arquivo, esta usa a
  // MESMA funcao que o servidor (lib/cpf.ts) — o digito verificador nao admite
  // "versao leve", e duas implementacoes divergiriam. O servidor reaplica.
  const cpfDigits = normalizeCpf(state.responsible.cpf);
  if (!cpfDigits) {
    addPersonError(state.responsible.key, 'Informe o CPF.');
  } else if (!isValidCpf(cpfDigits)) {
    addPersonError(state.responsible.key, 'CPF inválido. Confira os números.');
  }

  // Espelha createReservation: cada recurso precisa de alguem que o conduza.
  if (operators < state.resourcesNeeded) {
    errors.push(
      `São necessários ao menos ${state.resourcesNeeded} ${labels.operator.toLowerCase()}(es) ` +
        `para ${state.resourcesNeeded} ${labels.resource.toLowerCase()}(s).`,
    );
  }

  if (everyone.length > capacity) {
    errors.push(`Capacidade máxima de ${capacity} pessoas para esta escolha.`);
  }

  const hasPersonError = Object.values(perPerson).some((list) => list.length > 0);

  return {
    everyone,
    operators,
    capacity,
    errors: hasPersonError ? [...errors, 'Revise os dados marcados em vermelho.'] : errors,
    perPerson,
  };
}
