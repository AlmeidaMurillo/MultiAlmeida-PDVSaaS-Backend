import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

// Lê as variáveis de ambiente para rate limiting
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10); // em minutos
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '500', 10); // requisições

// Função para gerar chave segura de rate limiting
const secureKeyGenerator = (req) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.user?.id || 'anonymous';
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  const hash = crypto
    .createHash('sha256')
    .update(`${ip}-${userId}-${userAgent}`)
    .digest('hex')
    .substring(0, 16);
  
  return `${ip}-${userId}-${hash}`;
};

// Rate limiter geral - mais permissivo
export const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW * 60 * 1000,
  max: RATE_LIMIT_MAX,
  message: {
    error: 'Muitas requisições deste IP. Tente novamente mais tarde.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: secureKeyGenerator,
  handler: (req, res) => {
    console.warn(`⚠️ Rate limit atingido: ${secureKeyGenerator(req)}`);
    res.status(429).json({
      error: 'Muitas requisições. Aguarde alguns minutos.',
      retryAfter: Math.ceil(RATE_LIMIT_WINDOW * 60)
    });
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

// Rate limiter para verificação de sessão (has-refresh) - muito permissivo
export const sessionCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // Máximo 100 verificações por IP (permite verificações frequentes)
  message: {
    error: 'Muitas verificações de sessão. Aguarde alguns minutos.',
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

// Rate limiter para verificação de status de pagamento - muito permissivo
export const paymentStatusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // Máximo 30 verificações por minuto (permite polling a cada 2 segundos)
  message: {
    error: 'Muitas verificações de status. Aguarde um momento.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter para rotas administrativas - muito permissivo
export const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 1000, // Máximo 1000 requisições (admins precisam de mais liberdade)
  message: {
    error: 'Limite de requisições administrativas atingido.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Para admins autenticados, usa userId
    if (req.user?.id) {
      return `admin-${req.user.id}`;
    }
    return req.ip;
  }
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
