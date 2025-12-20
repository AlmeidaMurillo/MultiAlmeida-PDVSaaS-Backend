// Módulo de segurança - SEM criação de arquivos .log
// Todas as logs são registradas apenas no banco de dados MySQL via logger.js

export const SecurityLevel = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  ATTACK: 'ATTACK'
};

export const SecurityEvent = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  TOKEN_INVALID: 'TOKEN_INVALID',
  RATE_LIMIT: 'RATE_LIMIT',
  INVALID_INPUT: 'INVALID_INPUT',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  SQL_INJECTION_ATTEMPT: 'SQL_INJECTION_ATTEMPT',
  XSS_ATTEMPT: 'XSS_ATTEMPT',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PERMISSION_DENIED: 'PERMISSION_DENIED'
};

// Importar o sistema de logs centralizado
import { log } from './logger.js';

// Função para registrar eventos de segurança no banco de dados
export const logSecurityEvent = async (level, event, details = {}) => {
  try {
    await log('ataque_detectado', null, `${level}: ${event}`, {
      level,
      event,
      ...details
    });
  } catch (error) {
    console.error('Erro ao registrar evento de segurança:', error);
  }
};

// Middleware desabilitado - não cria logs duplicados
export const securityLoggerMiddleware = (req, res, next) => {
  next();
};

// Funções para registrar tentativas de ataque
export const logLoginAttempt = async (success, email, ip, userAgent, userId = null) => {
  await logSecurityEvent(
    success ? SecurityLevel.INFO : SecurityLevel.WARNING,
    success ? SecurityEvent.LOGIN_SUCCESS : SecurityEvent.LOGIN_FAILED,
    { email, ip, userAgent, userId }
  );
};

export const logPasswordChange = async (userId, ip) => {
  await logSecurityEvent(SecurityLevel.INFO, SecurityEvent.PASSWORD_CHANGE, { userId, ip });
};

export const logSqlInjectionAttempt = async (input, ip, path) => {
  await logSecurityEvent(SecurityLevel.ATTACK, SecurityEvent.SQL_INJECTION_ATTEMPT, {
    input: input.substring(0, 100),
    ip,
    path
  });
};

export const logXssAttempt = async (input, ip, path) => {
  await logSecurityEvent(SecurityLevel.ATTACK, SecurityEvent.XSS_ATTEMPT, {
    input: input.substring(0, 100),
    ip,
    path
  });
};

export const detectSuspiciousPatterns = (str) => {
  if (typeof str !== 'string') return null;
  
  const patterns = {
    sql: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b|--|\/\*|\*\/|;)/i,
    xss: /(<script|javascript:|onerror=|onload=|<iframe|eval\(|alert\()/i,
    path_traversal: /(\.\.\/|\.\.\\)/,
    command_injection: /(\||&|;|\$\(|\`)/
  };
  
  for (const [type, regex] of Object.entries(patterns)) {
    if (regex.test(str)) {
      return type;
    }
  }
  
  return null;
};

export const attackDetectionMiddleware = (req, res, next) => {
  const checkValue = (value, path) => {
    if (typeof value === 'string') {
      const attack = detectSuspiciousPatterns(value);
      if (attack) {
        if (attack === 'sql') {
          logSqlInjectionAttempt(value, req.ip, req.path);
        } else if (attack === 'xss') {
          logXssAttempt(value, req.ip, req.path);
        } else {
          logSecurityEvent(
            SecurityLevel.ATTACK,
            SecurityEvent.SUSPICIOUS_ACTIVITY,
            {
              attackType: attack,
              input: value.substring(0, 100),
              ip: req.ip,
              path: req.path,
              field: path
            }
          );
        }
        
        return res.status(400).json({ 
          error: 'Input inválido detectado. Requisição bloqueada por segurança.' 
        });
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        const result = checkValue(val, `${path}.${key}`);
        if (result) return result;
      }
    }
    return null;
  };
  
  const checks = [
    checkValue(req.body, 'body'),
    checkValue(req.query, 'query'),
    checkValue(req.params, 'params')
  ];
  
  for (const check of checks) {
    if (check) return check;
  }
  
  next();
};

export default {
  SecurityLevel,
  SecurityEvent,
  logSecurityEvent,
  securityLoggerMiddleware,
  logLoginAttempt,
  logPasswordChange,
  logSqlInjectionAttempt,
  logXssAttempt,
  detectSuspiciousPatterns,
  attackDetectionMiddleware
};
