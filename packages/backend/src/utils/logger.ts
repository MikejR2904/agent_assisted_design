import winston from 'winston';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';

const { paths, telemetry } = ConfigManager.getInstance().get();
const TELEMETRY_ROOT = paths.telemetryRoot ?? path.resolve(process.cwd(), '../../telemetry');

export const logger = winston.createLogger({
  level: telemetry.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        }),
      ),
    }),
    new winston.transports.File({
      filename: path.join(TELEMETRY_ROOT, 'system', 'orchestrator.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});