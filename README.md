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

1. Configure o `.env` com as variáveis de banco e JWT.
2. Instale dependências:

```bash
npm install
```

3. Inicie o servidor:

```bash
npm run start
```

O servidor inicia, verifica/gera tabelas (`dbInit.js`) e aplica limpeza periódica de sessões.