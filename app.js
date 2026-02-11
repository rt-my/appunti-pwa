const KEYS = {
  labels: "notes_labels",
  notes: "notes_items",
  lastBackupAt: "notes_last_backup_at",
  lastIncrementalExportAt: "notes_last_incremental_export_at",
  n8nConfig: "notes_n8n_config",
};

const IDB = {
  name: "appunti_db",
  version: 1,
  stores: {
    notes: "notes",
    labels: "labels",
    meta: "meta",
  },
};

const PAGE_SIZE = 100;
const RENDER_BATCH_SIZE = 40;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

const statusPill = document.getElementById("status-pill");
const backupMeta = document.getElementById("backup-meta");
const backupWarning = document.getElementById("backup-warning");
const backupGuideBtn = document.getElementById("backup-guide-btn");
const backupGuideBox = document.getElementById("backup-guide");
const exportBackupBtn = document.getElementById("export-backup-btn");
const exportMdBtn = document.getElementById("export-md-btn");
const exportTxtBtn = document.getElementById("export-txt-btn");
const exportIncrementalBtn = document.getElementById("export-incremental-btn");
const backupIncrementalMeta = document.getElementById("backup-incremental-meta");
const importBackupBtn = document.getElementById("import-backup-btn");
const importBackupFile = document.getElementById("import-backup-file");
const toggleTrashBtn = document.getElementById("toggle-trash-btn");
const emptyTrashBtn = document.getElementById("empty-trash-btn");
const trashMeta = document.getElementById("trash-meta");
const trashList = document.getElementById("trash-list");

const menuToggle = document.getElementById("menu-toggle");
const menuClose = document.getElementById("menu-close");
const sideMenu = document.getElementById("side-menu");
const menuOverlay = document.getElementById("menu-overlay");

const searchInput = document.getElementById("search-input");
const dateFromInput = document.getElementById("date-from");
const dateToInput = document.getElementById("date-to");
const encryptedVisibilityWrap = document.getElementById("encrypted-visibility-wrap");
const hideEncryptedNotesCheckbox = document.getElementById("hide-encrypted-notes");
const encryptedSearchMeta = document.getElementById("encrypted-search-meta");
const searchLabelsBox = document.getElementById("search-labels");
const clearFiltersBtn = document.getElementById("clear-filters");
const exportFilteredJsonBtn = document.getElementById("export-filtered-json-btn");
const exportFilteredMdBtn = document.getElementById("export-filtered-md-btn");
const exportFilteredTxtBtn = document.getElementById("export-filtered-txt-btn");

const noteInput = document.getElementById("note-input");
const addNoteBtn = document.getElementById("add-note-btn");
const labelInput = document.getElementById("label-input");
const addLabelBtn = document.getElementById("add-label-btn");
const sessionPassphraseBtn = document.getElementById("session-passphrase-btn");
const allLabelsBox = document.getElementById("all-labels");
const quickLabelsBox = document.getElementById("quick-labels");
const notesList = document.getElementById("notes-list");
const loadMoreBtn = document.getElementById("load-more-btn");
const noteTemplate = document.getElementById("note-template");
const n8nEnabledInput = document.getElementById("n8n-enabled");
const n8nEncryptJsonInput = document.getElementById("n8n-encrypt-json");
const n8nOnlyFilteredInput = document.getElementById("n8n-only-filtered");
const n8nWebhookUrlInput = document.getElementById("n8n-webhook-url");
const saveN8nBtn = document.getElementById("save-n8n-btn");
const testN8nBtn = document.getElementById("test-n8n-btn");
const sendJsonN8nBtn = document.getElementById("send-json-n8n-btn");
const n8nMeta = document.getElementById("n8n-meta");

let db = null;
let notes = [];
let labels = [];
let lastBackupAt = 0;
let lastIncrementalExportAt = 0;
let visibleCount = PAGE_SIZE;
let currentResults = [];
let renderedResultsCount = 0;
let renderObserver = null;
let renderToken = 0;
let searchDebounceTimer = null;
let sessionPassphrase = null;
let sessionIdleTimer = null;
let sessionActivityWatchersInstalled = false;
let trashOpen = false;
let n8nEnabled = false;
let n8nWebhookUrl = "";
let n8nEncryptJson = false;
let n8nOnlyFiltered = false;
const decryptedSearchIndex = new Map();
const decryptedNoteTextIndex = new Map();

const selectedNewLabelIds = new Set();
const searchLabelIds = new Set();
const protectedLabelIds = new Set();

initApp();

function isPinned(note) {
  return note?.pinned === true;
}

function compareNotes(a, b) {
  const pinDelta = Number(isPinned(b)) - Number(isPinned(a));
  if (pinDelta !== 0) {
    return pinDelta;
  }
  return (b.createdAt || 0) - (a.createdAt || 0);
}

function isTrashed(note) {
  return Number.isFinite(note?.trashedAt) && note.trashedAt > 0;
}

function getActiveNotes() {
  return notes.filter((note) => !isTrashed(note));
}

function getTrashNotes() {
  return notes
    .filter((note) => isTrashed(note))
    .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
}

function on(el, eventName, handler) {
  if (!el) {
    return;
  }
  el.addEventListener(eventName, handler);
}

async function initApp() {
  statusPill.textContent = "Inizializzazione archivio locale...";

  try {
    db = await openDb();
    await migrateFromLocalStorageIfNeeded();
    labels = await idbGetAll(IDB.stores.labels);
    notes = await idbGetAll(IDB.stores.notes);

    const lastBackupMeta = await idbGet(IDB.stores.meta, KEYS.lastBackupAt);
    lastBackupAt = Number(lastBackupMeta?.value || 0);

    const lastIncrementalMeta = await idbGet(IDB.stores.meta, KEYS.lastIncrementalExportAt);
    lastIncrementalExportAt = Number(lastIncrementalMeta?.value || 0);

    const protectedMeta = await idbGet(IDB.stores.meta, "protected_label_ids");
    const list = Array.isArray(protectedMeta?.value) ? protectedMeta.value : [];
    list.forEach((id) => protectedLabelIds.add(id));

    const n8nConfigMeta = await idbGet(IDB.stores.meta, KEYS.n8nConfig);
    if (n8nConfigMeta?.value && typeof n8nConfigMeta.value === "object") {
      n8nEnabled = Boolean(n8nConfigMeta.value.enabled);
      n8nWebhookUrl = typeof n8nConfigMeta.value.url === "string" ? n8nConfigMeta.value.url.trim() : "";
      n8nEncryptJson = Boolean(n8nConfigMeta.value.encryptJson);
      n8nOnlyFiltered = Boolean(n8nConfigMeta.value.onlyFiltered);
    }

    labels.sort((a, b) => a.name.localeCompare(b.name, "it"));
    notes.sort(compareNotes);

    bindEvents();
    renderN8nConfig();
    renderBackupMeta();
    renderEncryptedSearchMeta();
    updateEncryptionVisibilityControl();
    renderLabels();
    renderNotes();
    renderTrash();
    registerServiceWorker();

    statusPill.textContent = "Archivio locale pronto (IndexedDB)";
  } catch {
    statusPill.textContent = "Errore archivio locale";
  }
}

function bindEvents() {
  on(menuToggle, "click", openMenu);
  on(menuClose, "click", closeMenu);
  on(menuOverlay, "click", closeMenu);

  on(addNoteBtn, "click", submitNewNote);
  on(noteInput, "keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitNewNote();
    }
  });

  on(addLabelBtn, "click", createLabel);
  on(labelInput, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createLabel();
    }
  });

  on(sessionPassphraseBtn, "click", handleSessionPassphraseClick);

  on(searchInput, "input", debounceFilterRender);
  on(dateFromInput, "change", resetPaginationAndRender);
  on(dateToInput, "change", resetPaginationAndRender);
  on(hideEncryptedNotesCheckbox, "change", () => {
    renderLabels();
    resetPaginationAndRender();
  });

  on(clearFiltersBtn, "click", () => {
    searchInput.value = "";
    dateFromInput.value = "";
    dateToInput.value = "";
    searchLabelIds.clear();
    renderLabels();
    resetPaginationAndRender();
  });
  on(exportFilteredJsonBtn, "click", exportFilteredJson);
  on(exportFilteredMdBtn, "click", () => exportNotesAsText("md", { filtered: true }));
  on(exportFilteredTxtBtn, "click", () => exportNotesAsText("txt", { filtered: true }));

  on(loadMoreBtn, "click", () => {
    visibleCount += PAGE_SIZE;
    renderNotes();
  });

  on(backupGuideBtn, "click", runGuidedBackup);
  on(exportBackupBtn, "click", exportBackup);
  on(exportMdBtn, "click", () => exportNotesAsText("md"));
  on(exportTxtBtn, "click", () => exportNotesAsText("txt"));
  on(exportIncrementalBtn, "click", exportIncrementalBackup);
  on(importBackupBtn, "click", () => importBackupFile.click());
  on(importBackupFile, "change", importBackupFromFile);
  on(saveN8nBtn, "click", saveN8nConfig);
  on(testN8nBtn, "click", testN8nWebhook);
  on(sendJsonN8nBtn, "click", sendJsonToN8n);
  on(toggleTrashBtn, "click", () => {
    trashOpen = !trashOpen;
    renderTrash();
  });
  on(emptyTrashBtn, "click", emptyTrash);
  setupSessionInactivityWatcher();
}

function setupSessionInactivityWatcher() {
  if (sessionActivityWatchersInstalled) {
    return;
  }
  sessionActivityWatchersInstalled = true;

  const activityEvents = ["pointerdown", "keydown", "touchstart"];
  for (const eventName of activityEvents) {
    document.addEventListener(eventName, touchSessionActivity, { passive: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      touchSessionActivity();
    }
  });

  window.addEventListener("focus", touchSessionActivity);

}

function touchSessionActivity() {
  if (!sessionPassphrase) {
    return;
  }
  armSessionIdleTimer();
}

function stopSessionIdleTimer() {
  if (sessionIdleTimer) {
    clearTimeout(sessionIdleTimer);
    sessionIdleTimer = null;
  }
}

function armSessionIdleTimer() {
  stopSessionIdleTimer();
  sessionIdleTimer = setTimeout(() => {
    if (!sessionPassphrase) {
      return;
    }
    clearSessionPassphrase();
    statusPill.textContent = "Sessione bloccata automaticamente dopo 10 minuti di inattivita";
  }, SESSION_IDLE_TIMEOUT_MS);
}

async function runGuidedBackup() {
  if (backupGuideBox) {
    backupGuideBox.classList.remove("hidden");
  }
  await exportBackup();
  statusPill.textContent = "Backup esportato. Ora caricalo su Drive/OneDrive.";
}

function renderN8nConfig() {
  if (n8nEnabledInput) {
    n8nEnabledInput.checked = n8nEnabled;
  }
  if (n8nEncryptJsonInput) {
    n8nEncryptJsonInput.checked = n8nEncryptJson;
  }
  if (n8nOnlyFilteredInput) {
    n8nOnlyFilteredInput.checked = n8nOnlyFiltered;
  }
  if (n8nWebhookUrlInput) {
    n8nWebhookUrlInput.value = n8nWebhookUrl;
  }
  if (sendJsonN8nBtn) {
    sendJsonN8nBtn.disabled = !n8nEnabled || !n8nWebhookUrl;
  }
  if (n8nMeta) {
    if (!n8nWebhookUrl) {
      n8nMeta.textContent = "Webhook n8n non configurato.";
    } else if (!n8nEnabled) {
      n8nMeta.textContent = "Webhook salvato ma integrazione disattivata.";
    } else {
      const modeText = n8nEncryptJson ? "JSON cifrato" : "JSON in chiaro";
      const scopeText = n8nOnlyFiltered ? "solo note filtrate" : "tutte le note";
      n8nMeta.textContent = `Webhook n8n attivo (${modeText}, ${scopeText}).`;
    }
  }
}

async function saveN8nConfig() {
  n8nEnabled = Boolean(n8nEnabledInput?.checked);
  n8nEncryptJson = Boolean(n8nEncryptJsonInput?.checked);
  n8nOnlyFiltered = Boolean(n8nOnlyFilteredInput?.checked);
  n8nWebhookUrl = (n8nWebhookUrlInput?.value || "").trim();
  if (n8nEnabled && !n8nWebhookUrl) {
    statusPill.textContent = "Inserisci URL webhook prima di attivarlo";
    return;
  }

  await idbPut(IDB.stores.meta, {
    key: KEYS.n8nConfig,
    value: {
      enabled: n8nEnabled,
      url: n8nWebhookUrl,
      encryptJson: n8nEncryptJson,
      onlyFiltered: n8nOnlyFiltered,
    },
  });
  renderN8nConfig();
  statusPill.textContent = "Configurazione n8n salvata";
}

function getActiveFilterSnapshot() {
  const selectedLabelIds = Array.from(searchLabelIds);
  const selectedLabelNames = selectedLabelIds
    .map((id) => labels.find((entry) => entry.id === id)?.name || "")
    .filter(Boolean);

  return {
    text: searchInput.value.trim(),
    dateFrom: dateFromInput.value || null,
    dateTo: dateToInput.value || null,
    labelIds: selectedLabelIds,
    labelNames: selectedLabelNames,
    hideProtected: shouldHideProtectedItems(),
  };
}

function buildN8nBackupPayload(options = {}) {
  const { filtered = false } = options;
  const exportedAt = Date.now();
  const notesForExport = getNotesForExport({ filtered });

  return {
    version: 2,
    exportedAt,
    filtered,
    filters: filtered ? getActiveFilterSnapshot() : null,
    labels,
    protectedLabelIds: Array.from(protectedLabelIds),
    notes: notesForExport,
    app: {
      source: "appunti-pwa",
      time: exportedAt,
    },
  };
}

async function postJsonWithTimeout(url, payload, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sendJsonToN8n() {
  const targetUrl = (n8nWebhookUrlInput?.value || "").trim();
  if (!targetUrl) {
    statusPill.textContent = "Inserisci URL webhook";
    return;
  }
  if (!n8nEnabled) {
    statusPill.textContent = "Abilita integrazione n8n prima dell'invio";
    return;
  }

  const onlyFiltered = Boolean(n8nOnlyFilteredInput?.checked);
  const backupPayload = buildN8nBackupPayload({ filtered: onlyFiltered });
  const dataMeta = {
    noteCount: backupPayload.notes.length,
    activeNoteCount: getActiveNotes().length,
    labelCount: labels.length,
    protectedLabelCount: protectedLabelIds.size,
    exportedAt: backupPayload.exportedAt,
    filtered: onlyFiltered,
    filters: backupPayload.filters,
  };
  let requestPayload = {
    event: "backup.export",
    encrypted: false,
    mode: {
      encryptJson: false,
      onlyFiltered,
    },
    meta: dataMeta,
    data: backupPayload,
  };

  if (n8nEncryptJson) {
    const passphrase = window.prompt("Passphrase per cifrare il JSON da inviare a n8n:");
    if (!passphrase) {
      statusPill.textContent = "Invio annullato: passphrase mancante";
      return;
    }
    try {
      const encrypted = await encryptText(JSON.stringify(backupPayload), passphrase);
      requestPayload = {
        event: "backup.export",
        encrypted: true,
        mode: {
          encryptJson: true,
          onlyFiltered,
        },
        meta: dataMeta,
        cipherText: encrypted.cipherText,
        iv: encrypted.iv,
        salt: encrypted.salt,
      };
    } catch {
      statusPill.textContent = "Errore cifratura JSON per n8n";
      return;
    }
  }

  try {
    const response = await postJsonWithTimeout(targetUrl, requestPayload);
    if (!response.ok) {
      statusPill.textContent = `Invio JSON n8n fallito: HTTP ${response.status}`;
      return;
    }
    statusPill.textContent = `JSON inviato a n8n (${dataMeta.noteCount} note${onlyFiltered ? " filtrate" : ""})`;
  } catch {
    statusPill.textContent = "Invio JSON n8n fallito: webhook non raggiungibile";
  }
}

async function testN8nWebhook() {
  const testUrl = (n8nWebhookUrlInput?.value || "").trim();
  if (!testUrl) {
    statusPill.textContent = "Inserisci URL webhook da testare";
    return;
  }

  try {
    const response = await postJsonWithTimeout(testUrl, {
      event: "test",
      app: {
        source: "appunti-pwa",
        time: Date.now(),
      },
      message: "Test webhook n8n",
    });
    if (!response.ok) {
      statusPill.textContent = `Test n8n fallito: HTTP ${response.status}`;
      return;
    }
    statusPill.textContent = "Test n8n ok";
  } catch {
    statusPill.textContent = "Test n8n fallito: webhook non raggiungibile";
  }
}

async function handleSessionPassphraseClick() {
  if (sessionPassphrase) {
    clearSessionPassphrase();
    statusPill.textContent = "Sessione bloccata";
    return;
  }

  const typed = window.prompt("Inserisci passphrase di sessione:");
  if (!typed) {
    return;
  }

  const result = await applySessionPassphrase(typed);
  if (result.ok) {
    if (result.failed > 0) {
      statusPill.textContent = `Sessione aperta: ${result.failed} note non decifrabili`;
    } else {
      statusPill.textContent = "Sessione aperta";
    }
  } else {
    statusPill.textContent = "Passphrase errata o incompatibile con le note cifrate";
  }
}

function clearSessionPassphrase() {
  stopSessionIdleTimer();
  sessionPassphrase = null;
  decryptedSearchIndex.clear();
  decryptedNoteTextIndex.clear();
  if (sessionPassphraseBtn) {
    sessionPassphraseBtn.textContent = "Password";
  }
  renderEncryptedSearchMeta();
  updateEncryptionVisibilityControl();
}

async function applySessionPassphrase(passphrase) {
  const result = await buildDecryptedIndexes(passphrase);
  if (result.totalEncrypted > 0 && result.okCount === 0) {
    return { ok: false, failed: result.failedCount };
  }

  sessionPassphrase = passphrase;
  armSessionIdleTimer();
  if (sessionPassphraseBtn) {
    sessionPassphraseBtn.textContent = "Blocca sessione";
  }
  renderEncryptedSearchMeta();
  updateEncryptionVisibilityControl();
  return { ok: true, failed: result.failedCount };
}

async function buildDecryptedIndexes(passphrase) {
  decryptedSearchIndex.clear();
  decryptedNoteTextIndex.clear();

  let totalEncrypted = 0;
  let okCount = 0;
  let failedCount = 0;

  for (const note of notes) {
    if (!note.encrypted || isTrashed(note)) {
      continue;
    }
    totalEncrypted += 1;
    try {
      const plain = await decryptText(note, passphrase);
      decryptedNoteTextIndex.set(note.id, plain);
      decryptedSearchIndex.set(note.id, plain.toLowerCase());
      okCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return { totalEncrypted, okCount, failedCount };
}

function updateEncryptionVisibilityControl() {
  if (!encryptedVisibilityWrap || !hideEncryptedNotesCheckbox) {
    return;
  }

  const unlocked = Boolean(sessionPassphrase);
  if (unlocked) {
    hideEncryptedNotesCheckbox.checked = false;
  }
  hideEncryptedNotesCheckbox.disabled = unlocked;
  encryptedVisibilityWrap.classList.toggle("hidden", unlocked);
  encryptedVisibilityWrap.title = unlocked ? "" : "Se attivo, nasconde totalmente etichette e note cifrate";

  renderLabels();
  resetPaginationAndRender();
}

function renderEncryptedSearchMeta() {
  if (!encryptedSearchMeta) {
    return;
  }
  if (sessionPassphrase) {
    encryptedSearchMeta.textContent = "Sessione aperta: ricerca cifrate attiva.";
  } else {
    encryptedSearchMeta.textContent = "Sessione bloccata: ricerca cifrate disattiva.";
  }
}

async function exportIncrementalBackup() {
  const cursor = Number.isFinite(lastIncrementalExportAt) ? lastIncrementalExportAt : 0;
  const changedNotes = notes.filter((note) => (note.updatedAt || note.createdAt || 0) > cursor);

  const payload = {
    version: 1,
    incremental: true,
    exportedAt: Date.now(),
    fromUpdatedAtExclusive: cursor,
    labels,
    protectedLabelIds: Array.from(protectedLabelIds),
    notes: changedNotes,
  };

  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "appunti-backup-incrementale.json";
  a.click();
  URL.revokeObjectURL(url);

  lastIncrementalExportAt = payload.exportedAt;
  await idbPut(IDB.stores.meta, { key: KEYS.lastIncrementalExportAt, value: lastIncrementalExportAt });
  renderBackupMeta();

  if (changedNotes.length === 0) {
    statusPill.textContent = "Incrementale esportato: nessuna modifica dal backup precedente";
  } else {
    statusPill.textContent = `Incrementale esportato: ${changedNotes.length} note aggiornate`;
  }
}
async function submitNewNote() {
  const text = noteInput.value.trim();
  if (!text) {
    return;
  }

  const selected = Array.from(selectedNewLabelIds);
  const mustEncrypt = selected.some((id) => protectedLabelIds.has(id));

  let note = {
    id: generateId(),
    text,
    labelIds: selected,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    trashedAt: null,
    encrypted: false,
  };

  if (mustEncrypt) {
    const passphrase = await ensureSessionPassphrase("Per salvare note protette serve una passphrase:");
    if (!passphrase) {
      statusPill.textContent = "Nota non salvata: passphrase mancante";
      return;
    }

    let encryptedPayload;
    try {
      encryptedPayload = await encryptText(text, passphrase);
    } catch {
      statusPill.textContent = "Errore cifratura: verifica browser/contesto e passphrase";
      return;
    }
    note = {
      ...note,
      text: "",
      encrypted: true,
      cipherText: encryptedPayload.cipherText,
      iv: encryptedPayload.iv,
      salt: encryptedPayload.salt,
    };

    if (sessionPassphrase) {
      decryptedNoteTextIndex.set(note.id, text);
      decryptedSearchIndex.set(note.id, text.toLowerCase());
    }
  }

  notes.unshift(note);
  await idbPut(IDB.stores.notes, note);

  noteInput.value = "";
  selectedNewLabelIds.clear();
  renderLabels();
  resetPaginationAndRender();
}

function debounceFilterRender() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    resetPaginationAndRender();
  }, 120);
}

function openMenu() {
  sideMenu.classList.add("open");
  sideMenu.setAttribute("aria-hidden", "false");
  menuOverlay.classList.remove("hidden");
}

function closeMenu() {
  sideMenu.classList.remove("open");
  sideMenu.setAttribute("aria-hidden", "true");
  menuOverlay.classList.add("hidden");
}

async function createLabel() {
  const name = labelInput.value.trim().toLowerCase();
  if (!name) {
    return;
  }

  if (labels.some((item) => item.name === name)) {
    labelInput.value = "";
    return;
  }

  const label = { id: generateId(), name, createdAt: Date.now() };
  labels.push(label);
  labels.sort((a, b) => a.name.localeCompare(b.name, "it"));
  await idbPut(IDB.stores.labels, label);

  labelInput.value = "";
  renderLabels();
}

function renderLabels() {
  allLabelsBox.innerHTML = "";
  quickLabelsBox.innerHTML = "";
  searchLabelsBox.innerHTML = "";
  const hideProtected = shouldHideProtectedItems();

  if (hideProtected) {
    Array.from(selectedNewLabelIds).forEach((id) => {
      if (protectedLabelIds.has(id)) {
        selectedNewLabelIds.delete(id);
      }
    });
    Array.from(searchLabelIds).forEach((id) => {
      if (protectedLabelIds.has(id)) {
        searchLabelIds.delete(id);
      }
    });
  }

  labels.forEach((label) => {
    if (hideProtected && protectedLabelIds.has(label.id)) {
      return;
    }
    allLabelsBox.append(buildManageLabelRow(label));
    quickLabelsBox.append(buildChip(label, selectedNewLabelIds.has(label.id), "new-note"));
    searchLabelsBox.append(buildChip(label, searchLabelIds.has(label.id), "search"));
  });
}

function buildManageLabelRow(label) {
  const row = document.createElement("div");
  row.className = `label-row ${protectedLabelIds.has(label.id) ? "protected" : ""}`.trim();

  const left = document.createElement("div");
  left.className = "label-name";
  left.textContent = `#${label.name}`;

  const right = document.createElement("div");
  right.className = "row gap label-actions";

  if (protectedLabelIds.has(label.id)) {
    const pill = document.createElement("span");
    pill.className = "protected-pill";
    pill.textContent = "protetta";
    right.append(pill);
  }

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "btn ghost label-action-btn";
  toggleBtn.textContent = protectedLabelIds.has(label.id) ? "Rimuovi protezione" : "Proteggi";
  toggleBtn.addEventListener("click", async () => {
    if (protectedLabelIds.has(label.id)) {
      protectedLabelIds.delete(label.id);
      await persistProtectedLabels();
      renderLabels();
      return;
    }

    const passphrase = await ensureSessionPassphrase("Per etichette protette imposta/usa una passphrase:");
    if (!passphrase) {
      statusPill.textContent = "Protezione annullata: passphrase mancante";
      return;
    }

    protectedLabelIds.add(label.id);
    await persistProtectedLabels();
    renderLabels();
    statusPill.textContent = `Etichetta #${label.name} protetta`;
  });

  const encryptExistingBtn = document.createElement("button");
  encryptExistingBtn.type = "button";
  encryptExistingBtn.className = "btn ghost label-action-btn";
  encryptExistingBtn.textContent = "Cifra esistenti";
  encryptExistingBtn.disabled = !protectedLabelIds.has(label.id);
  encryptExistingBtn.addEventListener("click", () => encryptExistingNotesForLabel(label));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn danger label-action-btn";
  deleteBtn.textContent = "Elimina";
  deleteBtn.addEventListener("click", () => deleteLabel(label));

  right.append(encryptExistingBtn);
  right.append(toggleBtn);
  right.append(deleteBtn);
  row.append(left, right);
  return row;
}

async function deleteLabel(label) {
  const confirmed = window.confirm(`Eliminare etichetta #${label.name}? Sara rimossa da tutte le note.`);
  if (!confirmed) {
    return;
  }

  labels = labels.filter((entry) => entry.id !== label.id);
  selectedNewLabelIds.delete(label.id);
  searchLabelIds.delete(label.id);
  protectedLabelIds.delete(label.id);

  const changedNotes = [];
  notes = notes.map((note) => {
    const noteLabelIds = note.labelIds || [];
    if (!noteLabelIds.includes(label.id)) {
      return note;
    }
    const updated = {
      ...note,
      labelIds: noteLabelIds.filter((id) => id !== label.id),
      updatedAt: Date.now(),
    };
    changedNotes.push(updated);
    return updated;
  });

  await idbDelete(IDB.stores.labels, label.id);
  if (changedNotes.length > 0) {
    await idbBulkPut(IDB.stores.notes, changedNotes);
  }
  await persistProtectedLabels();

  renderLabels();
  resetPaginationAndRender();
  statusPill.textContent = `Etichetta #${label.name} eliminata`;
}

async function encryptExistingNotesForLabel(label) {
  const targets = notes.filter((note) => !note.encrypted && (note.labelIds || []).includes(label.id));
  if (targets.length === 0) {
    statusPill.textContent = `Nessuna nota in chiaro da cifrare per #${label.name}`;
    return;
  }

  const passphrase = await ensureSessionPassphrase(`Inserisci passphrase per cifrare le note esistenti di #${label.name}:`);
  if (!passphrase) {
    statusPill.textContent = "Cifratura batch annullata: passphrase mancante";
    return;
  }

  const BATCH_SIZE = 25;
  let processed = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const updatedBatch = [];

    for (const note of batch) {
      let encryptedPayload;
      try {
        encryptedPayload = await encryptText(note.text || "", passphrase);
      } catch {
        statusPill.textContent = "Errore cifratura batch: verifica browser/contesto";
        return;
      }
      const updatedNote = {
        ...note,
        encrypted: true,
        text: "",
        cipherText: encryptedPayload.cipherText,
        iv: encryptedPayload.iv,
        salt: encryptedPayload.salt,
        updatedAt: Date.now(),
      };
      updatedBatch.push(updatedNote);

      if (sessionPassphrase && sessionPassphrase === passphrase) {
        const plain = note.text || "";
        decryptedNoteTextIndex.set(updatedNote.id, plain);
        decryptedSearchIndex.set(updatedNote.id, plain.toLowerCase());
      } else {
        decryptedNoteTextIndex.delete(updatedNote.id);
        decryptedSearchIndex.delete(updatedNote.id);
      }
    }

    const updatesById = new Map(updatedBatch.map((n) => [n.id, n]));
    notes = notes.map((n) => updatesById.get(n.id) || n);
    await idbBulkPut(IDB.stores.notes, updatedBatch);

    processed += updatedBatch.length;
    statusPill.textContent = `Cifratura #${label.name}: ${processed}/${targets.length}`;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  renderEncryptedSearchMeta();
  renderNotes();
  statusPill.textContent = `Cifratura completata per #${label.name}: ${processed} note`;
}

function buildChip(label, active, mode) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `chip ${active ? "active" : ""}`.trim();
  chip.textContent = `#${label.name}`;

  chip.addEventListener("click", () => {
    if (mode === "new-note") {
      toggleSetValue(selectedNewLabelIds, label.id);
      renderLabels();
      return;
    }

    if (mode === "search") {
      toggleSetValue(searchLabelIds, label.id);
      renderLabels();
      resetPaginationAndRender();
    }
  });

  return chip;
}

function toggleSetValue(setRef, value) {
  if (setRef.has(value)) {
    setRef.delete(value);
  } else {
    setRef.add(value);
  }
}

function resetPaginationAndRender() {
  visibleCount = PAGE_SIZE;
  renderNotes();
}

function noteHasProtectedLabel(note) {
  return (note.labelIds || []).some((id) => protectedLabelIds.has(id));
}

function shouldHideProtectedItems() {
  return !sessionPassphrase && Boolean(hideEncryptedNotesCheckbox?.checked);
}

function getFilteredNotes() {
  const textQuery = searchInput.value.trim().toLowerCase();
  const dateFrom = dateFromInput.value ? new Date(`${dateFromInput.value}T00:00:00`).getTime() : null;
  const dateTo = dateToInput.value ? new Date(`${dateToInput.value}T23:59:59`).getTime() : null;
  const hideProtected = shouldHideProtectedItems();

  return getActiveNotes()
    .filter((note) => {
      if (hideProtected && (note.encrypted || noteHasProtectedLabel(note))) {
        return false;
      }

      const plainText = (note.text || "").toLowerCase();
      const decryptedText = decryptedSearchIndex.get(note.id) || "";
      const textMatch = !textQuery || (!note.encrypted && plainText.includes(textQuery)) || (note.encrypted && Boolean(sessionPassphrase) && decryptedText.includes(textQuery));
      if (!textMatch) {
        return false;
      }

      const createdAt = Number.isFinite(note.createdAt) ? note.createdAt : 0;
      if (dateFrom !== null && createdAt < dateFrom) {
        return false;
      }
      if (dateTo !== null && createdAt > dateTo) {
        return false;
      }

      if (searchLabelIds.size > 0) {
        const noteLabels = note.labelIds || [];
        const labelsMatch = Array.from(searchLabelIds).every((id) => noteLabels.includes(id));
        if (!labelsMatch) {
          return false;
        }
      }

      return true;
    })
    .sort(compareNotes);
}

function renderNotes() {
  renderToken += 1;
  const token = renderToken;

  if (renderObserver) {
    renderObserver.disconnect();
    renderObserver = null;
  }

  notesList.innerHTML = "";
  renderTrash();

  const filtered = getFilteredNotes();
  currentResults = filtered.slice(0, visibleCount);
  renderedResultsCount = 0;

  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "Nessun appunto trovato.";
    notesList.append(empty);
    loadMoreBtn.classList.add("hidden");
    return;
  }

  if (currentResults.length < filtered.length) {
    loadMoreBtn.classList.remove("hidden");
  } else {
    loadMoreBtn.classList.add("hidden");
  }

  appendNextBatch(token);
}

function appendNextBatch(token) {
  if (token !== renderToken) {
    return;
  }

  const nextEnd = Math.min(renderedResultsCount + RENDER_BATCH_SIZE, currentResults.length);
  const fragment = document.createDocumentFragment();

  for (let i = renderedResultsCount; i < nextEnd; i += 1) {
    fragment.append(renderNoteItem(currentResults[i]));
  }

  notesList.append(fragment);
  renderedResultsCount = nextEnd;

  if (renderedResultsCount < currentResults.length) {
    setupBatchSentinel(token);
  }
}

function setupBatchSentinel(token) {
  const sentinel = document.createElement("li");
  sentinel.className = "loading-item";
  sentinel.textContent = "Caricamento...";
  notesList.append(sentinel);

  renderObserver = new IntersectionObserver(
    (entries) => {
      if (token !== renderToken) {
        return;
      }

      const visible = entries.some((entry) => entry.isIntersecting);
      if (!visible) {
        return;
      }

      renderObserver.disconnect();
      renderObserver = null;
      sentinel.remove();
      requestAnimationFrame(() => appendNextBatch(token));
    },
    { root: null, rootMargin: "220px", threshold: 0.01 }
  );

  renderObserver.observe(sentinel);
}

function getTrashPreview(note) {
  if (note.encrypted) {
    if (sessionPassphrase && decryptedNoteTextIndex.has(note.id)) {
      return decryptedNoteTextIndex.get(note.id) || "";
    }
    return "[Nota cifrata]";
  }
  return note.text || "";
}

function cutText(value, maxLength = 90) {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function renderTrash() {
  if (!trashList || !trashMeta || !toggleTrashBtn || !emptyTrashBtn) {
    return;
  }

  const trashed = getTrashNotes();
  const count = trashed.length;
  toggleTrashBtn.textContent = trashOpen ? "Nascondi cestino" : "Mostra cestino";
  emptyTrashBtn.disabled = count === 0;
  trashMeta.textContent = count === 0 ? "Cestino vuoto." : `Nel cestino: ${count} note.`;

  trashList.classList.toggle("hidden", !trashOpen);
  trashList.innerHTML = "";
  if (!trashOpen) {
    return;
  }

  if (count === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Nessuna nota cestinata.";
    trashList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  trashed.forEach((note) => {
    const row = document.createElement("div");
    row.className = "trash-row";

    const info = document.createElement("div");
    const when = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(note.trashedAt || Date.now()));
    const labelsText = getNoteLabelNames(note).join(" ");
    const title = document.createElement("strong");
    title.textContent = cutText(getTrashPreview(note)) || "(vuota)";
    const subtitle = document.createElement("span");
    subtitle.className = "hint";
    subtitle.textContent = `Cestinata: ${when}${labelsText ? ` - ${labelsText}` : ""}`;
    info.append(title, document.createElement("br"), subtitle);

    const actions = document.createElement("div");
    actions.className = "row gap";

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn ghost";
    restoreBtn.textContent = "Ripristina";
    restoreBtn.addEventListener("click", () => restoreNoteFromTrash(note.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn danger";
    deleteBtn.textContent = "Elimina";
    deleteBtn.addEventListener("click", () => deleteNotePermanently(note.id));

    actions.append(restoreBtn, deleteBtn);
    row.append(info, actions);
    fragment.append(row);
  });

  trashList.append(fragment);
}

async function moveNoteToTrash(note) {
  if (note.encrypted) {
    if (!sessionPassphrase) {
      statusPill.textContent = "Per cestinare note cifrate devi prima aprire la sessione Password";
      return;
    }
    if (!decryptedNoteTextIndex.has(note.id)) {
      try {
        const plain = await decryptText(note, sessionPassphrase);
        decryptedNoteTextIndex.set(note.id, plain);
        decryptedSearchIndex.set(note.id, plain.toLowerCase());
      } catch {
        statusPill.textContent = "Passphrase sessione non valida per questa nota cifrata";
        return;
      }
    }
  }

  const updatedNote = {
    ...note,
    pinned: false,
    trashedAt: Date.now(),
    updatedAt: Date.now(),
  };

  notes = notes.map((entry) => (entry.id === note.id ? updatedNote : entry));
  await idbPut(IDB.stores.notes, updatedNote);
  decryptedSearchIndex.delete(note.id);
  decryptedNoteTextIndex.delete(note.id);
  statusPill.textContent = "Nota spostata nel cestino";
  renderNotes();
}

async function restoreNoteFromTrash(noteId) {
  const note = notes.find((entry) => entry.id === noteId);
  if (!note) {
    return;
  }

  const restored = {
    ...note,
    trashedAt: null,
    updatedAt: Date.now(),
  };
  notes = notes.map((entry) => (entry.id === noteId ? restored : entry));
  await idbPut(IDB.stores.notes, restored);

  if (restored.encrypted && sessionPassphrase) {
    try {
      const plain = await decryptText(restored, sessionPassphrase);
      decryptedNoteTextIndex.set(restored.id, plain);
      decryptedSearchIndex.set(restored.id, plain.toLowerCase());
    } catch {
      decryptedNoteTextIndex.delete(restored.id);
      decryptedSearchIndex.delete(restored.id);
    }
  }

  statusPill.textContent = "Nota ripristinata";
  renderNotes();
}

async function deleteNotePermanently(noteId) {
  notes = notes.filter((entry) => entry.id !== noteId);
  await idbDelete(IDB.stores.notes, noteId);
  decryptedSearchIndex.delete(noteId);
  decryptedNoteTextIndex.delete(noteId);
  statusPill.textContent = "Nota eliminata definitivamente";
  renderNotes();
}

async function emptyTrash() {
  const trashed = getTrashNotes();
  if (trashed.length === 0) {
    statusPill.textContent = "Cestino gia vuoto";
    return;
  }

  const confirmed = window.confirm(`Eliminare definitivamente ${trashed.length} note dal cestino?`);
  if (!confirmed) {
    return;
  }

  for (const note of trashed) {
    await idbDelete(IDB.stores.notes, note.id);
    decryptedSearchIndex.delete(note.id);
    decryptedNoteTextIndex.delete(note.id);
  }
  const trashedIds = new Set(trashed.map((n) => n.id));
  notes = notes.filter((entry) => !trashedIds.has(entry.id));

  statusPill.textContent = "Cestino svuotato";
  renderNotes();
}

function renderNoteItem(note) {
  const fragment = noteTemplate.content.cloneNode(true);
  const item = fragment.querySelector(".note-item");
  const noteText = fragment.querySelector(".note-text");
  const noteMeta = fragment.querySelector(".note-meta");
  const noteLabelsBox = fragment.querySelector(".note-labels");
  const pinBtn = fragment.querySelector(".pin-btn");
  const editBtn = fragment.querySelector(".edit-btn");
  const deleteBtn = fragment.querySelector(".delete-btn");

  if (note.encrypted && sessionPassphrase && decryptedNoteTextIndex.has(note.id)) {
    noteText.textContent = decryptedNoteTextIndex.get(note.id) || "";
  } else if (note.encrypted) {
    noteText.textContent = "Nota criptata. Apri la sessione con Password per vedere il testo.";
  } else {
    noteText.textContent = note.text;
  }

  noteMeta.textContent = buildMetaText(note);
  if (isPinned(note)) {
    const pinnedBadge = document.createElement("span");
    pinnedBadge.className = "protected-pill";
    pinnedBadge.textContent = "in evidenza";
    noteLabelsBox.append(pinnedBadge);
  }

  const hideProtected = shouldHideProtectedItems();
  (note.labelIds || [])
    .map((labelId) => labels.find((entry) => entry.id === labelId))
    .filter(Boolean)
    .forEach((label) => {
      if (hideProtected && protectedLabelIds.has(label.id)) {
        return;
      }
      const badge = document.createElement("span");
      badge.className = "tag";
      badge.textContent = `#${label.name}`;
      noteLabelsBox.append(badge);
    });

  if (note.encrypted) {
    const badge = document.createElement("span");
    badge.className = "protected-pill";
    badge.textContent = "criptata";
    noteLabelsBox.append(badge);

    if (sessionPassphrase && decryptedNoteTextIndex.has(note.id)) {
      editBtn.textContent = "Modifica";
      editBtn.addEventListener("click", () => enterEditMode(item, { ...note, text: decryptedNoteTextIndex.get(note.id) || "" }));
    } else {
      editBtn.textContent = "Bloccata";
      editBtn.disabled = true;
    }
  } else {
    editBtn.textContent = "Modifica";
    editBtn.addEventListener("click", () => enterEditMode(item, note));
  }

  pinBtn.textContent = isPinned(note) ? "Unpin" : "Pin";
  pinBtn.addEventListener("click", async () => {
    const updatedNote = {
      ...note,
      pinned: !isPinned(note),
      updatedAt: Date.now(),
    };
    notes = notes.map((entry) => (entry.id === note.id ? updatedNote : entry));
    await idbPut(IDB.stores.notes, updatedNote);
    renderNotes();
  });

  deleteBtn.addEventListener("click", async () => {
    await moveNoteToTrash(note);
  });

  return fragment;
}

function enterEditMode(item, note) {
  item.innerHTML = "";

  const editor = document.createElement("div");
  editor.className = "edit-box";

  const textarea = document.createElement("textarea");
  textarea.className = "textarea";
  textarea.value = note.text || "";

  const selector = document.createElement("div");
  selector.className = "row wrap gap";
  const selected = new Set(note.labelIds || []);

  labels.forEach((label) => {
    const chip = buildChip(label, selected.has(label.id), "view");
    chip.addEventListener("click", () => {
      toggleSetValue(selected, label.id);
      chip.classList.toggle("active", selected.has(label.id));
    });
    selector.append(chip);
  });

  const actions = document.createElement("div");
  actions.className = "row gap";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary";
  saveBtn.textContent = "Salva";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn ghost";
  cancelBtn.textContent = "Annulla";

  saveBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text) {
      return;
    }

    const newLabelIds = Array.from(selected);
    const mustEncrypt = newLabelIds.some((id) => protectedLabelIds.has(id));

    let updatedNote = {
      ...note,
      labelIds: newLabelIds,
      updatedAt: Date.now(),
      encrypted: false,
      text,
      cipherText: undefined,
      iv: undefined,
      salt: undefined,
    };

    if (mustEncrypt) {
      const passphrase = await ensureSessionPassphrase("Per salvare questa nota protetta serve passphrase:");
      if (!passphrase) {
        statusPill.textContent = "Salvataggio annullato: passphrase mancante";
        return;
      }

      let encryptedPayload;
      try {
        encryptedPayload = await encryptText(text, passphrase);
      } catch {
        statusPill.textContent = "Errore cifratura: verifica browser/contesto e passphrase";
        return;
      }
      updatedNote = {
        ...updatedNote,
        text: "",
        encrypted: true,
        cipherText: encryptedPayload.cipherText,
        iv: encryptedPayload.iv,
        salt: encryptedPayload.salt,
      };
    }

    notes = notes.map((entry) => (entry.id === note.id ? updatedNote : entry));
    await idbPut(IDB.stores.notes, updatedNote);

    if (updatedNote.encrypted) {
      if (sessionPassphrase) {
        decryptedNoteTextIndex.set(updatedNote.id, text);
        decryptedSearchIndex.set(updatedNote.id, text.toLowerCase());
      } else {
        decryptedNoteTextIndex.delete(updatedNote.id);
        decryptedSearchIndex.delete(updatedNote.id);
      }
    } else {
      decryptedNoteTextIndex.delete(updatedNote.id);
      decryptedSearchIndex.delete(updatedNote.id);
    }

    renderNotes();
  });

  cancelBtn.addEventListener("click", renderNotes);

  actions.append(saveBtn, cancelBtn);
  editor.append(textarea, selector, actions);
  item.append(editor);
}

function buildMetaText(note) {
  const created = new Date(note.createdAt || Date.now());
  const createdStamp = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(created);

  if (!note.updatedAt || note.updatedAt === note.createdAt) {
    return `Inserito: ${createdStamp}`;
  }

  const updatedStamp = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(note.updatedAt));
  return `Inserito: ${createdStamp} - Modificato: ${updatedStamp}`;
}

function getNoteExportText(note) {
  if (note.encrypted) {
    if (sessionPassphrase && decryptedNoteTextIndex.has(note.id)) {
      return decryptedNoteTextIndex.get(note.id) || "";
    }
    return "[NOTA CIFRATA - apri la sessione Password per esportare il testo]";
  }
  return note.text || "";
}

function getNotesForExport(options = {}) {
  const { filtered = false } = options;
  if (filtered) {
    return getFilteredNotes();
  }
  return [...getActiveNotes()].sort(compareNotes);
}

function getNoteLabelNames(note) {
  return (note.labelIds || [])
    .map((labelId) => labels.find((entry) => entry.id === labelId))
    .filter(Boolean)
    .map((label) => `#${label.name}`);
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportNotesAsText(format, options = {}) {
  const { filtered = false } = options;
  const sorted = getNotesForExport({ filtered });
  const exportedAt = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date());
  const encryptedLockedCount = sorted.filter((note) => note.encrypted && !(sessionPassphrase && decryptedNoteTextIndex.has(note.id))).length;
  const extension = format === "md" ? "md" : "txt";
  const filename = filtered ? `appunti-filtrati.${extension}` : `appunti-export.${extension}`;

  if (format === "md") {
    const lines = ["# Appunti", "", `Esportato: ${exportedAt}`, ""];
    sorted.forEach((note, index) => {
      const labelsText = getNoteLabelNames(note).join(" ");
      const createdStamp = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(note.createdAt || Date.now()));
      const title = `## ${index + 1}. ${isPinned(note) ? "[PIN] " : ""}${note.encrypted ? "[CIFRATA]" : ""}`.trim();
      lines.push(title);
      lines.push(`- Inserito: ${createdStamp}`);
      lines.push(`- Etichette: ${labelsText || "-"}`);
      lines.push("");
      lines.push("```");
      lines.push(getNoteExportText(note));
      lines.push("```");
      lines.push("");
    });
    downloadTextFile(lines.join("\n"), filename, "text/markdown;charset=utf-8");
  } else {
    const lines = ["APPUNTI", `Esportato: ${exportedAt}`, ""];
    sorted.forEach((note, index) => {
      const labelsText = getNoteLabelNames(note).join(" ");
      const createdStamp = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(note.createdAt || Date.now()));
      lines.push(`----- NOTA ${index + 1} ${isPinned(note) ? "[PIN]" : ""} ${note.encrypted ? "[CIFRATA]" : ""}`.trim());
      lines.push(`Inserito: ${createdStamp}`);
      lines.push(`Etichette: ${labelsText || "-"}`);
      lines.push(getNoteExportText(note));
      lines.push("");
    });
    downloadTextFile(lines.join("\n"), filename, "text/plain;charset=utf-8");
  }

  if (encryptedLockedCount > 0) {
    statusPill.textContent = `Export ${extension.toUpperCase()} ${filtered ? "filtrato " : ""}completato (${encryptedLockedCount} note cifrate senza testo)`;
  } else {
    statusPill.textContent = `Export ${extension.toUpperCase()} ${filtered ? "filtrato " : ""}completato`;
  }
}

function exportFilteredJson() {
  const filteredNotes = getNotesForExport({ filtered: true });
  const payload = {
    version: 1,
    filtered: true,
    exportedAt: Date.now(),
    filters: getActiveFilterSnapshot(),
    labels,
    notes: filteredNotes,
  };

  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "appunti-filtrati.json";
  a.click();
  URL.revokeObjectURL(url);
  statusPill.textContent = `Export filtrato JSON completato (${filteredNotes.length} note)`;
}

async function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: Date.now(),
    labels,
    notes,
    protectedLabelIds: Array.from(protectedLabelIds),
  };
  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "appunti-backup.json";
  a.click();
  URL.revokeObjectURL(url);

  lastBackupAt = Date.now();
  await idbPut(IDB.stores.meta, { key: KEYS.lastBackupAt, value: lastBackupAt });
  lastIncrementalExportAt = lastBackupAt;
  await idbPut(IDB.stores.meta, { key: KEYS.lastIncrementalExportAt, value: lastIncrementalExportAt });
  renderBackupMeta();
}

async function importBackupFromFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    mergeBackup(parsed);
    await rewriteCollections();
    if (sessionPassphrase) {
      const refresh = await applySessionPassphrase(sessionPassphrase);
      if (!refresh.ok) {
        clearSessionPassphrase();
      }
    }
    renderLabels();
    resetPaginationAndRender();
    statusPill.textContent = "Backup importato correttamente";
  } catch {
    statusPill.textContent = "Errore: file backup non valido";
  } finally {
    importBackupFile.value = "";
  }
}

function mergeBackup(data) {
  const incomingLabels = Array.isArray(data?.labels) ? data.labels : [];
  const incomingNotes = Array.isArray(data?.notes) ? data.notes : [];

  const labelsByName = new Map(labels.map((label) => [label.name.toLowerCase(), label]));
  const idMap = new Map();

  incomingLabels.forEach((label) => {
    const rawName = typeof label?.name === "string" ? label.name.trim().toLowerCase() : "";
    if (!rawName) {
      return;
    }

    const existing = labelsByName.get(rawName);
    if (existing) {
      if (label.id) {
        idMap.set(label.id, existing.id);
      }
      return;
    }

    const newLabel = {
      id: typeof label.id === "string" && label.id ? label.id : generateId(),
      name: rawName,
      createdAt: Number.isFinite(label.createdAt) ? label.createdAt : Date.now(),
    };

    labels.push(newLabel);
    labelsByName.set(rawName, newLabel);
    if (label.id) {
      idMap.set(label.id, newLabel.id);
    }
  });

  labels.sort((a, b) => a.name.localeCompare(b.name, "it"));

  if (Array.isArray(data?.protectedLabelIds)) {
    data.protectedLabelIds.forEach((oldId) => {
      const mapped = idMap.get(oldId) || oldId;
      if (labels.some((l) => l.id === mapped)) {
        protectedLabelIds.add(mapped);
      }
    });
  }

  const notesById = new Map(notes.map((note) => [note.id, note]));

  incomingNotes.forEach((note) => {
    let incomingNote = null;

    if (note?.encrypted === true) {
      if (!(typeof note.cipherText === "string" && typeof note.iv === "string" && typeof note.salt === "string")) {
        return;
      }

      const mappedLabelIdsEncrypted = Array.isArray(note.labelIds)
        ? note.labelIds.map((id) => idMap.get(id) || id).filter((id) => labels.some((label) => label.id === id))
        : [];

      incomingNote = {
        id: typeof note.id === "string" && note.id ? note.id : generateId(),
        text: "",
        encrypted: true,
        pinned: note.pinned === true,
        trashedAt: Number.isFinite(note.trashedAt) ? note.trashedAt : null,
        cipherText: note.cipherText,
        iv: note.iv,
        salt: note.salt,
        labelIds: mappedLabelIdsEncrypted,
        createdAt: Number.isFinite(note.createdAt) ? note.createdAt : Date.now(),
        updatedAt: Number.isFinite(note.updatedAt) ? note.updatedAt : Number.isFinite(note.createdAt) ? note.createdAt : Date.now(),
      };
    } else {
      if (typeof note?.text !== "string") {
        return;
      }

      const normalizedText = note.text.trim();
      if (!normalizedText) {
        return;
      }

      const mappedLabelIds = Array.isArray(note.labelIds)
        ? note.labelIds.map((id) => idMap.get(id) || id).filter((id) => labels.some((label) => label.id === id))
        : [];

      incomingNote = {
        id: typeof note.id === "string" && note.id ? note.id : generateId(),
        text: normalizedText,
        encrypted: false,
        pinned: note.pinned === true,
        trashedAt: Number.isFinite(note.trashedAt) ? note.trashedAt : null,
        labelIds: mappedLabelIds,
        createdAt: Number.isFinite(note.createdAt) ? note.createdAt : Date.now(),
        updatedAt: Number.isFinite(note.updatedAt) ? note.updatedAt : Number.isFinite(note.createdAt) ? note.createdAt : Date.now(),
      };
    }

    const existing = notesById.get(incomingNote.id);
    if (!existing) {
      notes.push(incomingNote);
      notesById.set(incomingNote.id, incomingNote);
      return;
    }

    if ((incomingNote.updatedAt || 0) > (existing.updatedAt || 0)) {
      const idx = notes.findIndex((entry) => entry.id === existing.id);
      if (idx >= 0) {
        notes[idx] = incomingNote;
        notesById.set(incomingNote.id, incomingNote);
      }
    }
  });

  notes.sort(compareNotes);
}

async function rewriteCollections() {
  await idbClear(IDB.stores.labels);
  await idbBulkPut(IDB.stores.labels, labels);
  await idbClear(IDB.stores.notes);
  await idbBulkPut(IDB.stores.notes, notes);
  await persistProtectedLabels();
}

function renderBackupMeta() {
  if (!backupMeta || !backupWarning) {
    return;
  }
  if (!Number.isFinite(lastBackupAt) || lastBackupAt <= 0) {
    backupMeta.textContent = "Nessun backup registrato. Consigliato backup almeno 1 volta al giorno.";
    backupWarning.classList.add("hidden");
    backupWarning.textContent = "";
  } else {
    const stamp = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(lastBackupAt));
    backupMeta.textContent = `Ultimo backup esportato: ${stamp}.`;

    const elapsedDays = Math.floor((Date.now() - lastBackupAt) / (1000 * 60 * 60 * 24));
    if (elapsedDays >= 1) {
      backupWarning.textContent = `Backup non aggiornato da ${elapsedDays} giorno/i. Consigliato esportare ora.`;
      backupWarning.classList.remove("hidden");
    } else {
      backupWarning.classList.add("hidden");
      backupWarning.textContent = "";
    }
  }

  if (backupIncrementalMeta) {
    if (!Number.isFinite(lastIncrementalExportAt) || lastIncrementalExportAt <= 0) {
      backupIncrementalMeta.textContent = "Incrementale: mai eseguito.";
    } else {
      const incrementalStamp = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(lastIncrementalExportAt));
      backupIncrementalMeta.textContent = `Incrementale: ultimo export ${incrementalStamp}.`;
    }
  }

  
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js");
    } catch {
    }
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB.name, IDB.version);

    req.onupgradeneeded = () => {
      const upgradeDb = req.result;
      if (!upgradeDb.objectStoreNames.contains(IDB.stores.notes)) {
        upgradeDb.createObjectStore(IDB.stores.notes, { keyPath: "id" });
      }
      if (!upgradeDb.objectStoreNames.contains(IDB.stores.labels)) {
        upgradeDb.createObjectStore(IDB.stores.labels, { keyPath: "id" });
      }
      if (!upgradeDb.objectStoreNames.contains(IDB.stores.meta)) {
        upgradeDb.createObjectStore(IDB.stores.meta, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbBulkPut(storeName, list) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    list.forEach((item) => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function persistProtectedLabels() {
  await idbPut(IDB.stores.meta, {
    key: "protected_label_ids",
    value: Array.from(protectedLabelIds),
  });
}

async function migrateFromLocalStorageIfNeeded() {
  const marker = await idbGet(IDB.stores.meta, "migrated_localstorage_v1");
  if (marker?.value === true) {
    return;
  }

  const legacyLabels = readJsonFromLocalStorage(KEYS.labels, []);
  const legacyNotes = readJsonFromLocalStorage(KEYS.notes, []);
  const legacyLastBackup = Number(localStorage.getItem(KEYS.lastBackupAt));

  if (legacyLabels.length > 0) {
    await idbBulkPut(IDB.stores.labels, legacyLabels);
  }
  if (legacyNotes.length > 0) {
    await idbBulkPut(IDB.stores.notes, legacyNotes);
  }
  if (Number.isFinite(legacyLastBackup) && legacyLastBackup > 0) {
    await idbPut(IDB.stores.meta, { key: KEYS.lastBackupAt, value: legacyLastBackup });
  }

  await idbPut(IDB.stores.meta, { key: "migrated_localstorage_v1", value: true });
}

function readJsonFromLocalStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function generateId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const rnd = Math.random().toString(16).slice(2);
  return `id_${Date.now()}_${rnd}`;
}

function hasEncryptionSupport() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
}

async function ensureSessionPassphrase(message, forcePrompt = false) {
  if (sessionPassphrase && !forcePrompt) {
    return sessionPassphrase;
  }

  const typed = window.prompt(message);
  if (!typed) {
    return null;
  }

  const result = await applySessionPassphrase(typed);
  if (!result.ok) {
    statusPill.textContent = "Passphrase errata o incompatibile con le note cifrate";
    return null;
  }
  return sessionPassphrase;
}

async function encryptText(plainText, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plainText)
  );

  return {
    cipherText: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

async function decryptText(note, passphrase) {
  const iv = base64ToBytes(note.iv);
  const salt = base64ToBytes(note.salt);
  const data = base64ToBytes(note.cipherText);
  const key = await deriveAesKey(passphrase, salt);

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function deriveAesKey(passphrase, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 150000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const segment = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...segment);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}









