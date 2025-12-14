import { Router } from 'express';
import { body } from 'express-validator';
import AuthController from './controllers/authController.js';
import UserController from './controllers/userController.js';
// ContasController compactado dentro de UserController
import PaymentController from './controllers/paymentController.js';
import PlanosController from './controllers/planosController.js';
import CarrinhoController from './controllers/carrinhoController.js';
import CuponsController from './controllers/cuponsController.js';
import { authMiddleware, requireAdmin } from './middlewares/auth.js';
import { authLimiter, refreshLimiter, paymentLimiter, publicApiLimiter, sessionCheckLimiter, paymentStatusLimiter, adminLimiter } from './middlewares/rateLimit.js';

const routes = Router();

// Rota de health check (pública)
routes.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime() 
  });
});

const authRoutes = Router();
// Rotas de autenticação
authRoutes.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('senha').notEmpty().withMessage('A senha é obrigatória'),
], AuthController.login);
authRoutes.post('/refresh', refreshLimiter, AuthController.refresh);
authRoutes.post('/logout', AuthController.logout);
authRoutes.get('/status', authMiddleware, AuthController.checkAuthStatus);
authRoutes.get('/has-refresh', sessionCheckLimiter, AuthController.hasRefresh);
routes.use('/api/auth', authRoutes);

// Rotas de usuário
const userRoutes = Router();
userRoutes.get('/me', authMiddleware, UserController.me);
userRoutes.get('/details', authMiddleware, UserController.getCurrentUserDetails);
userRoutes.put('/details', authMiddleware, UserController.updateCurrentUserDetails);
userRoutes.put('/change-password', authMiddleware, UserController.changePassword);
userRoutes.get('/:id', authMiddleware, UserController.getUserDetails);
routes.use('/api/user', userRoutes);

// Rotas de assinatura
const subscriptionRoutes = Router();
subscriptionRoutes.get('/my-subscriptions', authMiddleware, UserController.getSubscriptions);
routes.use('/api/subscription', subscriptionRoutes);

// Rota de criação de conta
routes.post(
  '/api/criar-conta',
  authLimiter,
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
  AuthController.criarConta
);

// Rotas administrativas com rate limiter específico
const adminRoutes = Router();
// Aplica authMiddleware e requireAdmin ANTES, depois rate limiter em cada rota
adminRoutes.get('/auth/status', authMiddleware, requireAdmin, adminLimiter, AuthController.checkAdminAuthStatus);
adminRoutes.post('/planos', authMiddleware, requireAdmin, adminLimiter, PlanosController.create);
adminRoutes.get('/planos', authMiddleware, requireAdmin, adminLimiter, PlanosController.list);
adminRoutes.put('/planos/:id', authMiddleware, requireAdmin, adminLimiter, PlanosController.update);
adminRoutes.delete('/planos/:id', authMiddleware, requireAdmin, adminLimiter, PlanosController.delete);
adminRoutes.get('/pagamentos', authMiddleware, requireAdmin, adminLimiter, PaymentController.listAdminPayments);

// Rotas de cupons (admin)
adminRoutes.get('/cupons', authMiddleware, requireAdmin, adminLimiter, CuponsController.listar);
adminRoutes.post('/cupons', authMiddleware, requireAdmin, adminLimiter, CuponsController.criar);
adminRoutes.put('/cupons/:id', authMiddleware, requireAdmin, adminLimiter, CuponsController.atualizar);
adminRoutes.delete('/cupons/:id', authMiddleware, requireAdmin, adminLimiter, CuponsController.deletar);
routes.use('/api/admin', adminRoutes);

// Rotas de pagamento
routes.post('/api/payments/initiate', authMiddleware, paymentLimiter, PaymentController.initiatePayment);
routes.post('/api/payments/qr-code', authMiddleware, paymentLimiter, PaymentController.generateQrCode);
routes.post('/api/payments/webhook', PaymentController.handleWebhook);
routes.get('/api/payments/status/:id', paymentStatusLimiter, PaymentController.getPaymentStatus);
routes.get('/api/payments/:id', paymentStatusLimiter, PaymentController.getPaymentDetails);
routes.post('/api/payments/:id/expire', PaymentController.expirePayment);

// Rotas de planos (públicas)
routes.get('/api/planos', publicApiLimiter, PlanosController.list);

// Rotas administrativas
routes.post('/api/admin/planos', authMiddleware, requireAdmin, PlanosController.create);
routes.get('/api/admin/planos', authMiddleware, requireAdmin, PlanosController.list);
routes.put('/api/admin/planos/:id', authMiddleware, requireAdmin, PlanosController.update);
routes.delete('/api/admin/planos/:id', authMiddleware, requireAdmin, PlanosController.delete);

// Rotas de carrinho (rotas específicas ANTES das genéricas)
routes.post('/api/carrinho/cupom', authMiddleware, CarrinhoController.aplicarCupom);
routes.delete('/api/carrinho/cupom', authMiddleware, CarrinhoController.removerCupom);
routes.get('/api/carrinho', authMiddleware, CarrinhoController.listar);
routes.post('/api/carrinho', authMiddleware, CarrinhoController.adicionar);
routes.delete('/api/carrinho/:id', authMiddleware, CarrinhoController.remover);
routes.put('/api/carrinho/:id/quantidade', authMiddleware, CarrinhoController.atualizarQuantidade);
routes.delete('/api/carrinho', authMiddleware, CarrinhoController.limpar);

// Rota pública para validar cupons (mantida para compatibilidade)
routes.post('/api/cupons/validar', authMiddleware, CuponsController.validar);

export default routes;
