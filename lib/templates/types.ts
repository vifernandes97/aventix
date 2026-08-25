// Aventix — forma de um TEMPLATE DE SEGMENTO (CLAUDE.md secao 11-B).
//
// Um template e DADO: descreve como um segmento de negocio (passeio de
// quadriciclo, aluguel de caiaque, quadra por hora) se traduz na modelagem
// generica do Aventix. O seed e a APLICACAO desse dado a um tenant.
//
// Estes tipos descrevem QUALQUER template, nao so o do Quadri Club. No MVP
// existe um unico template (quadriciclo.ts) e nenhum wizard — segmento que nao
// couber ganha template novo, nunca construtor exposto ao usuario (secao 11-B:
// form builder e PROIBIDO).
//
// NOTA sobre os imports `import type`: eles sao APAGADOS na compilacao, entao
// este arquivo (e quem o importa) nao carrega `lib/tenant.ts` em runtime. Isso
// importa porque tenant.ts tem `import 'server-only'`, que LANCA em processo
// Node puro — e o seed roda como script Node, fora do Next.

import type { paymentMethod, paymentMode, priceMode } from '../db/schema';
import type { SettingKey } from '../tenant';

/** Modo de pagamento da experiencia: 'full' | 'deposit' (secao 4.3). */
export type TemplatePaymentMode = (typeof paymentMode.enumValues)[number];

/** Modelo de preco: so 'per_resource' no MVP (secao 4.3). */
export type TemplatePriceMode = (typeof priceMode.enumValues)[number];

/** Reservado: o MVP cobra so por Pix (secao 2). */
export type TemplatePaymentMethod = (typeof paymentMethod.enumValues)[number];

/**
 * Todas as chaves de settings precisam de valor no template. E `Record`
 * completo, nao `Partial`, de proposito: um template novo nao pode ESQUECER uma
 * chave e cair silenciosamente no default de `lib/tenant.ts`. Se a chave nao faz
 * sentido para o segmento, o autor escreve string vazia explicitamente.
 */
export type TemplateSettings = Record<SettingKey, string>;

export type TemplateResource = {
  name: string;
  /** pessoas por recurso (piloto + garupa = 2 no quadriciclo) */
  capacity: number;
  active: boolean;
};

export type TemplateExperience = {
  name: string;
  durationMinutes: number;
  /** tempo entre reservas no mesmo recurso: reabastecer, checar, briefing */
  bufferMinutes: number;
  priceMode: TemplatePriceMode;
  /** em CENTAVOS, inteiro (secao 3). Nunca float. */
  priceCents: number;
  paymentMode: TemplatePaymentMode;
  /**
   * Usados so quando paymentMode = 'deposit'. O CHECK do schema exige
   * EXATAMENTE UM dos dois preenchido nesse caso (secao 4.3).
   */
  depositPercent?: number;
  depositFixedCents?: number;
  /**
   * Idade minima do GARUPA em anos completos NA DATA DO PASSEIO. `0` = sem
   * minimo. Obrigatorio no template (nao opcional) pelo mesmo motivo de
   * TemplateSettings ser Record completo: um segmento novo nao pode ESQUECER a
   * regra de idade e herdar em silencio o default do banco.
   */
  minPassengerAge: number;
  active: boolean;
};

export type TemplateOperatingHours = {
  /** 0=domingo .. 6=sabado (secao 4.3) */
  weekday: number;
  /** 'HH:MM' em America/Sao_Paulo */
  opens: string;
  closes: string;
};

/**
 * Pergunta do onboarding, na LINGUA DO NEGOCIO, mapeada para o campo generico
 * que ela alimenta. E dado declarativo para o wizard da v2 (secao 16) — no MVP
 * ninguem le isto em runtime. Existe aqui para que o template ja carregue a
 * traducao "dominio do cliente -> modelagem generica" enquanto ela esta fresca.
 */
export type OnboardingQuestion = {
  question: string;
  /** caminho no template que a resposta preenche, ex.: 'resources.count' */
  mapsTo: string;
};

export type SegmentTemplate = {
  /** identificador do segmento, ex.: 'quadriciclo' */
  segment: string;
  /** versao do template; suba ao mudar a forma ou os valores padrao */
  version: string;
  settings: TemplateSettings;
  resources: TemplateResource[];
  experiences: TemplateExperience[];
  operatingHours: TemplateOperatingHours[];
  onboardingQuestions: OnboardingQuestion[];
};
