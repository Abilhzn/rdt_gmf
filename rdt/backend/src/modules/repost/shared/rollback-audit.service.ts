import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { classifyError } from '../../../core/errors/error-classification';

/**
 * Rollback-audit — dipakai SETIAP route ledger-mutating yang bungkus `db.withTransaction`
 * (`ConfirmationService` 3b, `ReassignmentService`/`InvestigationService` 3c). `withTransaction`
 * sudah ROLLBACK sebelum re-throw; baris audit ROLLBACK ini ditulis lewat `DatabaseService.query`
 * (pool, koneksi TERPISAH dari client transaksi yang barusan rollback) — kalau ditulis lewat
 * client yang sama, entry ini ikut hilang. Dulu ini `logger.js`'s `logRollbackAudit`, diekstrak
 * ke sini (bukan copy-paste) supaya 3b & 3c pakai satu implementasi (arahan IT, prompt 3c §0b).
 */
@Injectable()
export class RollbackAuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(args: {
    userId: string;
    ip: string | null;
    err: unknown;
    route: string;
    transactionId?: number | null;
  }): Promise<string> {
    const { userId, ip, err, route, transactionId = null } = args;
    const category = classifyError(err);
    try {
      const message = err instanceof Error ? err.message : String(err);
      await this.db.query(
        `INSERT INTO rdt.audit_log(user_id,transaction_id,action,status_before,status_after,detail,ip_address) VALUES($1,$2,'ROLLBACK',$3,$4,$5,$6)`,
        [
          userId || 'unknown',
          transactionId,
          null,
          null,
          JSON.stringify({ route, category, message }),
          ip,
        ],
      );
    } catch {
      // Logging audit sendiri gagal tidak boleh menutupi respons error asli.
    }
    return category;
  }
}
