import { Component } from '@angular/core';
import { CurrentUserService } from '@auth/services/current-user.service';

/**
 * Daftar panduan fitur RDT. `pdfs` = peta role -> nama file PDF di `assets/guides/`.
 * - Role-aware (isi/tampilan beda per role, mis. Dashboard/Repost History): dua entry berbeda.
 * - Role-specific (hanya dipakai satu role, mis. Upload/Share-Cost): satu entry saja.
 * - Universal (konten sama utk PIC & TAB, mis. Diskusi/Notifikasi/Login): dua key menunjuk ke
 *   PDF yang SAMA (bukan duplikasi berkas — cukup satu file, dua entry peta).
 *
 * PDF-nya sendiri di-generate dari rdt/docs/guides-source/*.html via
 * rdt/docs/guides-source/build-guide-pdfs.ps1 — lihat README di folder itu kalau perlu update
 * konten panduan.
 */
interface GuideOption {
  id: string;
  label: string;
  pdfs: Partial<Record<'PIC' | 'TAB', string>>;
}

const GUIDES: GuideOption[] = [
  { id: 'login', label: 'Login & Pilih Platform', pdfs: { PIC: 'login.pdf', TAB: 'login.pdf' } },
  { id: 'dashboard', label: 'Dashboard', pdfs: { PIC: 'dashboard-pic.pdf', TAB: 'dashboard-tab.pdf' } },
  { id: 'upload', label: 'Upload Detail Transaction', pdfs: { PIC: 'upload-pic.pdf' } },
  { id: 'confirm', label: 'Detail Confirmation', pdfs: { PIC: 'confirm-pic.pdf' } },
  { id: 'need-corp', label: 'Need Identification — Corp', pdfs: { TAB: 'need-corp-tab.pdf' } },
  { id: 'need-investigation', label: 'Need Identification — Ask TA', pdfs: { TAB: 'need-investigation-tab.pdf' } },
  { id: 'share-cost', label: 'Share-Cost', pdfs: { TAB: 'share-cost-tab.pdf' } },
  { id: 'wait-to-repost', label: 'Wait to Repost', pdfs: { TAB: 'wait-to-repost-tab.pdf' } },
  { id: 'repost-history', label: 'Repost History', pdfs: { PIC: 'repost-history-pic.pdf', TAB: 'repost-history-tab.pdf' } },
  { id: 'period-settings', label: 'Period Settings', pdfs: { TAB: 'period-settings-tab.pdf' } },
  { id: 'diskusi', label: 'Diskusi & Progress Pasangan Dinas', pdfs: { PIC: 'diskusi.pdf', TAB: 'diskusi.pdf' } },
  { id: 'notifikasi', label: 'Notifikasi', pdfs: { PIC: 'notifikasi.pdf', TAB: 'notifikasi.pdf' } },
];

@Component({
  selector: 'rdt-guidance-page',
  standalone: false,
  templateUrl: './guidance-page.component.html',
  styleUrls: ['./guidance-page.component.scss'],
})
export class GuidancePageComponent {
  // Cuma tampilin fitur yang genuinely relevan buat role user yang login — PIC gak perlu (dan
  // gak boleh kepo) liat "Need Identification"/"Share-Cost"/dst yang itu fitur TAB-only, dan
  // sebaliknya TAB gak perlu liat "Upload"/"Detail Confirmation" yang itu punya PIC. Sama gating
  // yang dipakai shell.component.ts buat nav item (role-based visibility), cuma di sini per-baris
  // guide bukan per-nav-link.
  get guides(): GuideOption[] {
    const role = this.currentUser.current?.role;
    if (!role) return [];
    return GUIDES.filter((g) => role in g.pdfs);
  }

  // Accordion 2 tingkat, bukan dropdown — id fitur yang lagi dibuka (null = semua tertutup).
  expandedGuideId: string | null = null;

  constructor(private currentUser: CurrentUserService) {}

  // Baris role di dalam tiap panel — DIBATASI ke role user yang login sendiri (bukan semua role
  // yang genuinely punya pdfs). Guide "universal" (mis. Dashboard, Repost History) punya entry PIC
  // & TAB sekaligus di GUIDES, tapi nampilin baris TAB ke user PIC (atau sebaliknya) sama saja
  // bocorin fitur/tampilan role lain — persis yang mau dihindari dengan filter `guides` di atas.
  rolesFor(guide: GuideOption): ('PIC' | 'TAB')[] {
    const role = this.currentUser.current?.role;
    return role && role in guide.pdfs ? [role] : [];
  }

  // Toggle panel tingkat-1: klik header yang sudah expanded -> tutup lagi; klik header lain ->
  // pindah ke situ.
  toggleGuide(guide: GuideOption): void {
    this.expandedGuideId = this.expandedGuideId === guide.id ? null : guide.id;
  }

  // Baris role langsung jadi link ke PDF-nya — gak ada pilih-lalu-klik-tombol terpisah lagi.
  openGuide(guide: GuideOption, role: 'PIC' | 'TAB'): void {
    const pdf = guide.pdfs[role];
    if (!pdf) return;
    window.open(`assets/guides/${pdf}`, '_blank');
  }
}
