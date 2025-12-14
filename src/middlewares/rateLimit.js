import rateLimit from 'express-rate-limit';

// Lê as variáveis de ambiente para rate limiting
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10); // em minutos
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '500', 10); // requisições

// Função para gerar chave de rate limit (IP + User ID se autenticado)
const smartKeyGenerator = (req) => {
  // Se usuário autenticado, usa o ID do usuário
  if (req.user?.id) {
    const key = `user-${req.user.id}`;
    console.log(`🔑 Rate limit key (user): ${key}`);
    return key;
  }
  // Senão, usa o IP
  console.log(`🔑 Rate limit key (IP): ${req.ip}`);
  return req.ip;
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
  keyGenerator: smartKeyGenerator,
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
  keyGenerator: smartKeyGenerator,
});

// Rate limiter para criação de pagamentos - restritivo (por usuário)
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // Máximo 10 pagamentos iniciados por hora POR USUÁRIO
  message: {
    error: 'Muitas tentativas de pagamento. Por favor, aguarde uma hora.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: smartKeyGenerator, // Usa user ID quando disponível
});

// Rate limiter para verificação de status de pagamento - muito permissivo
export const paymentStatusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // Máximo 30 verificações por minuto (permite polling a cada 2 segundos)
  message: {
    error: 'Muitas verificações de status. Aguarde um momento.',
  },
  standardHeaders: true,
  keyGenerator: smartKeyGenerator,
  legacyHeaders: false,
});

// Rate limiter para rotas administrativas - muito permissivo (POR ADMIN)
export const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 1000, // Máximo 1000 requisições POR ADMIN (não por IP)
  message: {
    error: 'Limite de requisições administrativas atingido.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: smartKeyGenerator, // Usa ID do admin, não IP
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
