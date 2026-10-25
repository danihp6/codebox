import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-repo-page',
  standalone: true,
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Repo</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p data-testid="page-repo">Repo — tasks 19-23</p>
    </ion-content>
  `,
})
export class RepoPage {}
