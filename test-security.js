/**
 * Script de Teste de Segurança
 * Testa todos os recursos de segurança implementados
 * 
 * COMO EXECUTAR:
 * node test-security.js
 * 
 * Ou para testar em produção:
 * node test-security.js https://multialmeida-pdvsaas-backend-production.up.railway.app
 */

const API_URL = process.argv[2] || 'http://localhost:8080';

console.log(`\n🔐 TESTANDO SEGURANÇA DO SISTEMA\n`);
console.log(`URL Base: ${API_URL}\n`);
console.log('=' .repeat(60));

// Função auxiliar para fazer requisições
async function testRequest(name, url, options = {}) {
  console.log(`\n📋 Teste: ${name}`);
  console.log(`   URL: ${url}`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      }
    });
    
    const data = await response.json().catch(() => ({}));
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Resposta:`, JSON.stringify(data, null, 2).substring(0, 200));
    
    return { status: response.status, data, headers: response.headers };
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}`);
    return { error: error.message };
  }
}

// Testes de segurança
async function runTests() {
  
  // ============================================================
  // 1. TESTE DE RATE LIMITING
  // ============================================================
  console.log('\n\n🔒 1. TESTANDO RATE LIMITING');
  console.log('=' .repeat(60));
  
  console.log('\n▶️ Tentando múltiplas requisições rápidas...');
  for (let i = 1; i <= 7; i++) {
    await testRequest(
      `Login attempt ${i}/7`,
      `${API_URL}/api/auth/login`,
      {
        method: 'POST',
        body: JSON.stringify({
          email: 'teste@invalido.com',
          senha: 'senhaerrada'
        })
      }
    );
    
    if (i === 6) {
      console.log('\n   ⚠️ Próxima requisição deve ser bloqueada (limite: 5 em 15min)');
    }
  }
  
  // ============================================================
  // 2. TESTE DE SANITIZAÇÃO (XSS)
  // ============================================================
  console.log('\n\n🧹 2. TESTANDO SANITIZAÇÃO XSS');
  console.log('=' .repeat(60));
  
  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '<svg onload=alert(1)>',
  ];
  
  for (const payload of xssPayloads) {
    await testRequest(
      'XSS Attempt',
      `${API_URL}/api/criar-conta`,
      {
        method: 'POST',
        body: JSON.stringify({
          nome: payload,
          email: 'teste@xss.com',
          senha: 'Senha123!',
          tipo_plano: 'gratuito'
        })
      }
    );
  }
  
  // ============================================================
  // 3. TESTE DE SQL INJECTION
  // ============================================================
  console.log('\n\n💉 3. TESTANDO PROTEÇÃO SQL INJECTION');
  console.log('=' .repeat(60));
  
  const sqlPayloads = [
    "' OR '1'='1",
    "admin'--",
    "1' UNION SELECT NULL--",
    "'; DROP TABLE users;--",
  ];
  
  for (const payload of sqlPayloads) {
    await testRequest(
      'SQL Injection Attempt',
      `${API_URL}/api/auth/login`,
      {
        method: 'POST',
        body: JSON.stringify({
          email: payload,
          senha: payload
        })
      }
    );
  }
  
  // ============================================================
  // 4. TESTE DE CABEÇALHOS DE SEGURANÇA
  // ============================================================
  console.log('\n\n🛡️ 4. TESTANDO CABEÇALHOS DE SEGURANÇA');
  console.log('=' .repeat(60));
  
  const healthCheck = await testRequest(
    'Verificando headers de segurança',
    `${API_URL}/api/health`,
    { method: 'GET' }
  );
  
  if (healthCheck.headers) {
    console.log('\n   Cabeçalhos de Segurança Presentes:');
    const securityHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
      'strict-transport-security',
      'content-security-policy'
    ];
    
    securityHeaders.forEach(header => {
      const value = healthCheck.headers.get(header);
      console.log(`   ${value ? '✅' : '❌'} ${header}: ${value || 'não encontrado'}`);
    });
  }
  
  // ============================================================
  // 5. TESTE DE AUTENTICAÇÃO JWT
  // ============================================================
  console.log('\n\n🔑 5. TESTANDO AUTENTICAÇÃO JWT');
  console.log('=' .repeat(60));
  
  // Token inválido
  await testRequest(
    'Acesso com token inválido',
    `${API_URL}/api/user/perfil`,
    {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer token_invalido_12345'
      }
    }
  );
  
  // Token expirado (simulado)
  await testRequest(
    'Acesso com token expirado',
    `${API_URL}/api/user/perfil`,
    {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzNDUsImlhdCI6MTYwOTQ1OTIwMCwiZXhwIjoxNjA5NDU5MjAwfQ.fake_signature'
      }
    }
  );
  
  // Sem token
  await testRequest(
    'Acesso sem token',
    `${API_URL}/api/user/perfil`,
    { method: 'GET' }
  );
  
  // ============================================================
  // 6. TESTE DE CORS
  // ============================================================
  console.log('\n\n🌐 6. TESTANDO CORS');
  console.log('=' .repeat(60));
  
  const corsTest = await testRequest(
    'Requisição com Origin',
    `${API_URL}/api/health`,
    {
      method: 'GET',
      headers: {
        'Origin': 'https://example.com'
      }
    }
  );
  
  if (corsTest.headers) {
    const corsHeader = corsTest.headers.get('access-control-allow-origin');
    console.log(`   ${corsHeader ? '✅' : '❌'} CORS Header: ${corsHeader || 'não encontrado'}`);
  }
  
  // ============================================================
  // 7. TESTE DE VALIDAÇÃO DE ENTRADA
  // ============================================================
  console.log('\n\n✅ 7. TESTANDO VALIDAÇÃO DE ENTRADA');
  console.log('=' .repeat(60));
  
  const invalidInputs = [
    { nome: '', email: 'invalido', senha: '123' },
    { nome: 'a', email: 'teste@teste.com', senha: 'curta' },
    { nome: 'Teste', email: 'sem@arroba', senha: 'Senha123!' },
    { nome: 'T'.repeat(300), email: 'teste@teste.com', senha: 'Senha123!' },
  ];
  
  for (const input of invalidInputs) {
    await testRequest(
      'Entrada inválida',
      `${API_URL}/api/criar-conta`,
      {
        method: 'POST',
        body: JSON.stringify({ ...input, tipo_plano: 'gratuito' })
      }
    );
  }
  
  // ============================================================
  // 8. TESTE DE PERFORMANCE (PAYLOAD GRANDE)
  // ============================================================
  console.log('\n\n⚡ 8. TESTANDO PROTEÇÃO CONTRA PAYLOAD GRANDE');
  console.log('=' .repeat(60));
  
  const largePayload = {
    nome: 'Teste',
    email: 'teste@teste.com',
    senha: 'Senha123!',
    tipo_plano: 'gratuito',
    dadosGigantes: 'A'.repeat(10 * 1024 * 1024) // 10MB
  };
  
  await testRequest(
    'Payload muito grande (10MB)',
    `${API_URL}/api/criar-conta`,
    {
      method: 'POST',
      body: JSON.stringify(largePayload)
    }
  );
  
  // ============================================================
  // 9. TESTE DE RATE LIMITING ADMIN (1000 req/5min)
  // ============================================================
  console.log('\n\n👑 9. TESTANDO RATE LIMITING DE ADMIN');
  console.log('=' .repeat(60));
  
  console.log('\n   ℹ️ Para testar completamente, você precisa:');
  console.log('   1. Fazer login como admin primeiro');
  console.log('   2. Pegar o token JWT');
  console.log('   3. Executar teste com token real\n');
  
  // Primeiro, tentar fazer login como admin (demonstração)
  console.log('▶️ Tentando login de admin (demonstração)...');
  const adminLogin = await testRequest(
    'Login Admin',
    `${API_URL}/api/auth/login`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@multialmeida.com',
        senha: 'Admin123!'
      })
    }
  );
  
  if (adminLogin.data?.accessToken) {
    const adminToken = adminLogin.data.accessToken;
    console.log('\n   ✅ Login de admin bem-sucedido!');
    console.log('   📋 Testando 20 requisições administrativas...\n');
    
    let successCount = 0;
    let blockedCount = 0;
    
    for (let i = 1; i <= 20; i++) {
      const result = await testRequest(
        `Admin request ${i}/20`,
        `${API_URL}/api/admin/planos`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        }
      );
      
      if (result.status === 200) successCount++;
      if (result.status === 429) blockedCount++;
      
      // Pequeno delay para não sobrecarregar
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`\n   📊 Resultado:`);
    console.log(`   ✅ Requisições bem-sucedidas: ${successCount}/20`);
    console.log(`   ❌ Requisições bloqueadas (429): ${blockedCount}/20`);
    console.log(`   ℹ️ Limite esperado: 1000 req/5min (todas devem passar)`);
    
    if (blockedCount === 0 && successCount === 20) {
      console.log(`   🎉 ADMIN RATE LIMITER FUNCIONANDO PERFEITAMENTE!`);
    }
  } else {
    console.log('\n   ⚠️ Login de admin falhou (credenciais inválidas ou conta não existe)');
    console.log('   📝 Teste manual necessário:');
    console.log('   \n   # Passo 1: Login como admin');
    console.log('   curl -X POST ' + API_URL + '/api/auth/login \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"email":"seu_admin@email.com","senha":"sua_senha"}\'');
    console.log('   \n   # Passo 2: Copie o accessToken da resposta');
    console.log('   \n   # Passo 3: Teste múltiplas requisições');
    console.log('   for i in {1..50}; do');
    console.log('     curl -X GET ' + API_URL + '/api/admin/planos \\');
    console.log('       -H "Authorization: Bearer SEU_TOKEN"');
    console.log('     echo "Request $i"');
    console.log('   done');
  }
  
  // ============================================================
  // RESUMO
  // ============================================================
  console.log('\n\n📊 RESUMO DOS TESTES');
  console.log('=' .repeat(60));
  console.log(`
✅ Testes Executados:
   1. Rate Limiting (tentativas múltiplas)
   2. Sanitização XSS (4 payloads)
   3. SQL Injection (4 payloads)
   4. Cabeçalhos de Segurança (5 headers)
   5. Autenticação JWT (3 cenários)
   6. CORS (origin validation)
   7. Validação de Entrada (4 casos)
   8. Proteção contra Payload Grande
   9. Rate Limiting Admin (1000 req/5min)

🔍 VERIFICAÇÕES ADICIONAIS RECOMENDADAS:

1. Logs de Segurança:
   - Verifique: backend/logs/security-YYYY-MM-DD.log
   - Comando: cat backend/logs/security-*.log | tail -50

2. Rate Limiting no Railway:
   - Acesse: ${API_URL}/api/login
   - Faça 6+ requisições rápidas
   - Deve retornar 429 na 6ª tentativa

3. Admin Rate Limits:
   - Login como admin
   - Deve permitir 1000 req/5min

4. Database Logs:
   - Verifique se não há SQL injection nos logs MySQL

💡 PRÓXIMOS PASSOS:
   - Monitore os logs do Railway após deploy
   - Configure alertas para eventos de segurança
   - Revise logs de segurança regularmente
  `);
  
  console.log('\n' + '=' .repeat(60));
  console.log('🏁 Testes de Segurança Concluídos!\n');
}

// Executar testes
runTests().catch(err => {
  console.error('\n❌ Erro ao executar testes:', err);
  process.exit(1);
});
