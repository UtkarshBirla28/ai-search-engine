import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import env from './config/env.js';
import { httpLogStream } from './config/logger.js';
import rateLimiter from './middlewares/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import routes from './routes/index.js';

const app = express();

// Security & performance middleware
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','),
    credentials: true,
  })
);
app.use(compression());

// Body parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTP request logging
app.use(morgan(env.isProduction ? 'combined' : 'dev', { stream: httpLogStream }));

// Rate limiting
app.use(rateLimiter);

// API routes
app.use(env.apiPrefix, routes);

// Root
app.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { name: 'AI Search Engine API', version: '1.0.0', docs: `${env.apiPrefix}/health` },
  });
});

// 404 + error handling (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
