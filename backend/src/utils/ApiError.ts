export interface ApiErrorOptions {
  details?: unknown;
  isOperational?: boolean;
}

/**
 * Operational error carrying an HTTP status code.
 * Thrown by services/controllers and translated to a JSON response
 * by the global error handler.
 */
class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details: unknown;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    { details = null, isOperational = true }: ApiErrorOptions = {}
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad Request', details?: unknown): ApiError {
    return new ApiError(400, message, { details });
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not Found'): ApiError {
    return new ApiError(404, message);
  }

  static internal(message = 'Internal Server Error'): ApiError {
    return new ApiError(500, message, { isOperational: false });
  }
}

export default ApiError;
