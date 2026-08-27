import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './core/exception/global-exception.filter';
import { setupSwagger } from './core/swagger/swagger.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Port dari auth/data_user's helmet setup, TAPI beda satu hal penting: auth/data_user JSON-only
  // (CSP dikunci 'none' semua directive), backend ENGGAK — `/docs` nyajiin Swagger UI beneran
  // (HTML/inline script/style), CSP setat kayak itu bakal mecahin halaman itu sendiri. CSP di-off,
  // proteksi helmet lain (frameguard, hsts, noSniff, dst) tetap jalan pakai default-nya.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: { action: 'deny' },
      hsts: { maxAge: 15552000, includeSubDomains: true }, // 180 hari
    }),
  );
  // Port dari auth/data_user's request-timeout middleware — batasi tiap request ke SUATU respons
  // alih-alih ngegantung selamanya kalau ada yang macet.
  app.use((req: Request, res: Response, next: () => void) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({
          statusCode: 503,
          message:
            'Request timeout — server tidak merespons dalam 30 detik. Coba lagi.',
          error: 'REQUEST_TIMEOUT',
        });
      }
    }, 30000);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
