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
- PWA installabile con uso offline
- archivio principale su IndexedDB (piu adatto a molti dati)
- migrazione automatica da localStorage alla prima apertura

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
