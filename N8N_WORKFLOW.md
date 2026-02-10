# n8n workflow pronto (backup Appunti PWA)

Questa guida riceve il JSON inviato dal pulsante `Invia JSON` della webapp.
Gestisce sia payload in chiaro che payload cifrato.

## 1) Crea workflow in n8n

Nodi consigliati:

1. `Webhook` (trigger)
2. `IF encrypted?`
3. `Code - Parse Plain` (ramo `false`)
4. `Code - Decrypt Encrypted` (ramo `true`)
5. `Merge` (modalita `Append`)
6. `Respond to Webhook`

## 2) Configura Webhook

- Metodo: `POST`
- Path: ad esempio `appunti-backup`
- Response: usa `Respond to Webhook` node

L'URL finale lo incolli nella webapp, sezione `Automazioni n8n`.

## 3) Nodo IF `encrypted?`

Condizione booleana:

- Left value: `{{ $json.encrypted }}`
- Operation: `is true`

## 4) Nodo Code (ramo false): `Code - Parse Plain`

```javascript
const body = $json;
const data = body.data ?? body;

return [
  {
    json: {
      event: body.event ?? "backup.export",
      mode: body.mode ?? { encryptJson: false, onlyFiltered: false },
      meta: body.meta ?? null,
      data,
    },
  },
];
```

## 5) Nodo Code (ramo true): `Code - Decrypt Encrypted`

Prima imposta una variabile ambiente in n8n:

- `APPUNTI_PASSPHRASE` = la passphrase usata in app quando invii JSON cifrato

Codice:

```javascript
const crypto = require("crypto");

function b64(input) {
  return Buffer.from(input, "base64");
}

const body = $json;
const passphrase = $env.APPUNTI_PASSPHRASE;

if (!passphrase) {
  throw new Error("Variabile APPUNTI_PASSPHRASE non impostata in n8n");
}

if (!body.cipherText || !body.iv || !body.salt) {
  throw new Error("Payload cifrato incompleto");
}

const salt = b64(body.salt);
const iv = b64(body.iv);
const encryptedWithTag = b64(body.cipherText);

// Compatibile con app.js: PBKDF2 SHA-256, 150000 iterazioni, chiave 32 byte
const key = crypto.pbkdf2Sync(passphrase, salt, 150000, 32, "sha256");

// In WebCrypto AES-GCM, il tag (16 byte) e' accodato al ciphertext
const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);

const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);

const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
const data = JSON.parse(plain);

return [
  {
    json: {
      event: body.event ?? "backup.export",
      mode: body.mode ?? { encryptJson: true, onlyFiltered: false },
      meta: body.meta ?? null,
      data,
    },
  },
];
```

## 6) Merge + Respond

- Collega i due nodi `Code` al nodo `Merge`
- Dal `Merge` vai a `Respond to Webhook`
- Nel `Respond to Webhook` puoi restituire:

```json
{
  "ok": true,
  "receivedAt": "={{ $now }}",
  "noteCount": "={{ $json.data.notes.length }}"
}
```

## 7) Salvataggio dati (opzionale)

Dopo `Merge` puoi aggiungere uno di questi nodi:

- `Google Drive` (crea file JSON)
- `Microsoft OneDrive` (crea file JSON)
- `Postgres` (salva metadati e note)
- `Notion` / `Airtable` (se preferisci workspace)

## 8) Payload atteso dalla webapp

- `event`: `backup.export`
- `encrypted`: `true/false`
- `mode`: `{ encryptJson, onlyFiltered }`
- `meta`: conteggi/filtri
- `data`: presente solo in chiaro
- `cipherText/iv/salt`: presenti solo se cifrato
