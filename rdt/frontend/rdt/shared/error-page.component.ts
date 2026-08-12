import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

// Checklist section 3 (12 Agu): "Custom 404/403 page yang informatif (bukan generic error
// Angular)" — before this, a bad URL under /rdt/... just silently failed to navigate (no route
// matched, no feedback at all) and a role-mismatched direct URL (e.g. a plain PIC hitting
// /rdt/admin/mapping) got into the shell with no visual cue before its API calls started
// 403-ing. One component, configured via route `data`, covers both — same shape, different code/
// copy, not two near-duplicate components.
@Component({
  selector: 'rdt-error-page',
  standalone: false,
  templateUrl: './error-page.component.html',
  styleUrls: ['./error-page.component.scss'],
})
export class ErrorPageComponent implements OnInit {
  code = 404;
  title = 'Halaman tidak ditemukan';
  message = 'URL yang kamu buka gak ada di RDT.';

  constructor(private route: ActivatedRoute, public router: Router) {}

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    if (data['code'] === 403) {
      this.code = 403;
      this.title = 'Akses ditolak';
      this.message = data['message'] || 'Kamu gak punya akses ke halaman ini.';
    }
  }
}
