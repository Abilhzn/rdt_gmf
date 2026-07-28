import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

// Single platform option today (RDT). Project owner correction (25 Jul): NO auto-advance, even
// with only one tile to pick — always require an explicit click, same as if there were several
// choices. An earlier version auto-navigated after 900ms "since there's nothing else to choose
// from yet"; that read as broken/un-fun rather than convenient, so it's gone for good — don't
// reintroduce a timer here even after more platforms (e.g. IBT) are added.
@Component({
  selector: 'rdt-select-platform',
  standalone: false,
  templateUrl: './select-platform.component.html',
  styleUrls: ['./select-platform.component.scss'],
})
export class SelectPlatformComponent {
  constructor(private router: Router, private route: ActivatedRoute) {}

  select(): void {
    // relative, not '/dashboard' — see LoginComponent's note on mount-prefix independence.
    this.router.navigate(['../dashboard'], { relativeTo: this.route });
  }
}
