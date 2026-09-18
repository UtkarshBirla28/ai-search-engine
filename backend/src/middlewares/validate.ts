import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import ApiError from '../utils/ApiError.js';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates request segments against a Zod schema map.
 * Replaces req[segment] with the parsed (and coerced) values.
 */
const validate =
  (schemas: ValidationSchemas): RequestHandler =>
  (req, _res, next) => {
    try {
      const segments: Array<keyof ValidationSchemas> = ['body', 'query', 'params'];
      for (const segment of segments) {
        const schema = schemas[segment];
        if (schema) {
          (req as unknown as Record<string, unknown>)[segment] = schema.parse(req[segment]);
        }
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        return next(ApiError.badRequest('Validation failed', details));
      }
      return next(error);
    }
  };

export default validate;
