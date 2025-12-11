import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apicache from 'apicache';
import cookieParser from 'cookie-parser';
import routes from './routes.js';
import { generalLimiter } from './middlewares/rateLimit.js';

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
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
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

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Rate limiter geral aplicado a todas as rotas
app.use(generalLimiter);



const cache = apicache.middleware;
app.use('/api/planos', cache('60 seconds'));

app.use(routes);

export default app;