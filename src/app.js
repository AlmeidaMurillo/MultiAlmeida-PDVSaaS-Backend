import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apicache from 'apicache';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import routes from './routes.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin === allowedOrigin) return callback(null, true);
      return callback(new Error('Origin não permitido'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  message: 'Muitas requisições a partir deste IP, tente novamente após 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(['/api/admin/login', '/api/login', '/api/criar-conta'], limiter);

const cache = apicache.middleware;
app.use('/api/planos', cache('60 seconds'));

app.use(routes);

export default app;
