import { Component } from '@angular/core';
import { ModalService } from '../services/modal.service';

@Component({
  selector: 'rdt-modal',
  standalone: false,
  templateUrl: './modal.component.html',
  styleUrls: ['./modal.component.scss'],
})
export class ModalComponent {
  constructor(public modal: ModalService) {}
}
