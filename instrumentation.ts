// Aventix — bootstrap do processo Next (CLAUDE.md secao 12).
//
// O Next executa `register()` uma vez no boot do servidor. E o unico lugar do
// app com ciclo de vida de PROCESSO (e nao de requisicao), entao e onde o cron
// de expiracao de hold e agendado.
//
// Este arquivo SO AGENDA. A logica vive em lib/jobs/expire-holds.ts, testavel
// isolada e reusavel pelo job de reconciliacao da Fase 2 (secao 8-B).
//
// Next 16: `instrumentation.ts` e estavel, na raiz do projeto, sem flag no
// next.config (o antigo `experimental.instrumentationHook` foi removido).
//
// Sobre `server-only`: a cadeia importada abaixo (expire-holds -> reservations
// -> tenant/availability) atravessa dois modulos que declaram `server-only`.
// MEDIDO neste projeto: o import resolve normalmente aqui e o boot fica limpo,
// porque o Next compila o instrumentation com a condicao de exportacao
// `react-server` ativa. O mesmo import em processo Node CRU (um `tsx` avulso,
// por exemplo) lanca "This module cannot be imported from a Client Component
// module" — foi por isso que scripts/seed.ts nao importa lib/tenant.ts.

import cron from 'node-cron';

import { checkAuthConfig } from './lib/auth';
import { expireHolds } from './lib/jobs/expire-holds';
import { reconcilePayments } from './lib/jobs/reconcile-payments';
import { checkAsaasConfig } from './lib/payments/asaas';

/** Flag no globalThis, mesmo padrao de lib/db/client.ts. */
const globalForCron = globalThis as unknown as {
  holdCronRegistered?: boolean;
  reconcileCronRegistered?: boolean;
};

export async function register() {
  // Agenda so no runtime Node. Nas execucoes deste projeto o instrumentation foi
  // avaliado UMA vez, sempre com NEXT_RUNTIME='nodejs' — nao ha codigo edge aqui
  // hoje. A guarda custa uma comparacao e evita agendar um timer com acesso a
  // banco caso isso mude.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // -- fail-fast da configuracao de autenticacao (CLAUDE.md secao 13) --------
  //
  // AQUI e nao no topo de lib/auth.ts: o Easypanel injeta as variaveis em
  // RUNTIME, nao no build (secao 2), entao validar no import derrubaria o
  // `next build` dentro do Docker, onde ADMIN_* legitimamente ainda nao existem.
  // register() so roda quando o SERVIDOR sobe — que e o "boot" que interessa.
  //
  // AVISA E SEGUE, nao derruba o processo: o site publico de reservas nao
  // depende de auth nenhuma, e tirar a venda do ar por causa de uma variavel do
  // painel seria trocar um problema por um pior. O admin fica inoperante (toda
  // tentativa de login responde 500) e o log diz exatamente o que falta.
  const authConfig = checkAuthConfig();
  if (authConfig.ok) {
    console.log('[auth] configuracao do admin validada');
  } else {
    console.error('='.repeat(78));
    console.error('[auth] CONFIGURACAO DO ADMIN INVALIDA — O PAINEL NAO VAI FUNCIONAR');
    console.error(authConfig.message);
    console.error('O site publico de reservas continua no ar normalmente.');
    console.error('='.repeat(78));
  }

  // -- fail-fast da configuracao de pagamento (CLAUDE.md secao 2) ------------
  //
  // Mesma logica do bloco acima, e pelo mesmo motivo (env injetada em runtime
  // pelo Easypanel). A diferenca e o que quebra: sem Asaas o site continua
  // mostrando a grade, mas NENHUMA reserva se completa — o POST cria a reserva,
  // falha ao cobrar e a expira. Por isso o aviso e explicito no boot, em vez de
  // aparecer como venda perdida no primeiro cliente do dia.
  //
  // A mensagem nunca imprime a chave: so comprimento e prefixo (ver asaas.ts).
  const asaasConfig = checkAsaasConfig();
  if (asaasConfig.ok) {
    console.log('[asaas] configuracao de pagamento validada');
  } else {
    console.error('='.repeat(78));
    console.error('[asaas] CONFIGURACAO DE PAGAMENTO INVALIDA — NENHUMA RESERVA VAI SE COMPLETAR');
    console.error(asaasConfig.message);
    console.error('='.repeat(78));
  }

  // Precaucao contra registro duplicado. Nao observei duplicacao nas execucoes
  // deste projeto (o log "agendado" saiu uma vez por boot), mas o modulo pode ser
  // reavaliado em dev, e cada avaliacao registraria mais um timer.
  if (globalForCron.holdCronRegistered) return;
  globalForCron.holdCronRegistered = true;

  cron.schedule('* * * * *', async () => {
    // try/catch obrigatorio: excecao nao tratada dentro do callback de um timer
    // derruba o processo Node inteiro. Um tick que falha nao pode tirar o site
    // do ar — o proximo tick tenta de novo.
    //
    // O catch LOGA com console.error e o erro real (verificado injetando um
    // throw em expireHolds: o tick imprime a mensagem e o stack completo).
    // Falha de tick tem que gritar no log, nunca sumir.
    try {
      const { expiredCount, reservationIds } = await expireHolds();
      if (expiredCount > 0) {
        console.log(
          `[cron:expire-holds] ${expiredCount} hold(s) expirado(s): ${reservationIds.join(', ')}`,
        );
      } else {
        console.log('[cron:expire-holds] tick: nenhum hold vencido');
      }
    } catch (error) {
      console.error('[cron:expire-holds] tick falhou:', error);
    }
  });

  console.log('[cron:expire-holds] agendado (* * * * *, a cada minuto)');

  // -- reconciliacao de pagamentos (CLAUDE.md secao 8-B) ---------------------
  //
  // A cada 10 minutos, como a secao manda. Mesmo padrao do cron acima: a logica
  // vive em lib/jobs/reconcile-payments.ts e aqui so se agenda.
  //
  // Este job e o que segura o dinheiro quando a fila do webhook interrompe (15
  // falhas consecutivas). Se ele nao rodar, uma fila caida vira pagamento
  // invisivel por horas — por isso o try/catch, igual ao de cima: excecao nao
  // tratada no callback de um timer derruba o processo Node inteiro, e um tick
  // que falha nao pode levar junto o site e o cron de hold.
  if (globalForCron.reconcileCronRegistered) return;
  globalForCron.reconcileCronRegistered = true;

  cron.schedule('*/10 * * * *', async () => {
    try {
      const { checked, reconciled, refundPending } = await reconcilePayments();

      if (reconciled > 0) {
        // Nao e rotina: significa que o webhook NAO entregou algo que ja estava
        // pago. Sobe para warn para nao se perder no meio dos ticks silenciosos.
        console.warn(
          `[cron:reconcile-payments] ${reconciled} de ${checked} cobranca(s) estavam pagas ` +
            'sem o webhook ter avisado — conferir a saude da fila no painel do Asaas',
        );
      } else if (checked > 0) {
        console.log(`[cron:reconcile-payments] tick: ${checked} cobranca(s) pendente(s), nenhuma paga`);
      }

      if (refundPending.length > 0) {
        console.error(
          `[cron:reconcile-payments] ESTORNO PENDENTE em ${refundPending.length} reserva(s): ` +
            `${refundPending.join(', ')} — estornar no painel do Asaas (secao 8-C)`,
        );
      }
    } catch (error) {
      console.error('[cron:reconcile-payments] tick falhou:', error);
    }
  });

  console.log('[cron:reconcile-payments] agendado (*/10 * * * *, a cada 10 minutos)');
}
