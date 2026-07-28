import { Component } from '@angular/core';

@Component({
  selector: 'rdt-mapping-editor',
  standalone: false,
  template: `
    <h3>Mapping Normalisasi Dinas</h3>
    <p>Ini editor sederhana untuk mapping prefix -> dinas. Edit JSON lalu klik Simpan.</p>
    <textarea [(ngModel)]="txt" rows="8" style="width:100%"></textarea>
    <div style="margin-top:8px;"><button (click)="save()">Simpan</button></div>
  `
})
export class MappingEditorComponent {
  txt = '{}';
  async ngOnInit() {
    const res = await fetch('/api/mapping');
    const j = await res.json();
    this.txt = JSON.stringify(j.mapping || {}, null, 2);
  }
  async save() {
    try {
      const obj = JSON.parse(this.txt);
      const res = await fetch('/api/mapping', { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(obj) });
      const j = await res.json();
      if (!j.ok) alert('Gagal menyimpan: '+(j.error||'')); else alert('Tersimpan');
    } catch (e) { alert('JSON invalid: '+(e instanceof Error ? e.message : String(e))); }
  }
}
