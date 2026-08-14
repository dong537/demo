import { Injectable } from '@nestjs/common';
import { requestIdStorage } from './request-id.context';
import { env } from '../config/env.schema';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: LogLevel = env.NODE_ENV === 'production' ? 'info' : 'debug';

@Injectable()
export class LoggerService {
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (levelOrder[level] < levelOrder[minLevel]) return;
    process.stdout.write(
      JSON.stringify({ level, message, requestId: requestIdStorage.getStore(), timestamp: new Date().toISOString(), ...context }) + '\n',
    );
  }

  info(message: string, context?: Record<string, unknown>): void { this.log('info', message, context); }
  warn(message: string, context?: Record<string, unknown>): void { this.log('warn', message, context); }
  error(message: string, context?: Record<string, unknown>): void { this.log('error', message, context); }
  debug(message: string, context?: Record<string, unknown>): void { this.log('debug', message, context); }
}
