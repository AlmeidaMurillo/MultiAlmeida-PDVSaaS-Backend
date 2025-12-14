/**
 * Sistema de logging de eventos de segurança
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, '../../logs');

// Cria diretório de logs se não existir
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Níveis de severidade
 */
export const SecurityLevel = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  ATTACK: 'ATTACK'
};

/**
 * Tipos de eventos de segurança
 */
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

/**
 * Registra evento de segurança
 */
export const logSecurityEvent = (level, event, details = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    event,
    ...details
  };

  // Log em arquivo
  const logFile = path.join(logsDir, `security-${new Date().toISOString().split('T')[0]}.log`);
  const logLine = JSON.stringify(logEntry) + '\n';
  
  fs.appendFile(logFile, logLine, (err) => {
    if (err) {
      console.error('Erro ao escrever log de segurança:', err);
    }
  });

  // Log no console com cores
  const colors = {
    INFO: '\x1b[36m',      // Cyan
    WARNING: '\x1b[33m',    // Yellow
    CRITICAL: '\x1b[31m',   // Red
    ATTACK: '\x1b[35m'      // Magenta
  };
  
  const reset = '\x1b[0m';
  const color = colors[level] || colors.INFO;
  
  console.log(`${color}[${level}] ${event}${reset}`, details);
};

/**
 * Middleware para logar requisições suspeitas
 */
export const securityLoggerMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Captura resposta
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - start;
    
    // Loga requisições que falharam com erro de autenticação ou autorização
    if (res.statusCode === 401 || res.statusCode === 403) {
      logSecurityEvent(
        SecurityLevel.WARNING,
        res.statusCode === 401 ? SecurityEvent.UNAUTHORIZED_ACCESS : SecurityEvent.PERMISSION_DENIED,
        {
          method: req.method,
          path: req.path,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          userId: req.user?.id,
          statusCode: res.statusCode,
          duration
        }
      );
    }
    
    // Loga requisições suspeitas (muitas no mesmo segundo)
    if (res.statusCode === 429) {
      logSecurityEvent(
        SecurityLevel.WARNING,
        SecurityEvent.RATE_LIMIT,
        {
          method: req.method,
          path: req.path,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          userId: req.user?.id
        }
      );
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

/**
 * Loga tentativa de login
 */
export const logLoginAttempt = (success, email, ip, userAgent, userId = null) => {
  logSecurityEvent(
    success ? SecurityLevel.INFO : SecurityLevel.WARNING,
    success ? SecurityEvent.LOGIN_SUCCESS : SecurityEvent.LOGIN_FAILED,
    {
      email,
      ip,
      userAgent,
      userId
    }
  );
};

/**
 * Loga mudança de senha
 */
export const logPasswordChange = (userId, ip) => {
  logSecurityEvent(
    SecurityLevel.INFO,
    SecurityEvent.PASSWORD_CHANGE,
    {
      userId,
      ip
    }
  );
};

/**
 * Loga tentativa de injeção SQL
 */
export const logSqlInjectionAttempt = (input, ip, path) => {
  logSecurityEvent(
    SecurityLevel.ATTACK,
    SecurityEvent.SQL_INJECTION_ATTEMPT,
    {
      input: input.substring(0, 100), // Limita tamanho
      ip,
      path
    }
  );
};

/**
 * Loga tentativa de XSS
 */
export const logXssAttempt = (input, ip, path) => {
  logSecurityEvent(
    SecurityLevel.ATTACK,
    SecurityEvent.XSS_ATTEMPT,
    {
      input: input.substring(0, 100),
      ip,
      path
    }
  );
};

/**
 * Detecta padrões suspeitos em strings
 */
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

/**
 * Middleware para detectar ataques comuns
 */
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
  
  // Verifica body, query e params
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
