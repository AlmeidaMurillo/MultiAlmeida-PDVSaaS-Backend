# Backend

Estrutura simplificada para facilitar manutenção e entendimento.

## Estrutura

- server: `src/server.js`
- app: `src/app.js`
- banco: `src/db.js`, `src/dbInit.js`
- rotas: `src/routes/authRoutes.js`, `src/routes/userRoutes.js`, `src/routes.js`
- controllers: `src/controllers/authController.js`, `src/controllers/userController.js` (+ demais já existentes)
- middlewares: `src/middlewares/auth.js`, `src/middlewares/rateLimit.js`
- utils: `src/utils/tokenUtils.js`, `src/utils/hash.js`

## Executar

1. Configure o `.env` com as variáveis de banco e JWT. Use `.env.example` como referência.
2. Instale dependências:

```bash
npm install
```

3. Inicie o servidor:

```bash
npm run start
```

O servidor inicia, verifica/gera tabelas (`dbInit.js`) e aplica limpeza periódica de sessões.

## Configurações Importantes

### Tempo de Expiração do Pagamento
- Configure `PAYMENT_EXPIRATION_MINUTES` no `.env`
- Padrão: **2 minutos** (ideal para testes)
- Recomendado para produção: **10-15 minutos**
- O frontend sincroniza automaticamente com o tempo do backend

### Timezone do Banco de Dados
- Configurado para **America/Sao_Paulo** (Brasília, UTC-3)
- Corrige automaticamente o problema de 3 horas a mais do Railway
- Todas as datas (`data_criacao`, `data_pagamento`, `data_expiracao`) usam horário de Brasília
- A coluna `data_pagamento` é definida **APENAS quando o pagamento é aprovado**