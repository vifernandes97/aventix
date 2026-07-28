// Aventix — gera o hash bcrypt da senha do admin (CLAUDE.md secao 13).
//
//     npm run auth:hash -- "a-senha-que-voce-escolheu"
//
// Imprime o hash para colar em ADMIN_PASSWORD_HASH no .env.
//
// ============================================================================
// >>> A SENHA EM TEXTO NUNCA VAI PARA O .env NEM PARA O REPO. <<<
// O .env guarda SO o hash. Quem tem o hash nao consegue voltar a senha; quem
// tem a senha em texto entra no painel. E por isso que este script existe em vez
// de o codigo hashear a senha do .env no boot.
// ============================================================================
//
// A senha vem por argumento por simplicidade, com um custo real que voce deve
// conhecer: ela FICA NO HISTORICO DO SHELL (~/.zsh_history). Depois de rodar,
// apague a linha do historico, ou prefixe o comando com um espaco se o seu shell
// estiver com HIST_IGNORE_SPACE ligado. O script avisa disso ao final.
//
// POR QUE VIVE EM /scripts: e executavel — roda ao ser carregado. /lib e
// biblioteca, /scripts e entrypoint (decisao de 2026-07-28 em docs/DECISOES.md).

import bcrypt from 'bcrypt';

/**
 * Custo 12: ~250ms por verificacao nesta maquina. Alto o bastante para tornar
 * forca bruta offline cara, baixo o bastante para o login nao parecer travado.
 * DEVE ser o mesmo valor em qualquer lugar que gere hash — trocar aqui nao
 * invalida hashes antigos (o custo vai dentro do proprio hash), mas mantem a
 * frota consistente.
 */
const BCRYPT_COST = 12;

/** Piso deliberadamente baixo: barra o dedo escorregado, nao dita politica. */
const MIN_PASSWORD_LENGTH = 8;

async function main(): Promise<void> {
  const password = process.argv[2];

  if (!password) {
    console.error('Uso: npm run auth:hash -- "sua-senha"');
    console.error('');
    console.error('Gera o hash bcrypt para colar em ADMIN_PASSWORD_HASH no .env.');
    process.exitCode = 1;
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `Senha muito curta: ${password.length} caracteres, minimo ${MIN_PASSWORD_LENGTH}.`,
    );
    process.exitCode = 1;
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_COST);

  // As barras invertidas fazem parte da linha, nao sao enfeite. O carregador de
  // ambiente do Next (@next/env) expande variaveis no .env, e o hash bcrypt tem
  // tres cifroes ($2b$12$...); sem escapar, `$2b$12$Abc` vira variavel
  // inexistente e some — o valor chega com 50 caracteres em vez de 60 e todo
  // login falha parecendo "senha errada".
  //
  // MEDIDO: aspas simples e duplas NAO protegem, so o escape com \ protege.
  // Por isso o script ja entrega a linha pronta, em vez de imprimir o hash cru
  // e confiar em quem cola lembrar da regra.
  const escapedForEnv = hash.replaceAll('$', '\\$');

  console.log('');
  console.log('Cole esta linha no .env (COM as barras invertidas):');
  console.log('');
  console.log(`ADMIN_PASSWORD_HASH=${escapedForEnv}`);
  console.log('');
  console.log(`(bcrypt, custo ${BCRYPT_COST}; as \\ escapam os cifroes para o Next)`);
  console.log('');
  console.log('AVISO: a senha em texto ficou no historico do seu shell.');
  console.log('       Apague a linha correspondente de ~/.zsh_history.');
  console.log('');
}

main().catch((error) => {
  console.error('Falha ao gerar o hash:', error);
  process.exitCode = 1;
});
