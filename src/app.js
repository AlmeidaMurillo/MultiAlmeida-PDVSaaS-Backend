import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apicache from 'apicache';
import cookieParser from 'cookie-parser';
import routes from './routes.js';
import { generalLimiter } from './middlewares/rateLimit.js';

// Imports condicionais de segurança
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

// Configurar trust proxy ANTES de qualquer middleware
app.set('trust proxy', 1);

// Helmet com configurações de segurança melhoradas
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' }, // Proteção contra clickjacking
  noSniff: true, // Previne MIME sniffing
  xssFilter: true, // Ativa proteção XSS do navegador
  hidePoweredBy: true, // Remove header X-Powered-By
}));

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const allowedOrigins = frontendUrl.split(',').map(url => url.trim());

if (!allowedOrigins.includes('http://localhost:5173')) {
  allowedOrigins.push('http://localhost:5173');
}

if (!allowedOrigins.includes('https://localhost:5173')) {
  allowedOrigins.push('https://localhost:5173');
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (ex: Postman, mobile apps)
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
    maxAge: 600, // 10 minutos de cache para preflight
  })
);

// Limita tamanho de payload JSON para prevenir ataques
app.use(express.json({ 
  limit: '10kb',
  strict: true, // Aceita apenas arrays e objetos
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10kb' 
}));

app.use(cookieParser());

// Middleware de sanitização básica de headers
app.use((req, res, next) => {
  // Remove headers potencialmente perigosos
  delete req.headers['x-forwarded-host'];
  
  // Valida Content-Type para requests com body
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.includes('application/json') && !contentType.includes('application/x-www-form-urlencoded')) {
      return res.status(415).json({ error: 'Content-Type não suportado' });
    }
  }
  
  next();
});

// Rate limiter geral aplicado a todas as rotas
app.use(generalLimiter);

// Middleware de logging de segurança (se disponível)
app.use(securityLoggerMiddleware);

// Middleware de detecção de ataques (se disponível)
app.use(attackDetectionMiddleware);

// Middleware de sanitização (se disponível)
app.use(sanitizeMiddleware);

const cache = apicache.middleware;
app.use('/api/planos', cache('60 seconds'));

app.use(routes);

export default app;