/**
 * Utilitários de sanitização e validação para prevenir ataques
 */

/**
 * Remove caracteres HTML perigosos para prevenir XSS
 */
export const sanitizeHtml = (str) => {
  if (typeof str !== 'string') return str;
  
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Remove caracteres SQL perigosos (defesa adicional além de prepared statements)
 */
export const sanitizeSql = (str) => {
  if (typeof str !== 'string') return str;
  
  // Remove caracteres potencialmente perigosos
  return str
    .replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, (char) => {
      switch (char) {
        case '\0': return '\\0';
        case '\x08': return '\\b';
        case '\x09': return '\\t';
        case '\x1a': return '\\z';
        case '\n': return '\\n';
        case '\r': return '\\r';
        case '"':
        case "'":
        case '\\':
        case '%':
          return '\\' + char;
        default:
          return char;
      }
    });
};

/**
 * Valida e sanitiza email
 */
export const sanitizeEmail = (email) => {
  if (typeof email !== 'string') return null;
  
  email = email.toLowerCase().trim();
  
  // Regex mais rigoroso para validação de email
  const emailRegex = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  
  if (!emailRegex.test(email)) {
    return null;
  }
  
  // Limita tamanho máximo
  if (email.length > 254) {
    return null;
  }
  
  return email;
};

/**
 * Sanitiza nome de usuário
 */
export const sanitizeName = (name) => {
  if (typeof name !== 'string') return null;
  
  name = name.trim();
  
  // Remove múltiplos espaços
  name = name.replace(/\s+/g, ' ');
  
  // Remove caracteres especiais perigosos mantendo acentuação
  name = name.replace(/[<>\"'`]/g, '');
  
  // Limita tamanho
  if (name.length < 2 || name.length > 100) {
    return null;
  }
  
  return name;
};

/**
 * Sanitiza objeto recursivamente
 */
export const sanitizeObject = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' ? sanitizeHtml(obj) : obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // Remove propriedades potencialmente perigosas
    if (key.startsWith('__') || key.startsWith('$')) {
      continue;
    }
    
    sanitized[key] = sanitizeObject(value);
  }
  
  return sanitized;
};

/**
 * Valida UUID v4
 */
export const isValidUuid = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Valida ID numérico
 */
export const isValidId = (id) => {
  const numId = parseInt(id, 10);
  return Number.isInteger(numId) && numId > 0 && numId < Number.MAX_SAFE_INTEGER;
};

/**
 * Remove caracteres de controle Unicode
 */
export const removeControlChars = (str) => {
  if (typeof str !== 'string') return str;
  
  // Remove caracteres de controle exceto tab, newline e carriage return
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
};

/**
 * Valida e sanitiza URL
 */
export const sanitizeUrl = (url) => {
  if (typeof url !== 'string') return null;
  
  url = url.trim();
  
  try {
    const parsed = new URL(url);
    
    // Apenas permite http e https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    
    return parsed.href;
  } catch {
    return null;
  }
};

/**
 * Middleware de sanitização para Express
 */
export const sanitizeMiddleware = (req, res, next) => {
  // Sanitiza body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  
  // Sanitiza query params (Express 5.x - req.query é read-only, então copiamos as props)
  if (req.query && typeof req.query === 'object') {
    const sanitized = sanitizeObject(req.query);
    Object.keys(req.query).forEach(key => delete req.query[key]);
    Object.assign(req.query, sanitized);
  }
  
  // Sanitiza params (Express 5.x - req.params é read-only, então copiamos as props)
  if (req.params && typeof req.params === 'object') {
    const sanitized = sanitizeObject(req.params);
    Object.keys(req.params).forEach(key => delete req.params[key]);
    Object.assign(req.params, sanitized);
  }
  
  next();
};

export default {
  sanitizeHtml,
  sanitizeSql,
  sanitizeEmail,
  sanitizeName,
  sanitizeObject,
  isValidUuid,
  isValidId,
  removeControlChars,
  sanitizeUrl,
  sanitizeMiddleware
};
