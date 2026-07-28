// GRUPO F — politica de rotas da autenticacao (CLAUDE.md secao 13).
//
// NAO TOCA O BANCO. isProtectedPath e funcao pura; o que ela responde decide o
// que o proxy bloqueia. Por isso ela e testada de forma isolada, e nao "pelo
// proxy": o custo de subir o servidor para exercitar uma tabela de caminhos
// seria alto e o teste passaria a falhar por motivos que nao sao a politica.
//
// O CASO QUE ESTA SUITE EXISTE PARA PROTEGER e o do webhook (secao 8.1): se
// /api/webhooks/asaas passar a exigir sessao, o Asaas leva 401, nenhum pagamento
// confirma e, apos 15 falhas, a fila de webhook e INTERROMPIDA. O sintoma
// aparece so na Fase 2, como "paguei e nao confirmou", e nao aponta para o
// proxy. Um teste barato aqui evita um dia de investigacao la.

import { describe, expect, it } from 'vitest';

import { isProtectedPath } from '@/lib/auth';

describe('F — politica de rotas do admin', () => {
  it('1. protege as telas e as APIs de admin', () => {
    const protectedPaths = [
      '/admin',
      '/admin/',
      '/admin/reservas/123',
      '/admin/clientes',
      '/admin/configuracoes',
      '/api/admin',
      '/api/admin/reservations',
      '/api/admin/reservations/abc/balance',
      // logout e protegido de proposito: so a rota de login e excecao
      '/api/admin/logout',
    ];

    for (const path of protectedPaths) {
      expect(isProtectedPath(path), `${path} deveria exigir sessao`).toBe(true);
    }
  });

  it('2. LIBERA o login, sob pena de ser impossivel entrar', () => {
    expect(isProtectedPath('/admin/login')).toBe(false);
    expect(isProtectedPath('/api/admin/login')).toBe(false);
  });

  it('3. LIBERA /api/webhooks/* — o Asaas nao tem sessao (secao 8.1)', () => {
    // Exigir sessao aqui = 401 para o Asaas = pagamento nunca confirmado e, com
    // 15 falhas seguidas, fila de webhook interrompida por 14 dias.
    expect(isProtectedPath('/api/webhooks/asaas')).toBe(false);
    expect(isProtectedPath('/api/webhooks/qualquer-provedor-futuro')).toBe(false);
  });

  it('4. LIBERA as rotas publicas (o site de reserva e a porta do dinheiro)', () => {
    const publicPaths = [
      '/',
      '/reserva/2f0b6a5e-1111-2222-3333-444455556666',
      '/agenda/token-secreto-do-parceiro',
      '/api/availability',
      '/api/experiences',
      '/api/reservations',
      '/api/reservations/abc/status',
      '/api/termo',
      '/api/shared/token/agenda',
      '/api/health',
    ];

    for (const path of publicPaths) {
      expect(isProtectedPath(path), `${path} deveria ser publico`).toBe(false);
    }
  });

  it('5. nao confunde prefixo parecido com area de admin', () => {
    // startsWith('/admin') solto trataria estes como protegidos. Sao rotas
    // publicas legitimas e um bloqueio aqui seria silencioso.
    expect(isProtectedPath('/administrativo')).toBe(false);
    expect(isProtectedPath('/admins')).toBe(false);
    expect(isProtectedPath('/api/administradores')).toBe(false);

    // E o contrario: nao pode LIBERAR algo por parecer com o login.
    expect(isProtectedPath('/admin/login-falso')).toBe(true);
    expect(isProtectedPath('/api/admin/login/extra')).toBe(true);
  });
});
