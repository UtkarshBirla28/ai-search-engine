import winston from 'winston';
import env from './env.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack }) => {
    return `${ts} [${level}]: ${stack || message}`;
  })
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const logger = winston.createLogger({
  level: env.logLevel,
  format: env.isProduction ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

// Stream used by morgan HTTP request logging.
// Logged at "info" so requests are visible at the default log level.
export const httpLogStream = {
  write: (message: string): void => {
    logger.info(message.trim());
  },
};

export default logger;
