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

### Timezone do Banco de Dados (Railway)
- O Railway armazena datas em **UTC (3 horas a mais que Brasília)**
- **Solução automática implementada em `db.js`:**
  - Intercepta **todas** as conexões e queries automaticamente
  - Ajusta objetos `Date` do JavaScript subtraindo 3 horas antes de salvar
  - Configura `SET time_zone = '-03:00'` em cada conexão
  - Funciona com `pool.execute()`, `pool.query()` e `connection.execute()`

#### Como funciona (TUDO em db.js)
1. **Proxy do Pool:** Intercepta `getConnection()`, `execute()` e `query()`
2. **Ajuste automático:** Toda data JavaScript é ajustada automaticamente (-3h)
3. **Zero configuração:** Nenhum outro arquivo precisa ser modificado

**Não é necessário alterar nenhuma query ou código!** Tudo funciona automaticamente. ✅