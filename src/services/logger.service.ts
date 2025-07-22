import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

export interface LogContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
  [key: string]: any;
}

export class LoggerService {
  private logger: winston.Logger;

  constructor() {
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let log = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
          log += ` ${JSON.stringify(meta)}`;
        }
        return log;
      })
    );

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      defaultMeta: {
        service: 'shopen',
        environment: process.env.NODE_ENV || 'development',
      },
      transports: [
        // Console transport
        new winston.transports.Console({
          format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
        }),
      ],
    });

    // Add file transports in production
    if (process.env.NODE_ENV === 'production') {
      // General logs
      this.logger.add(
        new DailyRotateFile({
          filename: 'logs/application-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: logFormat,
        }) as any
      );

      // Error logs
      this.logger.add(
        new DailyRotateFile({
          filename: 'logs/error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          level: 'error',
          format: logFormat,
        }) as any
      );
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorInfo = error instanceof Error ? {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      }
    } : error ? { error } : {};

    this.logger.error(message, { ...errorInfo, ...context });
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context);
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }

  /**
   * Log verbose message
   */
  verbose(message: string, context?: LogContext): void {
    this.logger.verbose(message, context);
  }

  /**
   * Log HTTP request
   */
  logHttpRequest(req: {
    method: string;
    url: string;
    ip?: string;
    userAgent?: string;
  }, res: {
    statusCode: number;
  }, duration: number, context?: LogContext): void {
    this.info('HTTP Request', {
      request: {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.userAgent,
      },
      response: {
        statusCode: res.statusCode,
      },
      duration,
      ...context,
    });
  }

  /**
   * Log database query
   */
  logDatabaseQuery(query: string, duration: number, context?: LogContext): void {
    this.debug('Database Query', {
      query: query.substring(0, 1000), // Limit query length
      duration,
      ...context,
    });
  }

  /**
   * Log business event
   */
  logBusinessEvent(event: string, data: any, context?: LogContext): void {
    this.info(`Business Event: ${event}`, {
      event,
      data,
      ...context,
    });
  }

  /**
   * Log security event
   */
  logSecurityEvent(event: string, data: any, context?: LogContext): void {
    this.warn(`Security Event: ${event}`, {
      event,
      data,
      ...context,
    });
  }

  /**
   * Log payment event
   */
  logPaymentEvent(event: string, data: {
    orderId?: string;
    amount?: number;
    currency?: string;
    gateway?: string;
    status?: string;
    [key: string]: any;
  }, context?: LogContext): void {
    this.info(`Payment Event: ${event}`, {
      event,
      payment: data,
      ...context,
    });
  }

  /**
   * Log performance metric
   */
  logPerformance(metric: string, value: number, unit: string, context?: LogContext): void {
    this.debug('Performance Metric', {
      metric,
      value,
      unit,
      ...context,
    });
  }

  /**
   * Create child logger with default context
   */
  child(context: LogContext): LoggerService {
    const childLogger = new LoggerService();
    childLogger.logger = this.logger.child(context);
    return childLogger;
  }

  /**
   * Log tenant action
   */
  logTenantAction(
    tenantId: string,
    action: string,
    data?: any,
    userId?: string
  ): void {
    this.info(`Tenant Action: ${action}`, {
      tenantId,
      userId,
      action,
      data,
    });
  }

  /**
   * Log API call
   */
  logApiCall(
    api: string,
    method: string,
    duration: number,
    success: boolean,
    context?: LogContext
  ): void {
    const level = success ? 'info' : 'error';
    this.logger.log(level, `External API Call: ${api}`, {
      api,
      method,
      duration,
      success,
      ...context,
    });
  }

  /**
   * Structured logging helpers
   */
  startOperation(operation: string, context?: LogContext): string {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.debug(`Operation Started: ${operation}`, {
      operationId,
      operation,
      ...context,
    });
    return operationId;
  }

  endOperation(operationId: string, operation: string, success: boolean, duration: number, context?: LogContext): void {
    const level = success ? 'debug' : 'error';
    this.logger.log(level, `Operation Completed: ${operation}`, {
      operationId,
      operation,
      success,
      duration,
      ...context,
    });
  }
}