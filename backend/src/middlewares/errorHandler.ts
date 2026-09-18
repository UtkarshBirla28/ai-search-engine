import type { ErrorRequestHandler, RequestHandler } from 'express';
import env from '../config/env.js';
import logger from '../config/logger.js';
import ApiError from '../utils/ApiError.js';

/**
 * 404 handler — reached when no route matched.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/**
 * Centralized error handler. Must be registered last.
 * `_next` is required for Express to treat this as an error handler.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let error: ApiError;

  if (err instanceof ApiError) {
    error = err;
  } else {
    const maybe = err as { statusCode?: number; message?: string };
    const statusCode = maybe.statusCode || 500;
    const message = maybe.message || 'Internal Server Error';
    error = new ApiError(statusCode, message, { isOperational: false });
  }

  const { statusCode, message, details, isOperational } = error;
  const stack = err instanceof Error ? err.stack : undefined;

  if (!isOperational || statusCode >= 500) {
    logger.error(`${statusCode} - ${message} - ${req.method} ${req.originalUrl}`);
    if (stack) logger.error(stack);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(details ? { details } : {}),
      ...(env.isProduction ? {} : { stack }),
    },
  });
};
