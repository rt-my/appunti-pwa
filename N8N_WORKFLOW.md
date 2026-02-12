# n8n + Google Drive (pronto da importare)

Workflow pronto:

- `n8n-appunti-google-drive-workflow.json`

Obiettivo:

1. ricevere il JSON dalla webapp (`Invia JSON`);
2. salvarlo su Google Drive;
3. se il payload arriva cifrato, salvarlo cifrato (raw) per re-importarlo poi nella webapp.

---

## 1) Importa il workflow in n8n

1. Apri n8n.
2. `Workflows` -> `Import from File`.
3. Seleziona `n8n-appunti-google-drive-workflow.json`.
4. Salva il workflow.

---

## 2) Configura Google Drive

Nel nodo `Google Drive Upload`:

1. crea/seleziona credenziale `Google Drive OAuth2`;
2. autorizza il tuo account Google;
3. opzionale: scegli cartella Drive (campo `parents`).

Nota:
- nel JSON c'e un placeholder `REPLACE_WITH_YOUR_CREDENTIAL_ID`, e normale.

---

## 3) Attiva webhook e prendi URL

Nel nodo `Webhook Appunti`:

- Path: `appunti-backup-drive`
- Metodo: `POST`

Attiva il workflow e copia il `Production URL`.

---

## 4) Configura la webapp

In app:

1. `Automazioni n8n`
2. abilita integrazione
3. incolla URL webhook
4. se vuoi file cifrato su Drive, abilita `Cifra il JSON prima dell'invio`
5. `Salva webhook`
6. `Invia JSON`

---

## 5) Cosa salva su Drive

Il workflow gestisce 3 casi:

1. `backup.export` cifrato -> salva il payload raw cifrato (`encrypted-raw`).
2. `backup.export` in chiaro -> salva il backup puro (`plain-data`).
3. backup JSON diretto -> salva il JSON così com'e (`plain-backup`).

Nome file automatico:

- `appunti-backup-<modalita>-<timestamp>.json`

---

## 6) Come reimportare in app

1. scarica il file da Drive;
2. in webapp: `Backup -> Importa JSON`.

Se il file e cifrato raw:

- la webapp rileva `encrypted:true`, chiede passphrase e decifra in import.

---

## 7) Risposta webhook

Il workflow risponde con JSON tipo:

```json
{
  "ok": true,
  "saved": true,
  "storageMode": "encrypted-raw",
  "encryptedStored": true,
  "fileName": "appunti-backup-encrypted-raw-....json",
  "fileId": "...",
  "webViewLink": "..."
}
```

---

## 8) Troubleshooting rapido

- errore upload Drive:
  - ricontrolla credenziale OAuth e permessi cartella.
- errore webhook dalla webapp:
  - URL sbagliato o workflow non attivo.
- import file cifrato fallisce in app:
  - passphrase errata rispetto a quella usata in invio.
