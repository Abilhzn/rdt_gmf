import { Component, OnInit } from '@angular/core';
import { CurrentUserService } from '@auth/services/current-user.service';
import { InvestigationService, InvestigationRow } from '../services/investigation.service';
import { DinasService, DinasEntry } from '../services/dinas.service';
import { ModalService } from '../services/modal.service';

// REQ-RDT-LEDGER-10 — TAB-only, own nav item (see shell.component's canSeeInvestigation getter).
// "Ask TA" is not a dinas: it's a signal a row's ownership is ambiguous and needs manual TAB
// investigation (Ref.Doc/PO cross-check) before a real dinas_target can be assigned. Assign()
// moves the row to PENDING under the chosen dinas — that dinas confirms/declines it normally
// from there, NOT TAB. Ground truth: ui-demo.html's Investigation view.
@Component({
  selector: 'rdt-investigation',
  standalone: false,
  templateUrl: './investigation.component.html',
  styleUrls: ['./investigation.component.scss'],
})
export class InvestigationComponent implements OnInit {
  rows: InvestigationRow[] = [];
  dinasCodes: DinasEntry[] = [];
  targetByRowId: Record<number, string> = {};
  errorMessage = '';

  constructor(
    public currentUser: CurrentUserService,
    private investigation: InvestigationService,
    private dinas: DinasService,
    private modal: ModalService,
  ) {}

  ngOnInit(): void {
    this.dinas.getActiveDinas().subscribe((codes) => { this.dinasCodes = codes; });
    this.currentUser.user$.subscribe(() => this.load());
  }

  load(): void {
    this.errorMessage = '';
    if (!this.currentUser.current) return;
    this.investigation.list().subscribe({
      next: (rows) => { this.rows = rows; },
      error: (err) => { this.errorMessage = err?.message || 'Gagal memuat antrian investigasi'; },
    });
  }

  // A row's own dinas_inisiasi can't be assigned back to itself — same rule as the reassignment
  // target picker (validateReassignTarget on the backend enforces this too either way).
  dinasOptionsFor(row: InvestigationRow): DinasEntry[] {
    return this.dinasCodes.filter((d) => d.code.toUpperCase() !== String(row.dinas_inisiasi || '').toUpperCase());
  }

  async assign(row: InvestigationRow): Promise<void> {
    const target = this.targetByRowId[row.id];
    if (!target) { await this.modal.alert('Pilih dinas target dulu.'); return; }
    const ok = await this.modal.confirm(`Assign baris ini ke dinas ${target}? Baris akan masuk antrian konfirmasi normal dinas tersebut.`);
    if (!ok) return;
    this.investigation.assign(row.id, target).subscribe({
      next: async (dinasTarget) => {
        await this.modal.success('Baris di-assign ke ' + dinasTarget);
        this.load();
      },
      error: async (err) => { await this.modal.alert('Error: ' + (err?.message || err)); },
    });
  }
}
