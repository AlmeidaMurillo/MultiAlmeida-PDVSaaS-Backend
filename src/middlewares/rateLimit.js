import rateLimit from 'express-rate-limit';

// Rate limiter geral - mais permissivo
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // Máximo 100 requisições por IP
  message: {
    error: 'Muitas requisições deste IP. Tente novamente mais tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Pula rate limiter para requisições de admin (opcional)
  skip: (req) => {
    return req.user && req.user.papel === 'admin';
  }
});

// Rate limiter para login e criação de conta - mais restritivo
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Máximo 5 tentativas de login por IP
  message: {
    error: 'Muitas tentativas de login. Por favor, aguarde 15 minutos e tente novamente.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Não conta requisições bem-sucedidas
});

// Rate limiter para refresh token - moderado
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // Máximo 20 renovações por IP
  message: {
    error: 'Muitas tentativas de renovação de token. Tente novamente mais tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter para criação de pagamentos - restritivo
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // Máximo 10 pagamentos iniciados por hora
  message: {
    error: 'Muitas tentativas de pagamento. Por favor, aguarde uma hora.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, ipKeyGenerator) => {
    // Se autenticado, usa o user ID
    if (req.user) {
      return `user-${req.user.id}`;
    }
    // Senão, usa o helper ipKeyGenerator para normalizar IPv6
    return ipKeyGenerator(req);
  },
});

// Rate limiter para APIs públicas (planos) - moderado
export const publicApiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 30, // Máximo 30 requisições
  message: {
    error: 'Muitas requisições. Tente novamente em alguns minutos.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
