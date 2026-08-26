import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './core/exception/global-exception.filter';
import { setupSwagger } from './core/swagger/swagger.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
