import { Component, OnInit } from '@angular/core';
import { ExportBatchService, PeriodDefaultDeadline } from '../services/export-batch.service';
import { ModalService } from '../services/modal.service';
import { extractErrorMessage } from '../shared/error-message.util';

// REQ-RDT-SAP-16/19/20 (13 Agu split) — was setting-periode.component's "Setting Deadline" panel,
// now its own sub-page ("Setting Deadline", sibling of "'Repost' Active" — see
// repost-active.component). SAP-20: submitDefaultDeadline() now does BOTH the periode-wide
// default upsert AND the sweep onto every currently-active pasangan in that periode in ONE call —
// the old separate "Terapkan ke Pasangan Aktif" bulk panel/action is gone entirely.
@Component({
  selector: 'rdt-setting-deadline',
  standalone: false,
  templateUrl: './setting-deadline.component.html',
  styleUrls: ['./setting-periode.component.scss'],
})
export class SettingDeadlineComponent implements OnInit {
  defaultDeadlineForm = { periode: '', deadline_at: '' };
  defaultDeadlineFormBusy = false;
  defaultDeadlineFormMessage = '';
  existingDefaultDeadlines: PeriodDefaultDeadline[] = [];
  deletingPeriode: string | null = null;

  constructor(
    private exportBatches: ExportBatchService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.exportBatches.getDefaultPeriodDeadlines().subscribe({
      next: (rows) => { this.existingDefaultDeadlines = rows; },
      error: () => { /* supplementary panel — don't block the rest of the page on it */ },
    });
  }

  // REQ-RDT-SAP-19 — deletable only before the deadline itself passes, same guard the backend
  // enforces (routes/periodDeadlines.js DELETE /default/:periode).
  canDelete(row: PeriodDefaultDeadline): boolean {
    return new Date(row.deadline_at).getTime() > Date.now();
  }

  async deleteDefault(row: PeriodDefaultDeadline): Promise<void> {
    const ok = await this.modal.confirm(`Hapus deadline default periode ${row.periode}? Pasangan yang belum muncul di periode ini gak lagi otomatis dapat deadline.`);
    if (!ok) return;
    this.deletingPeriode = row.periode;
    this.exportBatches.deleteDefaultPeriodDeadline(row.periode).subscribe({
      next: () => { this.deletingPeriode = null; this.load(); },
      error: async (err) => {
        this.deletingPeriode = null;
        await this.modal.alert('Gagal menghapus deadline: ' + extractErrorMessage(err, String(err)));
      },
    });
  }

  // REQ-RDT-SAP-20 — one action: sweeps existing active pasangan immediately AND sets the default
  // for pasangan that show up later, both in the same request.
  async submitDefaultDeadline(): Promise<void> {
    const { periode, deadline_at } = this.defaultDeadlineForm;
    if (!periode || !deadline_at) return;
    const ok = await this.modal.confirm(
      `Set deadline periode ${periode} = ${new Date(deadline_at).toLocaleString('id-ID')}? ` +
      `Ini langsung berlaku ke SEMUA pasangan yang sedang aktif di periode ini sekarang, dan otomatis jadi ` +
      `default buat pasangan manapun yang baru muncul nanti di periode ini (kecuali punya override sendiri).`
    );
    if (!ok) return;
    this.defaultDeadlineFormBusy = true;
    this.defaultDeadlineFormMessage = '';
    this.exportBatches.setDefaultPeriodDeadline(periode, new Date(deadline_at).toISOString()).subscribe({
      next: (res) => {
        this.defaultDeadlineFormBusy = false;
        const sweptNote = res.swept.length
          ? ` ${res.swept.length} pasangan aktif langsung ikut ter-set: ${res.swept.map((r) => `${r.dinas_inisiasi}→${r.dinas_target}`).join(', ')}.`
          : ' Tidak ada pasangan aktif di periode ini saat ini — deadline tetap tersimpan sebagai default.';
        this.defaultDeadlineFormMessage = `Deadline periode ${res.deadline.periode} tersimpan: ${new Date(res.deadline.deadline_at).toLocaleString('id-ID')}.${sweptNote}`;
        this.load();
      },
      error: async (err) => {
        this.defaultDeadlineFormBusy = false;
        await this.modal.alert('Gagal menyimpan deadline: ' + extractErrorMessage(err, String(err)));
      },
    });
  }
}
