import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ModalState {
  message: string;
  showCancel: boolean;
  okText: string;
  cancelText: string;
  /** item 2: animated checkmark instead of the plain text dialog, for a short "done!"
   * confirmation (e.g. after a Repost submit) rather than an inline "data tersimpan" message. */
  checkmark: boolean;
}

// Replaces window.confirm()/alert() with an in-page centered dialog (white box, dark
// overlay) per the project owner's request. Rendered once at the shell level
// (shell.component.html) since it needs to sit above whichever routed page triggered it —
// a single body-level #modal-overlay.
@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly stateSubject = new BehaviorSubject<ModalState | null>(null);
  readonly state$: Observable<ModalState | null> = this.stateSubject.asObservable();
  private resolver: ((value: boolean) => void) | null = null;
  // Bumped on every open() so a stale auto-dismiss timer (from success()) can tell it's no
  // longer the current modal and skip closing whatever opened after it.
  private openToken = 0;

  confirm(message: string, okText = 'Ya, lanjutkan', cancelText = 'Batal'): Promise<boolean> {
    return this.open({ message, showCancel: true, okText, cancelText, checkmark: false });
  }

  alert(message: string, okText = 'OK'): Promise<boolean> {
    return this.open({ message, showCancel: false, okText, cancelText: '', checkmark: false });
  }

  // Item 2: a short animated "done!" confirmation — auto-dismisses on its own, but a click
  // anywhere resolves it immediately too so it never blocks the user.
  success(message = 'Selesai!', autoDismissMs = 1800): Promise<boolean> {
    const result = this.open({ message, showCancel: false, okText: 'OK', cancelText: '', checkmark: true });
    const myToken = this.openToken;
    setTimeout(() => { if (this.openToken === myToken) this.respond(true); }, autoDismissMs);
    return result;
  }

  private open(state: ModalState): Promise<boolean> {
    this.openToken += 1;
    this.stateSubject.next(state);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  respond(result: boolean): void {
    this.stateSubject.next(null);
    if (this.resolver) { this.resolver(result); this.resolver = null; }
  }
}
