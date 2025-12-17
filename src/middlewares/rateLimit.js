import rateLimit from 'express-rate-limit';
import { createRateLimitHandler } from '../utils/rateLimitMonitor.js';

// Configurações ajustáveis via variáveis de ambiente
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10); // em minutos
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '2000', 10); // Aumentado de 500 para 2000

const userKeyGenerator = (req) => {
  if (req.user?.id) {
    return `user-${req.user.id}`;
  }
  return undefined;
};

// Limiter geral - Para todas as rotas não específicas
export const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW * 60 * 1000,
  max: RATE_LIMIT_MAX,
  message: {
    error: 'Muitas requisições deste IP. Tente novamente mais tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  handler: createRateLimitHandler('general'),
});

// Limiter para autenticação (login/registro) - Mantém segurança contra brute force
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Aumentado de 5 para 10 tentativas (mais flexível)
  message: {
    error: 'Muitas tentativas de login. Por favor, aguarde 15 minutos e tente novamente.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler('auth'),
  skipSuccessfulRequests: true, // Não conta logins bem-sucedidos
});

// Limiter para renovação de tokens - Usuários autenticados
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 50, // Aumentado de 20 para 50 (permite mais renovações automáticas)
  message: {
    error: 'Muitas tentativas de renovação de token. Tente novamente mais tarde.',
  },
  standardHeaders: true,
  handler: createRateLimitHandler('refresh'),
  legacyHeaders: false,
});

// Limiter para verificação de sessão - CRÍTICO: Não pode ser muito restritivo
export const sessionCheckLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // Reduzido de 15 para 5 minutos (janela menor)
  max: 300, // Aumentado de 100 para 300 (permite ~1 req/segundo)
  message: {
    error: 'Muitas verificações de sessão. Aguarde alguns minutos.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler('sessionCheck'),
  keyGenerator: userKeyGenerator, // Por usuário, não por IP
});

// Limiter para criação de pagamentos - Proteção contra fraude
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20, // Aumentado de 10 para 20 pagamentos por hora
  message: {
    error: 'Muitas tentativas de pagamento. Por favor, aguarde uma hora.',
  },
  standardHeaders: true,
  handler: createRateLimitHandler('payment'),
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
});

// Limiter para verificação de status de pagamento - Permite polling frequente
export const paymentStatusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 60, // Aumentado de 30 para 60 (permite polling a cada 1 segundo)
  message: {
    error: 'Muitas verificações de status. Aguarde um momento.',
  },
  standardHeaders: true,
  handler: createRateLimitHandler('paymentStatus'),
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
});

// Limiter para área administrativa - Permite muitas operações
export const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 2000, // Aumentado de 1000 para 2000 (dashboards fazem muitas requisições)
  message: {
    error: 'Limite de requisições administrativas atingido.',
  },
  standardHeaders: true,
  handler: createRateLimitHandler('admin'),
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
});

// Limiter para APIs públicas (sem autenticação) - Mais restritivo
export const publicApiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 100, // Aumentado de 30 para 100 (mais generoso para landing page)
  message: {
    error: 'Muitas requisições. Tente novamente em alguns minutos.',
  },
  handler: createRateLimitHandler('publicApi'),
  standardHeaders: true,
  legacyHeaders: false,
});
