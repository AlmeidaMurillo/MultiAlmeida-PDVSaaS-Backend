import { logRateLimit } from './logger.js';

/**
 * Registra quando um usuário atinge o rate limit (agora usando MySQL)
 */
export const logRateLimitHit = async (req, limiterName) => {
  // Console log para desenvolvimento
  console.warn('⚠️ RATE LIMIT ATINGIDO:', {
    limiter: limiterName,
    user: req.user?.email || req.user?.id || 'anônimo',
    ip: req.ip || req.connection.remoteAddress,
    path: `${req.method} ${req.path}`,
  });

  // Salvar no banco de dados
  await logRateLimit(req, limiterName);
};

/**
 * Handler personalizado para rate limit
 */
export const createRateLimitHandler = (limiterName) => {
  return async (req, res, next, options) => {
    // Log do evento no MySQL
    await logRateLimitHit(req, limiterName);
    
    // Enviar resposta personalizada
    res.status(429).json({
      error: options.message?.error || 'Muitas requisições. Tente novamente mais tarde.',
      limiter: limiterName,
      retryAfter: res.getHeader('Retry-After') || '60',
      timestamp: new Date().toISOString(),
    });
  };
};

export default {
  logRateLimitHit,
  createRateLimitHandler