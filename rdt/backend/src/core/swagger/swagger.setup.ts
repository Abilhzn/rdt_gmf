import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('RDT API')
    .setDescription(
      'RDT backend — hasil rewrite penuh dari Express lama (rdt/backend) ke NestJS. ' +
        'Endpoint dikelompokkan per module (repost upload/mapping/confirmation/reassignment/' +
        'investigation/persist/export, notification, dashboard, period-deadlines, share-cost, ' +
        'master-data).',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
