import { Component } from '@angular/core';

@Component({
  selector: 'rdt-exclusions-editor',
  standalone: false,
  template: `
    <h3>Prefix Eksklusi</h3>
    <p>Daftar prefix yang selalu di-exclude. Edit JSON &#123; "prefixes": ["AUAK","PO"] &#125;.</p>
    <textarea [(ngModel)]="txt" rows="4" style="width:100%"></textarea>
    <div style="margin-top:8px;"><button (click)="save()">Simpan</button></div>
  `
})
export class ExclusionsEditorComponent {
  txt = '{"prefixes":[] }';
  async ngOnInit() {
    const res = await fetch('/api/exclusions');
    const j = await res.json();
    this.txt = JSON.stringify(j.exclusions || { prefixes: [] }, null, 2);
  }
  async save() {
    try {
      const obj = JSON.parse(this.txt);
      const res = await fetch('/api/exclusions', { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(obj) });
      const j = await res.json();
      if (!j.ok) alert('Gagal menyimpan: '+(j.error||'')); else alert('Tersimpan');
    } catch (e) { alert('JSON invalid: '+(e instanceof Error ? e.message : String(e))); }
  }
}
