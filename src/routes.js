import { Router } from 'express';
import { body } from 'express-validator';

import AuthController from './controllers/authController.js';
import ContasController from './controllers/contasController.js';
import EmpresasController from './controllers/empresasController.js';
import PaymentController from './controllers/paymentController.js';
import PlanosController from './controllers/planosController.js';
import CarrinhoController from './controllers/carrinhoController.js';

import { authMiddleware, requireAdmin, optionalAuthMiddleware, requireSubscription } from './middlewares/auth.js';

const routes = Router();


// ------------------- Rotas de Autenticação -------------------
// As rotas de autenticação agora vivem sob /api/auth
const authRoutes = Router();
authRoutes.post('/login', [
    body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
    body('senha').notEmpty().withMessage('A senha é obrigatória'),
  ], AuthController.login);

authRoutes.post('/refresh', AuthController.refresh); // Nova rota para refresh
authRoutes.post('/logout', AuthController.logout); // Logout não precisa de authMiddleware
authRoutes.get('/status', authMiddleware, AuthController.checkAuthStatus);
authRoutes.get('/user-details', authMiddleware, AuthController.getCurrentUserDetails);
authRoutes.get('/my-subscriptions', authMiddleware, ContasController.getSubscriptions); // Movido para aqui
routes.use('/api/auth', authRoutes);


// 🔹 Criação de conta
routes.post(
  '/api/criar-conta',
  [
    body('nome')
      .isLength({ min: 2 })
      .withMessage('Nome deve ter no mínimo 2 caracteres'),
    body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
    body('senha')
      .isLength({ min: 6 })
      .withMessage('A senha deve ter no mínimo 6 caracteres')
      .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
      .withMessage('A senha deve conter letras e números'),
  ],
  ContasController.criarConta
);

// 🔹 Verificação de autenticação de Admin
routes.get('/api/admin/auth/status', authMiddleware, requireAdmin, AuthController.checkAdminAuthStatus);

// 🔹 Empresas (apenas admin)
routes.post('/api/admin/empresas', authMiddleware, requireAdmin, EmpresasController.create);
routes.get('/api/admin/empresas', authMiddleware, requireAdmin, EmpresasController.list);
routes.get('/api/admin/empresas/:id', authMiddleware, requireAdmin, EmpresasController.get);

// 🔹 Usuários (público)
routes.get('/api/usuarios/:id', AuthController.getUserDetails);

// 🔹 Pagamentos
routes.post('/api/payments/initiate', authMiddleware, PaymentController.initiatePayment);
routes.post('/api/payments/qr-code', authMiddleware, PaymentController.generateQrCode);
routes.post('/api/payments/webhook', PaymentController.handleWebhook);
routes.get('/api/payments/status/:id', PaymentController.getPaymentStatus);
routes.get('/api/payments/:id', PaymentController.getPaymentDetails);
routes.post('/api/payments/:id/expire', PaymentController.expirePayment);

// 🔹 Planos públicos
routes.get('/api/planos', PlanosController.list);

// 🔹 Planos (admin)
routes.post('/api/admin/planos', authMiddleware, requireAdmin, PlanosController.create);
routes.get('/api/admin/planos', authMiddleware, requireAdmin, PlanosController.list);
routes.put('/api/admin/planos/:id', authMiddleware, requireAdmin, PlanosController.update);
routes.delete('/api/admin/planos/:id', authMiddleware, requireAdmin, PlanosController.delete);

// 🔹 Carrinho
routes.get('/api/carrinho', authMiddleware, CarrinhoController.listar);
routes.post('/api/carrinho', authMiddleware, CarrinhoController.adicionar);
routes.delete('/api/carrinho/:id', authMiddleware, CarrinhoController.remover);
routes.put('/api/carrinho/:id/quantidade', authMiddleware, CarrinhoController.atualizarQuantidade);
routes.delete('/api/carrinho', authMiddleware, CarrinhoController.limpar);

export default routes;
