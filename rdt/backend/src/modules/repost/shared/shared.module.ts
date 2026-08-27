import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { DirectoryModule } from '../../../core/directory/directory.module';
import { PairCommentService } from './pair-comment.service';
import { RollbackAuditService } from './rollback-audit.service';

/**
 * Helper lintas-route (bukan lintas-domain — spesifik repost): `PairCommentService` (reply
 * thread + notif per pasangan) dan `RollbackAuditService` (audit ROLLBACK via koneksi terpisah).
 * Dipakai `ConfirmationModule` (3b), `ReassignmentModule` & `InvestigationModule` (3c).
 */
@Module({
  imports: [DatabaseModule, DirectoryModule],
  providers: [PairCommentService, RollbackAuditService],
  exports: [PairCommentService, RollbackAuditService],
})
export class SharedModule {}
