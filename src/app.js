import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apicache from 'apicache';
import cookieParser from 'cookie-parser';
import routes from './routes.js';
import { generalLimiter } from './middlewares/rateLimit.js';

let sanitizeMiddleware = (req, res, next) => next();
let securityLoggerMiddleware = (req, res, next) => next();
let attackDetectionMiddleware = (req, res, next) => next();

try {
  const sanitizeModule = await import('./utils/sanitize.js');
  sanitizeMiddleware = sanitizeModule.sanitizeMiddleware;
} catch (err) {
  console.warn('⚠️  Módulo sanitize.js não encontrado. Sanitização desabilitada.');
}

try {
  const securityModule = await import('./utils/securityLogger.js');
  securityLoggerMiddleware = securityModule.securityLoggerMiddleware;
  attackDetectionMiddleware = securityModule.attackDetectionMiddleware;
} catch (err) {
  console.warn('⚠️  Módulo securityLogger.js não encontrado. Logging de segurança desabilitado.');
}

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"], 
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true, 
}));

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const allowedOrigins = frontendUrl.split(',').map(url => url.trim());

if (!allowedOrigins.includes('http://localhost:5173')) {
  allowedOrigins.push('http://localhost:5173');
}

if (!allowedOrigins.includes('https://localhost:5173')) {
  allowedOrigins.push('https://localhost:5173');
}

if (!allowedOrigins.includes('http://127.0.0.1:5173')) {
  allowedOrigins.push('http://127.0.0.1:5173');
}
if (!allowedOrigins.includes('https://127.0.0.1:5173')) {
  allowedOrigins.push('https://127.0.0.1:5173');
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Não permitido pelo CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
    maxAge: 600, 
  })
);

app.use(express.json({ 
  limit: '10kb',
  strict: true,
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10kb' 
}));

app.use(cookieParser());

app.use((req, res, next) => {
  delete req.headers['x-forwarded-host'];
  
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.includes('application/json') && !contentType.includes('application/x-www-form-urlencoded')) {
      return res.status(415).json({ error: 'Content-Type não suportado' });
    }
  }
  
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/admin')) {
    return next();
  }
  generalLimiter(req, res, next);
});

// Middleware desabilitado para evitar logs duplicados
// O sistema de logs principal (logger.js) já registra todas as ações no banco de dados
// app.use(securityLoggerMiddleware);

app.use(attackDetectionMiddleware);

app.use(sanitizeMiddleware);

const cache = apicache.middleware;
app.use('/api/planos', cache('60 seconds'));

app.use(routes);

export default app;