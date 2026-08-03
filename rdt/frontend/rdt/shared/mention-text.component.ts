import { Component, Input, OnChanges } from '@angular/core';
import { MentionService } from '../services/mention.service';

interface Segment {
  text?: string;
  token?: string;
  label?: string;
}

// REQ-RDT-COMMENT-03 (diperjelas 3 Agu): "mention yang di-resolve ke akun beneran HARUS dirender
// sebagai elemen yang nunjuk ke akun itu ... BUKAN cuma teks '@nama' polos." This is that render —
// used wherever a comment/description body is displayed (thread comments, closing_description in
// Repost History, etc). An "@token" that resolves to a real dinas/user (MentionService.resolve,
// same rule backend's mentionRules.js uses to decide who gets notified) becomes a styled chip with
// the resolved name as a tooltip; a token that doesn't resolve to anything real stays plain text —
// same as backend never notifying a garbage/typo'd mention.
@Component({
  selector: 'rdt-mention-text',
  standalone: false,
  template: `<ng-container *ngFor="let seg of segments">
    <span *ngIf="seg.token; else plainText" class="mention-chip" [title]="seg.label || ''">@{{ seg.token }}</span>
    <ng-template #plainText>{{ seg.text }}</ng-template>
  </ng-container>`,
  styleUrls: ['./mention-text.component.scss'],
})
export class MentionTextComponent implements OnChanges {
  @Input() body = '';
  segments: Segment[] = [];

  constructor(private mentionSvc: MentionService) {}

  ngOnChanges(): void {
    this.segments = this.buildSegments(this.body || '');
  }

  private buildSegments(body: string): Segment[] {
    const parts: Segment[] = [];
    const re = /@([\w-]+)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      if (m.index > lastIndex) parts.push({ text: body.slice(lastIndex, m.index) });
      const token = m[1];
      const resolved = this.mentionSvc.resolve(token);
      parts.push(resolved ? { token, label: resolved.label } : { text: m[0] });
      lastIndex = re.lastIndex;
    }
    if (lastIndex < body.length) parts.push({ text: body.slice(lastIndex) });
    return parts;
  }
}
