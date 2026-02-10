const KEYS = {
  labels: "notes_labels",
  notes: "notes_items",
  lastBackupAt: "notes_last_backup_at",
  lastIncrementalExportAt: "notes_last_incremental_export_at",
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

const statusPill = document.getElementById("status-pill");
const backupMeta = document.getElementById("backup-meta");
const backupWarning = document.getElementById("backup-warning");
const backupGuideBtn = document.getElementById("backup-guide-btn");
const backupGuideBox = document.getElementById("backup-guide");
const exportBackupBtn = document.getElementById("export-backup-btn");
const exportIncrementalBtn = document.getElementById("export-incremental-btn");
const backupIncrementalMeta = document.getElementById("backup-incremental-meta");
const importBackupBtn = document.getElementById("import-backup-btn");
const importBackupFile = document.getElementById("import-backup-file");

const menuToggle = document.getElementById("menu-toggle");
const menuClose = document.getElementById("menu-close");
const sideMenu = document.getElementById("side-menu");
const menuOverlay = document.getElementById("menu-overlay");

const searchInput = document.getElementById("search-input");
const dateFromInput = document.getElementById("date-from");
const dateToInput = document.getElementById("date-to");
const unlockSearchBtn = document.getElementById("unlock-search-btn");
const lockSearchBtn = document.getElementById("lock-search-btn");
const encryptedVisibilityWrap = document.getElementById("encrypted-visibility-wrap");
const hideEncryptedNotesCheckbox = document.getElementById("hide-encrypted-notes");
const encryptedSearchMeta = document.getElementById("encrypted-search-meta");
const searchLabelsBox = document.getElementById("search-labels");
const clearFiltersBtn = document.getElementById("clear-filters");

const noteInput = document.getElementById("note-input");
const addNoteBtn = document.getElementById("add-note-btn");
const labelInput = document.getElementById("label-input");
const addLabelBtn = document.getElementById("add-label-btn");
const setPassphraseBtn = document.getElementById("set-passphrase-btn");
const clearPassphraseBtn = document.getElementById("clear-passphrase-btn");
const allLabelsBox = document.getElementById("all-labels");
const quickLabelsBox = document.getElementById("quick-labels");
const notesList = document.getElementById("notes-list");
const loadMoreBtn = document.getElementById("load-more-btn");
const noteTemplate = document.getElementById("note-template");

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
let encryptedSearchEnabled = false;
const decryptedSearchIndex = new Map();

const selectedNewLabelIds = new Set();
const searchLabelIds = new Set();
const protectedLabelIds = new Set();

initApp();

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

    labels.sort((a, b) => a.name.localeCompare(b.name, "it"));
    notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    bindEvents();
    renderBackupMeta();
    renderEncryptedSearchMeta();
    updateEncryptionVisibilityControl();
    renderLabels();
    renderNotes();
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

  on(setPassphraseBtn, "click", () => {
    const typed = window.prompt("Imposta passphrase per note protette:");
    if (!typed) {
      return;
    }
    sessionPassphrase = typed;
    statusPill.textContent = "Passphrase sessione impostata";
    updateEncryptionVisibilityControl();
  });

  on(clearPassphraseBtn, "click", () => {
    sessionPassphrase = null;
    lockEncryptedSearch();
    statusPill.textContent = "Sessione bloccata: passphrase rimossa";
    updateEncryptionVisibilityControl();
  });

  on(searchInput, "input", debounceFilterRender);
  on(dateFromInput, "change", resetPaginationAndRender);
  on(dateToInput, "change", resetPaginationAndRender);
  on(unlockSearchBtn, "click", unlockEncryptedSearch);
  on(lockSearchBtn, "click", lockEncryptedSearch);
  on(hideEncryptedNotesCheckbox, "change", resetPaginationAndRender);

  on(clearFiltersBtn, "click", () => {
    searchInput.value = "";
    dateFromInput.value = "";
    dateToInput.value = "";
    searchLabelIds.clear();
    renderLabels();
    resetPaginationAndRender();
  });

  on(loadMoreBtn, "click", () => {
    visibleCount += PAGE_SIZE;
    renderNotes();
  });

  on(backupGuideBtn, "click", runGuidedBackup);
  on(exportBackupBtn, "click", exportBackup);
  on(exportIncrementalBtn, "click", exportIncrementalBackup);
  on(importBackupBtn, "click", () => importBackupFile.click());
  on(importBackupFile, "change", importBackupFromFile);
}

async function runGuidedBackup() {
  if (backupGuideBox) {
    backupGuideBox.classList.remove("hidden");
  }
  await exportBackup();
  statusPill.textContent = "Backup esportato. Ora caricalo su Drive/OneDrive.";
}


async function unlockEncryptedSearch() {
  const hasEncrypted = notes.some((n) => n.encrypted);
  if (!hasEncrypted) {
    statusPill.textContent = "Nessuna nota cifrata da indicizzare";
    return;
  }

  const passphrase = await ensureSessionPassphrase("Inserisci passphrase per cercare nelle note cifrate:", true);
  if (!passphrase) {
    statusPill.textContent = "Ricerca cifrate non attivata";
    return;
  }

  try {
    decryptedSearchIndex.clear();
    for (const note of notes) {
      if (!note.encrypted) {
        continue;
      }
      const plain = await decryptText(note, passphrase);
      decryptedSearchIndex.set(note.id, plain.toLowerCase());
    }

    encryptedSearchEnabled = true;
    renderEncryptedSearchMeta();
    resetPaginationAndRender();
    statusPill.textContent = "Ricerca note cifrate attivata (sessione)";
  } catch {
    decryptedSearchIndex.clear();
    encryptedSearchEnabled = false;
    renderEncryptedSearchMeta();
    statusPill.textContent = "Passphrase errata: ricerca cifrate non attiva";
  }
}

function lockEncryptedSearch() {
  decryptedSearchIndex.clear();
  encryptedSearchEnabled = false;
  renderEncryptedSearchMeta();
  resetPaginationAndRender();
}

function updateEncryptionVisibilityControl() {
  if (!encryptedVisibilityWrap || !hideEncryptedNotesCheckbox) {
    return;
  }

  const visible = Boolean(sessionPassphrase);
  encryptedVisibilityWrap.classList.toggle("hidden", !visible);

  if (!visible) {
    hideEncryptedNotesCheckbox.checked = false;
  }
}

function renderEncryptedSearchMeta() {
  if (!encryptedSearchMeta) {
    return;
  }
  if (encryptedSearchEnabled) {
    encryptedSearchMeta.textContent = "Ricerca cifrate: attiva (solo sessione corrente).";
  } else {
    encryptedSearchMeta.textContent = "Ricerca cifrate: disattiva.";
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

  labels.forEach((label) => {
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
  right.className = "row gap";

  if (protectedLabelIds.has(label.id)) {
    const pill = document.createElement("span");
    pill.className = "protected-pill";
    pill.textContent = "protetta";
    right.append(pill);
  }

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "btn ghost";
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
  encryptExistingBtn.className = "btn ghost";
  encryptExistingBtn.textContent = "Cifra esistenti";
  encryptExistingBtn.disabled = !protectedLabelIds.has(label.id);
  encryptExistingBtn.addEventListener("click", () => encryptExistingNotesForLabel(label));

  right.append(encryptExistingBtn);
  right.append(toggleBtn);
  row.append(left, right);
  return row;
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
    }

    const updatesById = new Map(updatedBatch.map((n) => [n.id, n]));
    notes = notes.map((n) => updatesById.get(n.id) || n);
    await idbBulkPut(IDB.stores.notes, updatedBatch);

    processed += updatedBatch.length;
    statusPill.textContent = `Cifratura #${label.name}: ${processed}/${targets.length}`;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  lockEncryptedSearch();
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

function getFilteredNotes() {
  const textQuery = searchInput.value.trim().toLowerCase();
  const dateFrom = dateFromInput.value ? new Date(`${dateFromInput.value}T00:00:00`).getTime() : null;
  const dateTo = dateToInput.value ? new Date(`${dateToInput.value}T23:59:59`).getTime() : null;
  const hideEncrypted = Boolean(hideEncryptedNotesCheckbox?.checked);

  return notes
    .filter((note) => {
      if (hideEncrypted && note.encrypted) {
        return false;
      }

      const plainText = (note.text || "").toLowerCase();
      const decryptedText = decryptedSearchIndex.get(note.id) || "";
      const textMatch = !textQuery || (!note.encrypted && plainText.includes(textQuery)) || (note.encrypted && encryptedSearchEnabled && decryptedText.includes(textQuery));
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
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderNotes() {
  renderToken += 1;
  const token = renderToken;

  if (renderObserver) {
    renderObserver.disconnect();
    renderObserver = null;
  }

  notesList.innerHTML = "";

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

function renderNoteItem(note) {
  const fragment = noteTemplate.content.cloneNode(true);
  const item = fragment.querySelector(".note-item");
  const noteText = fragment.querySelector(".note-text");
  const noteMeta = fragment.querySelector(".note-meta");
  const noteLabelsBox = fragment.querySelector(".note-labels");
  const editBtn = fragment.querySelector(".edit-btn");
  const deleteBtn = fragment.querySelector(".delete-btn");

  if (note.encrypted) {
    noteText.textContent = "Nota criptata. Usa Sblocca per leggere/modificare.";
  } else {
    noteText.textContent = note.text;
  }

  noteMeta.textContent = buildMetaText(note);

  (note.labelIds || [])
    .map((labelId) => labels.find((entry) => entry.id === labelId))
    .filter(Boolean)
    .forEach((label) => {
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
    editBtn.textContent = "Sblocca";
    editBtn.addEventListener("click", () => unlockAndEdit(item, note));
  } else {
    editBtn.textContent = "Modifica";
    editBtn.addEventListener("click", () => enterEditMode(item, note));
  }

  deleteBtn.addEventListener("click", async () => {
    notes = notes.filter((entry) => entry.id !== note.id);
    await idbDelete(IDB.stores.notes, note.id);
    renderNotes();
  });

  return fragment;
}

async function unlockAndEdit(item, note) {
  const passphrase = await ensureSessionPassphrase("Inserisci passphrase per sbloccare la nota:");
  if (!passphrase) {
    statusPill.textContent = "Sblocco annullato";
    return;
  }

  try {
    const plain = await decryptText(note, passphrase);
    enterEditMode(item, { ...note, text: plain });
  } catch {
    statusPill.textContent = "Passphrase errata o dati non validi";
  }
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

  notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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

  sessionPassphrase = typed;
  updateEncryptionVisibilityControl();
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









