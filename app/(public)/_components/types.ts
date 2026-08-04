// Estado do wizard e as validacoes de conveniencia.
//
// >>> ESTAS VALIDACOES NAO SAO DEFESA <<<
// Elas existem para o cliente saber CEDO que falta um condutor, em vez de
// descobrir no POST depois de preencher tudo. A defesa real e createReservation
// (secao 5.2), que refaz cada uma dentro da transacao e devolve 422. Um cliente
// que burle o front nao consegue gravar nada invalido.
//
// A excecao esta anotada em `minorOperators`: a maioridade do condutor NAO tem
// contrapartida no servidor hoje.

import type { PublicExperience } from '@/lib/experiences';

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
};

export type WizardState = {
  experience: PublicExperience | null;
  resourcesNeeded: number;
  date: string | null;
  /** Instante ISO do slot escolhido — vai cru para o POST. */
  startAt: string | null;
  responsible: ResponsibleForm;
  /** Participantes ALEM do responsavel. */
  others: PersonForm[];
  termoAccepted: boolean;
};

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

    if (person.role === 'operator') {
      const age = ageFromBirthdate(person.birthdate);

      // >>> UNICA REGRA SEM ESPELHO NO SERVIDOR <<<
      // createReservation NAO valida maioridade, e o CLAUDE.md nao registra a
      // regra. Enquanto for assim, esta checagem e a UNICA barreira: um POST
      // direto cadastra menor como condutor sem erro nenhum. Se a regra for
      // real (dirigir quadriciclo exige CNH, que exige 18), o lugar dela e
      // createReservation + secao 15 do CLAUDE.md — e ai esta linha volta a ser
      // o que as outras ja sao, conveniencia.
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
