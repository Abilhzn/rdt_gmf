import { Component, Input } from '@angular/core';

export interface ChainHopVm {
  from: string;
  to: string;
  resolved: number;
  total: number;
  /** SIMETRI (5 Agu): true for every hop except the current/active one. An earlier hop is a
   * SETTLED, instantaneous fact (that dinas rejected-and-redirected, or the initiator reassigned
   * after a decline) — it never had a "some confirmed, some pending" state of its own, so showing
   * it with the same progress-bar language as the live hop was misleading (a fabricated 100% that
   * implied N real confirmations happened there). Only the current hop (isRedirected=false) has
   * real resolved/total numbers worth a bar. */
  isRedirected: boolean;
}

// REQ-RDT-UI-05 "Rincian per-hop" (4 Agu, project owner-approved): renders the actual per-hop
// breakdown rows shared by every place a redirect/reassign chain (chain.length > 2) needs to show
// more than just breadcrumb text — Dashboard pair-cards, Dashboard-Detailing's header badge, and
// Confirm's per-row popover all reuse this instead of 3 copies of the same hop math/truncation.
// Only the SURROUNDING chrome (sideways panel + divider vs a floating popover) differs per
// caller — that stays in each caller's own template since it depends on layout context (a flex
// card row has room to widen sideways, a table cell doesn't).
@Component({
  selector: 'rdt-chain-hop-detail',
  standalone: false,
  templateUrl: './chain-hop-detail.component.html',
  styleUrls: ['./chain-hop-detail.component.scss'],
})
export class ChainHopDetailComponent {
  @Input() chain: string[] = [];
  /** Omit both when there's no meaningful in-progress fraction to show — e.g. a SINGLE
   * transaction's own chain (Confirm's per-row popover): it already fully traversed every hop to
   * reach its current dinas, nothing about it is "5 of 12 done". Falls back to a plain
   * checkmarked path instead of progress bars when either is undefined. */
  @Input() resolved?: number;
  @Input() total?: number;
  @Input() title = 'Rincian per-hop';

  hopsExpanded = false;

  get showProgress(): boolean {
    return this.total !== undefined && this.resolved !== undefined;
  }

  // SIMETRI (5 Agu, project owner report — "cuma dari satu sudut pandang"): every hop gets an
  // status appropriate to what ACTUALLY happened there, instead of every early hop faking the
  // LAST hop's own resolved/total numbers. chain is only ever populated past 2 points when EVERY
  // transaction under the card agrees on the exact same full path (buildChainAwareProgress's
  // chainConsistent check), so chain-membership alone already proves every early hop was a
  // completed redirect (isRedirected=true, no bar) — the LAST hop (current target) is the only
  // one still actively accumulating confirmations, so it's the only one that gets the real
  // resolved/total bar.
  get hops(): ChainHopVm[] {
    if (!this.chain || this.chain.length < 3) return [];
    const total = this.total || 0;
    const resolved = this.resolved || 0;
    const hops: ChainHopVm[] = [];
    for (let i = 0; i < this.chain.length - 1; i++) {
      const isLast = i === this.chain.length - 2;
      hops.push({ from: this.chain[i], to: this.chain[i + 1], resolved, total, isRedirected: !isLast });
    }
    return hops;
  }

  // Long chains (5+ hops, i.e. > 4 individual hops): always show the FIRST hop (where the chain
  // started) and the LAST hop (the only one still in progress) — collapse everything in between
  // behind a "+N hop lainnya" toggle instead of letting the panel grow unbounded or need its own
  // scrollbar (project owner's explicit concern, 4 Agu).
  get visibleHops(): ChainHopVm[] {
    const all = this.hops;
    if (all.length <= 4 || this.hopsExpanded) return all;
    return [all[0], all[all.length - 1]];
  }

  get hiddenHopCount(): number {
    const all = this.hops;
    return all.length <= 4 ? 0 : all.length - 2;
  }

  toggleHops(event: MouseEvent): void {
    event.stopPropagation();
    this.hopsExpanded = !this.hopsExpanded;
  }
}
