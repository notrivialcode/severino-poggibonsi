import { ILogger, LogEntry } from '../types';

export class MockLogger implements ILogger {
  private logs: LogEntry[] = [];

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  private log(level: LogEntry['level'], message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      meta,
    };
    this.logs.push(entry);

    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${level.toUpperCase()}] [${entry.timestamp.toISOString()}] ${message}${metaStr}`);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsByLevel(level: LogEntry['level']): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  clearLogs(): void {
    this.logs = [];
  }

  hasLogMatching(level: LogEntry['level'], messagePattern: string | RegExp): boolean {
    return this.logs.some((log) => {
      if (log.level !== level) return false;
      if (typeof messagePattern === 'string') {
        return log.message.includes(messagePattern);
      }
      return messagePattern.test(log.message);
    });
  }
}

export function createLogger(): ILogger {
  return new MockLogger();
}
