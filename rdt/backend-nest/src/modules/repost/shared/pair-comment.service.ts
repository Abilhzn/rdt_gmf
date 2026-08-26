import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DIRECTORY_PROVIDER } from '../../../core/directory/directory.interface';
import type { DirectoryProvider } from '../../../core/directory/directory.interface';
import {
  filterMentionsToPair,
  resolveMentionedUserIds,
} from '../rules/mention-rules';

/**
 * Reply-ke-thread-terlatest-atau-comment-baru untuk satu pasangan (dinas_inisiasi, dinas_target)
 * — dipakai `ConfirmationService` (submit description, Batch 3b) DAN reassignment/investigation
 * (Batch 3c), sebelumnya 3 salinan nyaris identik di route lama (`confirmation.js`,
 * `investigation.js`). Diekstrak ke sini biar satu tempat (arahan IT, lihat prompt 3c §0).
 *
 * Caller wajib jalan di dalam transaksi (`client` dari `DatabaseService.withTransaction`).
 */
@Injectable()
export class PairCommentService {
  constructor(
    @Inject(DIRECTORY_PROVIDER) private readonly directory: DirectoryProvider,
  ) {}

  async post(
    client: PoolClient,
    args: {
      dinasInisiasi: string;
      dinasTarget: string;
      // Sisi pasangan yang dianggap "konteks" (otomatis jadi penerima notif tanpa perlu
      // @mention) — BEDA per caller: confirmation memberitahu dinas_inisiasi (yang barusan
      // dikonfirmasi/ditolak), investigation memberitahu dinas_target (dinas yang baru
      // ditugaskan TAB). Harus salah satu dari dinasInisiasi/dinasTarget di atas.
      implicitRecipientDinas: string;
      // Dipakai kalau pasangan ini belum punya thread top-level sama sekali.
      fallbackTransactionId: number;
      authorUserId: string;
      body: string;
    },
  ): Promise<void> {
    const {
      dinasInisiasi,
      dinasTarget,
      implicitRecipientDinas,
      fallbackTransactionId,
      authorUserId,
      body,
    } = args;

    const parentRes = await client.query<{
      id: number;
      transaction_id: number;
    }>(
      `SELECT c.id, c.transaction_id FROM rdt.comments c
       JOIN rdt.transactions t ON t.id = c.transaction_id
       WHERE t.dinas_inisiasi=$1 AND t.dinas_target=$2 AND c.parent_comment_id IS NULL
       ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
      [dinasInisiasi, dinasTarget],
    );
    const parent = parentRes.rows[0];
    const commentRes = await client.query<{ id: number }>(
      `INSERT INTO rdt.comments (transaction_id, parent_comment_id, author_user_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        parent ? parent.transaction_id : fallbackTransactionId,
        parent ? parent.id : null,
        authorUserId,
        body,
      ],
    );
    const commentId = commentRes.rows[0].id;

    // Union: siapa pun ber-dinas == implicitRecipientDinas (konteks) PLUS siapa pun yang
    // di-@mention di teks, tapi mention harus milik pasangan ini spesifik (tidak boleh bocor ke
    // pasangan lain yang kebetulan berbagi teks yang sama — lihat mentionRules).
    const directory = await this.directory.load();
    const mentioned = filterMentionsToPair(
      resolveMentionedUserIds(body, directory),
      directory,
      [dinasInisiasi, dinasTarget],
    );
    const recipientIds = new Set(mentioned);
    Object.keys(directory).forEach((id) => {
      if (
        String(directory[id].dinas).toUpperCase() ===
        implicitRecipientDinas.toUpperCase()
      ) {
        recipientIds.add(id);
      }
    });
    recipientIds.delete(authorUserId);

    for (const recipientId of recipientIds) {
      await client.query(
        'INSERT INTO rdt.notifications (recipient_user_id, comment_id) VALUES ($1, $2)',
        [recipientId, commentId],
      );
    }
  }
}
