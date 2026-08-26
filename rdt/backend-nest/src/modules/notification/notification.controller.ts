import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { BaseController } from '../../core/base.controller';
import { CurrentUser } from '../../core/security/current-user.decorator';
import type { Identity } from '../../core/security/identity.interface';
import { NotificationService } from './notification.service';

/**
 * `notifications` — semua user login (tak perlu TAB/role tertentu), tak ada guard tambahan di
 * sini -- `IdentityMiddleware` global sudah menjamin `req.identity` ada (401 dilempar provider-nya
 * sendiri kalau tidak, sama pola dengan `UploadController`/`PersistController`).
 */
@Controller('notifications')
export class NotificationController extends BaseController {
  constructor(private readonly notifications: NotificationService) {
    super();
  }

  @Get()
  @ApiOperation({
    summary: '50 notifikasi terbaru milik user ini + unread_count.',
  })
  async list(@CurrentUser() user: Identity) {
    return this.ok(await this.notifications.getNotifications(user.userId));
  }

  @Post('mark-read')
  @ApiOperation({ summary: 'Tandai semua notifikasi user ini terbaca.' })
  async markRead(@CurrentUser() user: Identity) {
    await this.notifications.markRead(user.userId);
    return this.ok({ success: true });
  }
}
