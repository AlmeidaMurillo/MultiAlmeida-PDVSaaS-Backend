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
  return (req, res, next, options) => {
    // Log do evento
    logRateLimitHit(req, limiterName);
    
    // Enviar resposta personalizada
    res.status(429).json({
      error: options.message?.error || 'Muitas requisições. Tente novamente mais tarde.',
      limiter: limiterName,
      retryAfter: res.getHeader('Retry-After') || '60',
      timestamp: new Date().toISOString(),
    });
  };
};

// Resetar estatísticas a cada 24 horas
setInterval(() => {
  console.log('📊 Salvando estatísticas de rate limit diárias...');
  saveStats();
  
  // Arquivar logs antigos se necessário
  archiveOldLogs();
}, 24 * 60 * 60 * 1000);

/**
 * Arquiva logs antigos para não crescer indefinidamente
 */
const archiveOldLogs = () => {
  try {
    if (!fs.existsSync(RATE_LIMIT_LOG)) return;
    
    const stats = fs.statSync(RATE_LIMIT_LOG);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    // Se maior que 10MB, arquivar
    if (fileSizeMB > 10) {
      const archiveName = `rate-limits-${new Date().toISOString().split('T')[0]}.log`;
      const archivePath = path.join(LOGS_DIR, archiveName);
      
      fs.renameSync(RATE_LIMIT_LOG, archivePath);
      console.log(`📦 Logs de rate limit arquivados: ${archiveName}`);
    }
  } catch (error) {
    console.error('❌ Erro ao arquivar logs:', error);
  }
};

export default {
  logRateLimitHit,
  getRateLimitStats,
  resetRateLimitStats,
  getRecentRateLimitHits,
  detectPotentialAbuse,
  createRateLimitHandler,
};
async (req, res, next, options) => {
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
  logRateLimitHit