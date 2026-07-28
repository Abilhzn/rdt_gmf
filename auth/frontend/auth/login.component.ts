import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CurrentUserService } from '../services/current-user.service';

// REQ-RDT-NAV-08 — synthetic username+password login screen, ground truth ui-demo.html
// (screen-login). On success, always continues to Select Platform (not straight to the app
// shell) even though RDT is the only platform today — mirrors enterSelectPlatform().
@Component({
  selector: 'rdt-login',
  standalone: false,
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  username = '';
  password = '';
  errorMessage = '';
  submitting = false;

  constructor(private currentUser: CurrentUserService, private router: Router, private route: ActivatedRoute) {}

  submit(): void {
    this.errorMessage = '';
    this.submitting = true;
    this.currentUser.login(this.username, this.password).subscribe({
      next: () => {
        this.submitting = false;
        this.password = '';
        // relative, not '/select-platform' — keeps working under whatever prefix the host
        // platform mounts RdtModule at (dev-shell mounts it under '/rdt').
        this.router.navigate(['../select-platform'], { relativeTo: this.route });
      },
      error: (err) => {
        this.submitting = false;
        this.errorMessage = err?.error?.error || err?.message || 'Login gagal.';
      },
    });
  }
}
