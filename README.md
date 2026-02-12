# Appunti Locali PWA (telefono + computer)

Struttura attuale:
- pulsante menu a sinistra
- nel menu: ricerca note, gestione etichette, backup import/export
- nella schermata principale: titolo, nuovo appunto, lista appunti

Funzioni:
- inserimento rapido con Invio
- etichette associabili ai nuovi appunti
- modifica ed eliminazione appunti
- ricerca su TUTTI gli appunti (anche oltre i primi 100 mostrati)
- filtri combinabili: testo, date, etichette
- paginazione: primi 100 risultati + "Carica altri 100"
- backup/import JSON
- invio backup verso webhook n8n (chiaro o cifrato)
- PWA installabile con uso offline
- archivio principale su IndexedDB (piu adatto a molti dati)
- migrazione automatica da localStorage alla prima apertura

## Payload n8n (Invia JSON)

Il pulsante `Invia JSON` manda un payload con struttura:

- `event`: `backup.export`
- `encrypted`: `true/false`
- `mode`: `{ encryptJson, onlyFiltered }`
- `meta`: conteggi e filtri applicati
- `data`: presente solo in chiaro
- `cipherText/iv/salt`: presenti solo in modalita cifrata

Se attivi `Invia solo le note filtrate`, il payload contiene solo i risultati correnti della ricerca.

Workflow pronto:
- vedi `N8N_WORKFLOW.md` per configurazione completa (plain + cifrato).
- import diretto: `n8n-appunti-backup-workflow.json`
- salvataggio su Google Drive: `n8n-appunti-google-drive-workflow.json`
- se usi invio cifrato, imposta in n8n la variabile ambiente `APPUNTI_PASSPHRASE`.

## Avvio senza Python (PowerShell)

```powershell
cd "c:\Users\ruben\projects\codex-app\progetto appunti"
powershell -ExecutionPolicy Bypass -File .\start-local.ps1 -Port 5173
```

## Avvio con Node (alternativa)

```powershell
cd "c:\Users\ruben\projects\codex-app\progetto appunti"
npx --yes http-server@14.1.1 . -p 5173 -a 0.0.0.0 -c-1
```

## Accesso da telefono

1. Telefono e PC sulla stessa Wi-Fi.
2. Trova IP PC con `ipconfig`.
3. Apri sul telefono `http://IP_PC:5173`.
4. Usa "Aggiungi a schermata Home".

## Dopo l'aggiornamento

Se vedi ancora la vecchia UI, fai refresh forzato (`Ctrl+F5`) o cancella i dati sito del browser per aggiornare la cache PWA.
