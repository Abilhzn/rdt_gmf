import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '../errors/domain-error';
import { logError } from './error-log.util';

/**
 * Ubah semua error (domain error, HttpException Nest, atau unhandled) jadi response JSON
 * konsisten: { statusCode, message, error }. Dipasang global di main.ts.
 *
 * Guardrail: untuk transaksi DB, ROLLBACK harus sudah terjadi di dalam service SEBELUM
 * exception naik ke sini (lihat DatabaseService.withTransaction). Filter ini hanya membentuk
 * response, tidak menyentuh DB.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error, error_category } =
      this.resolve(exception);
    const body = {
      statusCode,
      message,
      error,
      ...(error_category ? { error_category } : {}),
    };
    // Port dari auth/data_user's errorLoggingMiddleware — tiap 5xx ke-log ke logs/error.log
    // (lihat error-log.util.ts), supaya gak cuma keliatan di terminal yang bisa ke-scroll.
    if (statusCode >= 500) {
      logError({
        method: request.method,
        path: request.originalUrl,
        status: statusCode,
        body,
      });
    }
    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
    error_category?: string;
  } {
    if (exception instanceof DomainError) {
      return {
        statusCode: exception.statusCode,
        message: exception.message,
        error: exception.errorCode,
        error_category: exception.errorCategory,
      };
    }
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string }).message ?? exception.message);
      return {
        statusCode: exception.getStatus(),
        message: Array.isArray(message) ? message.join(', ') : message,
        error: exception.name,
      };
    }
    const err =
      exception instanceof Error ? exception : new Error('Unknown error');
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
      error: 'InternalServerError',
    };
  }
}
