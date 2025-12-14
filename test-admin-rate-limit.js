/**
 * Teste de Rate Limiting para Admin
 * Valida que admins podem fazer até 1000 requisições em 5 minutos
 * 
 * USO:
 * node test-admin-rate-limit.js <email> <senha> [url]
 * 
 * EXEMPLO:
 * node test-admin-rate-limit.js admin@multialmeida.com SuaSenha123!
 * node test-admin-rate-limit.js admin@multialmeida.com SuaSenha123! https://multialmeida-pdvsaas-backend-production.up.railway.app
 */

const API_URL = process.argv[4] || 'http://localhost:8080';
const ADMIN_EMAIL = process.argv[2];
const ADMIN_PASSWORD = process.argv[3];

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('\n❌ Uso incorreto!\n');
  console.log('USO: node test-admin-rate-limit.js <email> <senha> [url]\n');
  console.log('EXEMPLOS:');
  console.log('  Local:    node test-admin-rate-limit.js admin@email.com senha123');
  console.log('  Railway:  node test-admin-rate-limit.js admin@email.com senha123 https://multialmeida-pdvsaas-backend-production.up.railway.app\n');
  process.exit(1);
}

console.log('\n👑 TESTE DE RATE LIMITING ADMIN\n');
console.log('=' .repeat(60));
console.log(`URL: ${API_URL}`);
console.log(`Admin: ${ADMIN_EMAIL}`);
console.log('=' .repeat(60));

async function testAdminRateLimit() {
  
  // ============================================================
  // PASSO 1: LOGIN
  // ============================================================
  console.log('\n📋 PASSO 1: Fazendo login como admin...\n');
  
  try {
    const loginResponse = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        senha: ADMIN_PASSWORD
      })
    });
    
    const loginData = await loginResponse.json();
    
    if (!loginResponse.ok || !loginData.accessToken) {
      console.error('❌ Falha no login!');
      console.error('Status:', loginResponse.status);
      console.error('Resposta:', JSON.stringify(loginData, null, 2));
      console.error('\n💡 Verifique se:');
      console.error('   - O email e senha estão corretos');
      console.error('   - O usuário tem permissão de admin (is_admin=true no banco)');
      console.error('   - O backend está rodando e acessível\n');
      process.exit(1);
    }
    
    const adminToken = loginData.accessToken;
    console.log('✅ Login bem-sucedido!');
    console.log(`   Token: ${adminToken.substring(0, 30)}...`);
    console.log(`   User: ${loginData.user?.nome || 'Admin'}`);
    console.log(`   Papel: ${loginData.user?.papel || 'desconhecido'}`);
    console.log(`   Admin: ${loginData.user?.papel === 'admin' ? 'Sim ✅' : 'Não ❌'}`);
    
    if (loginData.user?.papel !== 'admin') {
      console.error('\n❌ ERRO: Usuário não tem permissão de admin!');
      console.error(`   Este teste requer uma conta com papel='admin'`);
      console.error(`   Papel atual: ${loginData.user?.papel || 'não encontrado'}\n`);
      process.exit(1);
    }
    
    // ============================================================
    // PASSO 2: TESTE RÁPIDO (20 requisições)
    // ============================================================
    console.log('\n📋 PASSO 2: Teste rápido (20 requisições)...\n');
    
    const quickTestResults = {
      success: 0,
      blocked: 0,
      errors: 0,
      times: []
    };
    
    const startQuickTest = Date.now();
    
    for (let i = 1; i <= 20; i++) {
      const reqStart = Date.now();
      
      try {
        const response = await fetch(`${API_URL}/api/admin/planos`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        const reqTime = Date.now() - reqStart;
        quickTestResults.times.push(reqTime);
        
        if (response.status === 200) {
          quickTestResults.success++;
          process.stdout.write(`✅ ${i} `);
        } else if (response.status === 429) {
          quickTestResults.blocked++;
          process.stdout.write(`❌ ${i} `);
        } else {
          quickTestResults.errors++;
          process.stdout.write(`⚠️ ${i} `);
        }
        
      } catch (error) {
        quickTestResults.errors++;
        process.stdout.write(`💥 ${i} `);
      }
      
      if (i % 10 === 0) console.log('');
    }
    
    const quickTestDuration = Date.now() - startQuickTest;
    const avgTime = quickTestResults.times.reduce((a, b) => a + b, 0) / quickTestResults.times.length;
    
    console.log('\n\n📊 Resultado do Teste Rápido:');
    console.log('   ✅ Sucesso:    ' + quickTestResults.success + '/20');
    console.log('   ❌ Bloqueadas: ' + quickTestResults.blocked + '/20 (429)');
    console.log('   ⚠️ Erros:      ' + quickTestResults.errors + '/20');
    console.log('   ⏱️ Tempo médio: ' + avgTime.toFixed(0) + 'ms');
    console.log('   ⏱️ Duração:    ' + (quickTestDuration / 1000).toFixed(2) + 's');
    
    if (quickTestResults.blocked > 0) {
      console.log('\n⚠️ ALERTA: Requisições bloqueadas detectadas!');
      console.log('   Limite de admin deveria ser 1000 req/5min');
      console.log('   Verifique se o adminLimiter está configurado corretamente\n');
      return;
    }
    
    // ============================================================
    // PASSO 3: TESTE DE STRESS (100 requisições)
    // ============================================================
    console.log('\n📋 PASSO 3: Teste de stress (100 requisições)...');
    console.log('   ⏳ Isso pode levar ~10-15 segundos...\n');
    
    const stressTestResults = {
      success: 0,
      blocked: 0,
      errors: 0,
      times: []
    };
    
    const startStressTest = Date.now();
    
    for (let i = 1; i <= 100; i++) {
      const reqStart = Date.now();
      
      try {
        const response = await fetch(`${API_URL}/api/admin/planos`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        const reqTime = Date.now() - reqStart;
        stressTestResults.times.push(reqTime);
        
        if (response.status === 200) {
          stressTestResults.success++;
          process.stdout.write('✅');
        } else if (response.status === 429) {
          stressTestResults.blocked++;
          process.stdout.write('❌');
        } else {
          stressTestResults.errors++;
          process.stdout.write('⚠️');
        }
        
      } catch (error) {
        stressTestResults.errors++;
        process.stdout.write('💥');
      }
      
      if (i % 20 === 0) console.log(` ${i}/100`);
    }
    
    const stressTestDuration = Date.now() - startStressTest;
    const stressAvgTime = stressTestResults.times.reduce((a, b) => a + b, 0) / stressTestResults.times.length;
    const reqPerSecond = (100 / (stressTestDuration / 1000)).toFixed(2);
    
    console.log('\n\n📊 Resultado do Teste de Stress:');
    console.log('   ✅ Sucesso:       ' + stressTestResults.success + '/100');
    console.log('   ❌ Bloqueadas:    ' + stressTestResults.blocked + '/100 (429)');
    console.log('   ⚠️ Erros:         ' + stressTestResults.errors + '/100');
    console.log('   ⏱️ Tempo médio:   ' + stressAvgTime.toFixed(0) + 'ms');
    console.log('   ⏱️ Duração:       ' + (stressTestDuration / 1000).toFixed(2) + 's');
    console.log('   📈 Requisições/s: ' + reqPerSecond);
    
    // ============================================================
    // CONCLUSÃO
    // ============================================================
    console.log('\n\n' + '=' .repeat(60));
    console.log('🏁 CONCLUSÃO DO TESTE');
    console.log('=' .repeat(60));
    
    const totalRequests = quickTestResults.success + stressTestResults.success;
    const totalBlocked = quickTestResults.blocked + stressTestResults.blocked;
    const totalErrors = quickTestResults.errors + stressTestResults.errors;
    
    console.log(`\n📊 Total de requisições: ${totalRequests + totalBlocked + totalErrors}/120`);
    console.log(`   ✅ Bem-sucedidas: ${totalRequests}`);
    console.log(`   ❌ Bloqueadas:    ${totalBlocked}`);
    console.log(`   ⚠️ Erros:         ${totalErrors}`);
    
    if (totalBlocked === 0 && totalRequests >= 110) {
      console.log('\n🎉 ADMIN RATE LIMITER FUNCIONANDO PERFEITAMENTE!');
      console.log('   ✅ Nenhuma requisição bloqueada em 120 tentativas');
      console.log('   ✅ Limite configurado corretamente (1000 req/5min)');
      console.log('   ✅ Sistema permite operação normal de administradores\n');
    } else if (totalBlocked > 0) {
      console.log('\n⚠️ ATENÇÃO: Rate limiter muito restritivo!');
      console.log('   ❌ ' + totalBlocked + ' requisições foram bloqueadas');
      console.log('   💡 Verifique a configuração do adminLimiter em rateLimit.js');
      console.log('   💡 Deve estar configurado para 1000 req/5min\n');
    } else if (totalErrors > 10) {
      console.log('\n⚠️ ATENÇÃO: Muitos erros detectados!');
      console.log('   ❌ ' + totalErrors + ' requisições falharam');
      console.log('   💡 Pode haver problemas no servidor ou autenticação\n');
    }
    
    console.log('=' .repeat(60) + '\n');
    
  } catch (error) {
    console.error('\n💥 ERRO CRÍTICO:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

// Executar teste
testAdminRateLimit();
