const canvas = document.getElementById("noteCanvas");
const ctx = canvas.getContext("2d");

const toolButtons = [...document.querySelectorAll(".tool-btn")];
const detailControls = [...document.querySelectorAll(".detail-control")];
const hueInput = document.getElementById("hue");
const satInput = document.getElementById("sat");
const lightInput = document.getElementById("light");
const sizeInput = document.getElementById("size");
const colorPreview = document.getElementById("colorPreview");
const colorPlane = document.getElementById("colorPlane");
const lightBar = document.getElementById("lightBar");
const textInput = document.getElementById("textInput");
const templateSelect = document.getElementById("templateSelect");
const shapeSelect = document.getElementById("shapeSelect");
const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
const backgroundType = document.getElementById("backgroundType");
const subjectSelect = document.getElementById("subjectSelect");
const subjectOther = document.getElementById("subjectOther");
const noteDate = document.getElementById("noteDate");
const noteTitle = document.getElementById("noteTitle");
const mainArea = document.getElementById("mainArea");
const topMenuToggle = document.getElementById("topMenuToggle");
const homeScreen = document.getElementById("homeScreen");
const editorScreen = document.getElementById("editorScreen");
const createNoteBtn = document.getElementById("createNoteBtn");
const goHomeBtn = document.getElementById("goHomeBtn");
const noteList = document.getElementById("noteList");
const homeStatus = document.getElementById("homeStatus");

const pageIndicator = document.getElementById("pageIndicator");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const addPageBtn = document.getElementById("addPageBtn");
const removePageBtn = document.getElementById("removePageBtn");

const savePdfBtn = document.getElementById("savePdfBtn");
const saveDataBtn = document.getElementById("saveDataBtn");
const resetNoteBtn = document.getElementById("resetNoteBtn");
const loadDataInput = document.getElementById("loadDataInput");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const clearPageBtn = document.getElementById("clearPageBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const selectedObjectInfo = document.getElementById("selectedObjectInfo");
const selectedTextEditor = document.getElementById("selectedTextEditor");
const selectedTextInput = document.getElementById("selectedTextInput");
const aiTextStatus = document.getElementById("aiTextStatus");

const PAGE_RATIO_W = 257;
const PAGE_RATIO_H = 364;
const GUTTER = 18;
const H = 1000;
const PAGE_W = Math.round((H * PAGE_RATIO_W) / PAGE_RATIO_H);
const W = PAGE_W * 2 + GUTTER;
const PAGE_H = H;
canvas.width = W;
canvas.height = H;

const HANDLE_SIZE = 12;
const DELETE_BTN_R = 12;
const ROTATE_BTN_R = 10;
const ROTATE_BTN_OFFSET = 26;

let currentTool = "mouse";
let selectedImageSrc = null;
let pageIndex = 0;
let drawing = false;
let activeStroke = null;
let selectedId = null;
let interaction = null;
let handwritingSession = null;
let handwritingTimer = null;
let handwritingWorkerPromise = null;
let selectedTextEditInProgress = false;
let currentNoteId = null;
let currentNoteCreatedAt = null;
let localSaveTimer = null;

const LOCAL_NOTE_DB_NAME = "learning-note-library";
const LOCAL_NOTE_STORE = "notes";
let localNoteDbPromise = null;

const defaultToolSettings = {
  pen: { h: 220, s: 70, l: 40, size: 4 },
  aiText: { h: 220, s: 70, l: 40, size: 4 },
  marker: { h: 55, s: 95, l: 58, size: 18 },
  line: { h: 220, s: 70, l: 40, size: 4 },
  eraser: { size: 16 },
  text: { h: 0, s: 0, l: 10, size: 34, text: "" },
  template: { h: 0, s: 75, l: 45, size: 34, template: "めあて" },
  shape: { h: 220, s: 70, l: 40, size: 4, shape: "circle" },
  image: {},
  mouse: {},
};

const toolSettings = JSON.parse(JSON.stringify(defaultToolSettings));
const undoStack = [];
const redoStack = [];

const imageCache = new Map();
const backgroundImagePaths = {
  fourLine: "./assets/alphabet-note-3-1.png",
  vertical5mm: "./assets/vertical5mm.png",
  grid5mm: "./assets/grid5mm.png",
};
const backgroundImageMap = Object.fromEntries(
  Object.entries(backgroundImagePaths).map(([key, src]) => {
    const img = new Image();
    img.src = src;
    img.onload = () => draw();
    return [key, img];
  }),
);

const state = {
  noteTitle: noteTitle.value,
  subject: subjectSelect.value,
  subjectOther: "",
  noteDate: "",
  pages: [createEmptyPage("plain")],
};

function openLocalNoteDb() {
  if (localNoteDbPromise) return localNoteDbPromise;
  localNoteDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_NOTE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_NOTE_STORE)) {
        const store = db.createObjectStore(LOCAL_NOTE_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return localNoteDbPromise;
}

async function withNoteStore(mode, operation) {
  const db = await openLocalNoteDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LOCAL_NOTE_STORE, mode);
    const request = operation(transaction.objectStore(LOCAL_NOTE_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function makeLocalNoteRecord() {
  const now = new Date().toISOString();
  return {
    id: currentNoteId || crypto.randomUUID(),
    createdAt: currentNoteCreatedAt || now,
    updatedAt: now,
    noteTitle: noteTitle.value.trim() || "ノート",
    subject: subjectSelect.value,
    subjectOther: subjectOther.value,
    noteDate: noteDate.value,
    pages: clonePages(),
    toolSettings: JSON.parse(JSON.stringify(toolSettings)),
  };
}

async function persistCurrentNote() {
  if (!currentNoteId) return;
  const record = makeLocalNoteRecord();
  await withNoteStore("readwrite", (store) => store.put(record));
  currentNoteId = record.id;
  currentNoteCreatedAt = record.createdAt;
}

function scheduleLocalSave() {
  if (!currentNoteId || editorScreen.hidden) return;
  clearTimeout(localSaveTimer);
  localSaveTimer = window.setTimeout(() => {
    persistCurrentNote().catch(() => {});
  }, 800);
}

async function getStoredNotes() {
  const notes = await withNoteStore("readonly", (store) => store.getAll());
  return notes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function formatSavedAt(value) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function renderHome() {
  homeStatus.textContent = "ノートを読み込んでいます…";
  noteList.replaceChildren();
  try {
    const notes = await getStoredNotes();
    homeStatus.textContent = `${notes.length}件のノートをこのブラウザに保存しています。`;
    if (!notes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-notes";
      empty.textContent = "まだノートがありません。新しいノートを作成してください。";
      noteList.append(empty);
      return;
    }
    notes.forEach((note) => {
      const card = document.createElement("article");
      card.className = "note-card";
      const title = document.createElement("h2");
      title.textContent = note.noteTitle || "ノート";
      const subject = document.createElement("p");
      subject.className = "note-meta";
      subject.textContent = `教科: ${note.subject === "その他" ? (note.subjectOther || "その他") : (note.subject || "未設定")}`;
      const date = document.createElement("p");
      date.className = "note-meta";
      date.textContent = `日付: ${note.noteDate || "未設定"}`;
      const saved = document.createElement("p");
      saved.className = "note-meta";
      saved.textContent = `更新: ${formatSavedAt(note.updatedAt)}`;
      const actions = document.createElement("div");
      actions.className = "note-card-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "開く";
      open.addEventListener("click", () => openStoredNote(note));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-note-btn";
      remove.textContent = "削除";
      remove.addEventListener("click", () => deleteStoredNote(note));
      actions.append(open, remove);
      card.append(title, subject, date, saved, actions);
      noteList.append(card);
    });
  } catch (error) {
    homeStatus.textContent = "ノート保存領域を利用できません。ブラウザのサイトデータ設定を確認してください。";
  }
}

function applyNoteRecord(note) {
  currentNoteId = note.id;
  currentNoteCreatedAt = note.createdAt || new Date().toISOString();
  state.pages = Array.isArray(note.pages) && note.pages.length ? clonePages(note.pages) : [createEmptyPage("plain")];
  pageIndex = 0;
  noteTitle.value = note.noteTitle || "ノート";
  subjectSelect.value = note.subject || "国語";
  subjectOther.value = note.subjectOther || "";
  noteDate.value = note.noteDate || getTodayLocalDateString();
  Object.keys(defaultToolSettings).forEach((tool) => {
    toolSettings[tool] = { ...defaultToolSettings[tool], ...(note.toolSettings?.[tool] || {}) };
  });
  subjectOther.style.display = subjectSelect.value === "その他" ? "inline-block" : "none";
  undoStack.length = 0;
  redoStack.length = 0;
  selectedId = null;
  setTool("mouse");
  updateUndoRedoButtons();
}

async function openStoredNote(note) {
  applyNoteRecord(note);
  homeScreen.hidden = true;
  editorScreen.hidden = false;
  draw();
}

async function createNewNote() {
  applyNoteRecord({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    noteTitle: "ノート",
    subject: "国語",
    subjectOther: "",
    noteDate: getTodayLocalDateString(),
    pages: [createEmptyPage("plain")],
    toolSettings: defaultToolSettings,
  });
  homeScreen.hidden = true;
  editorScreen.hidden = false;
  draw();
}

async function deleteStoredNote(note) {
  if (!confirm(`「${note.noteTitle || "ノート"}」をこのブラウザから削除しますか？`)) return;
  await withNoteStore("readwrite", (store) => store.delete(note.id));
  renderHome();
}

async function returnHome() {
  clearTimeout(localSaveTimer);
  try {
    await persistCurrentNote();
  } catch {
    alert("ノートを保存できませんでした。ブラウザのサイトデータ設定を確認してください。");
    return;
  }
  editorScreen.hidden = true;
  homeScreen.hidden = false;
  renderHome();
}

function getTodayLocalDateString() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - tzOffset);
  return local.toISOString().slice(0, 10);
}

function getEffectiveSubject() {
  const s = subjectSelect.value;
  if (s === "その他") {
    return subjectOther.value.trim() || "その他";
  }
  return s;
}

function makeBaseFileName() {
  const dateText = noteDate.value || getTodayLocalDateString();
  const subjectText = getEffectiveSubject();
  const titleText = noteTitle.value.trim() || "ノート";
  return `${dateText}_${subjectText}_${titleText}`.replace(/[\\/:*?"<>|]/g, "_");
}

function createEmptyPage(background = "plain") {
  return {
    background,
    strokes: [],
    elements: [],
  };
}

function clonePages(pages = state.pages) {
  return JSON.parse(JSON.stringify(pages));
}

function recordHistory() {
  undoStack.push(clonePages());
  redoStack.length = 0;
  updateUndoRedoButtons();
}

function restorePages(snapshot) {
  state.pages = clonePages(snapshot);
  pageIndex = Math.min(pageIndex, state.pages.length - 1);
  selectedId = null;
  activeStroke = null;
  interaction = null;
  drawing = false;
  draw();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(clonePages());
  restorePages(undoStack.pop());
  updateUndoRedoButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(clonePages());
  restorePages(redoStack.pop());
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function currentPage() {
  return state.pages[pageIndex];
}

function currentSettings() {
  return toolSettings[currentTool] || toolSettings.pen;
}

function hsla(alpha = 1) {
  const settings = currentSettings();
  return `hsla(${settings.h ?? 0}, ${settings.s ?? 0}%, ${settings.l ?? 40}%, ${alpha})`;
}

function hslaFrom(h, s, l, alpha = 1) {
  return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

function getCurrentColorObj() {
  const settings = currentSettings();
  return {
    h: Number(settings.h ?? 0),
    s: Number(settings.s ?? 0),
    l: Number(settings.l ?? 40),
  };
}

function updateColorPreview() {
  colorPreview.style.background = hsla(1);
  drawColorPicker();
}

function syncDetailInputsFromTool() {
  const settings = currentSettings();
  if ("h" in settings) hueInput.value = settings.h;
  if ("s" in settings) satInput.value = settings.s;
  if ("l" in settings) lightInput.value = settings.l;
  if ("size" in settings) sizeInput.value = settings.size;
  if (textInput) textInput.value = toolSettings.text.text || "";
  if (templateSelect) templateSelect.value = toolSettings.template.template || "めあて";
  if (shapeSelect) shapeSelect.value = toolSettings.shape.shape || "circle";
  updateColorPreview();
}

function drawColorPicker() {
  if (!colorPlane || !lightBar) return;

  const planeCtx = colorPlane.getContext("2d");
  const barCtx = lightBar.getContext("2d");
  const planeW = colorPlane.width;
  const planeH = colorPlane.height;
  const image = planeCtx.createImageData(planeW, planeH);

  for (let y = 0; y < planeH; y++) {
    for (let x = 0; x < planeW; x++) {
      const h = (x / (planeW - 1)) * 360;
      const s = 100 - (y / (planeH - 1)) * 100;
      const { r, g, b } = hslToRgb(h, s, Number(lightInput.value));
      const index = (y * planeW + x) * 4;
      image.data[index] = r;
      image.data[index + 1] = g;
      image.data[index + 2] = b;
      image.data[index + 3] = 255;
    }
  }
  planeCtx.putImageData(image, 0, 0);

  const barGradient = barCtx.createLinearGradient(0, 0, 0, lightBar.height);
  barGradient.addColorStop(0, `hsl(${hueInput.value}, ${satInput.value}%, 100%)`);
  barGradient.addColorStop(0.5, `hsl(${hueInput.value}, ${satInput.value}%, 50%)`);
  barGradient.addColorStop(1, `hsl(${hueInput.value}, ${satInput.value}%, 0%)`);
  barCtx.fillStyle = barGradient;
  barCtx.fillRect(0, 0, lightBar.width, lightBar.height);

  drawPickerMarks(planeCtx, barCtx);
}

function drawPickerMarks(planeCtx, barCtx) {
  const x = (Number(hueInput.value) / 360) * colorPlane.width;
  const y = (1 - Number(satInput.value) / 100) * colorPlane.height;
  planeCtx.save();
  planeCtx.strokeStyle = "#fff";
  planeCtx.lineWidth = 2;
  planeCtx.beginPath();
  planeCtx.arc(x, y, 5, 0, Math.PI * 2);
  planeCtx.stroke();
  planeCtx.strokeStyle = "#111";
  planeCtx.lineWidth = 1;
  planeCtx.beginPath();
  planeCtx.arc(x, y, 6, 0, Math.PI * 2);
  planeCtx.stroke();
  planeCtx.restore();

  const ly = (1 - Number(lightInput.value) / 100) * lightBar.height;
  barCtx.save();
  barCtx.strokeStyle = "#fff";
  barCtx.lineWidth = 2;
  barCtx.beginPath();
  barCtx.moveTo(0, ly);
  barCtx.lineTo(lightBar.width, ly);
  barCtx.stroke();
  barCtx.restore();
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function pickColorFromPlane(e) {
  const rect = colorPlane.getBoundingClientRect();
  const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
  const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
  const settings = currentSettings();
  settings.h = Math.round((x / rect.width) * 360);
  settings.s = Math.round(100 - (y / rect.height) * 100);
  hueInput.value = settings.h;
  satInput.value = settings.s;
  updateColorPreview();
  draw();
}

function pickLightFromBar(e) {
  const rect = lightBar.getBoundingClientRect();
  const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
  const settings = currentSettings();
  settings.l = Math.round(100 - (y / rect.height) * 100);
  lightInput.value = settings.l;
  updateColorPreview();
  draw();
}

function updateToolDetails(tool) {
  detailControls.forEach((control) => {
    const tools = (control.dataset.tools || "").split(/\s+/);
    control.hidden = !tools.includes(tool);
  });
  updateSelectedObjectInfo();
}

function updateSelectedObjectInfo() {
  if (!selectedObjectInfo) return;
  const selected = selectedId ? currentPage().elements.find((el) => el.id === selectedId) : null;
  selectedObjectInfo.textContent = selected ? `${getElementLabel(selected)}を選択中` : "未選択";
}

function getSelectedTextElement() {
  if (currentTool !== "mouse" || !selectedId) return null;
  const selected = currentPage().elements.find((el) => el.id === selectedId);
  return selected?.type === "text" ? selected : null;
}

function updateSelectedTextEditor() {
  if (!selectedTextEditor || !selectedTextInput) return;
  const selected = getSelectedTextElement();
  selectedTextEditor.hidden = !selected;
  if (selected && document.activeElement !== selectedTextInput) {
    selectedTextInput.value = selected.text || "";
  }
}

function getElementLabel(el) {
  if (el.type === "text") return "テキスト";
  if (el.type === "template") return "定型文";
  if (el.type === "image") return "画像";
  if (el.type === "shape") return "図形";
  return "オブジェクト";
}

function setTool(tool) {
  currentTool = tool;
  toolButtons.forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  syncDetailInputsFromTool();
  updateToolDetails(tool);
  if (tool !== "mouse") {
    selectedId = null;
  }
  draw();
}

function toCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * W;
  const y = ((e.clientY - rect.top) / rect.height) * H;
  return { x, y };
}

function drawBackground(targetCtx, page) {
  targetCtx.fillStyle = "#f2f2f2";
  targetCtx.fillRect(0, 0, W, H);

  const leftX = 0;
  const rightX = PAGE_W + GUTTER;

  drawSinglePageBg(targetCtx, page.background, leftX);
  drawSinglePageBg(targetCtx, page.background, rightX);
}

function drawCenterBinder(targetCtx) {
  targetCtx.fillStyle = "#ced3db";
  targetCtx.fillRect(PAGE_W, 0, GUTTER, H);
  targetCtx.fillStyle = "rgba(0,0,0,0.15)";
  targetCtx.fillRect(PAGE_W + GUTTER / 2 - 1, 0, 2, H);
}

function drawSinglePageBg(targetCtx, type, x) {
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(x, 0, PAGE_W, PAGE_H);
  targetCtx.clip();

  const img = backgroundImageMap[type];
  if (img && img.complete && img.naturalWidth > 0) {
    drawImageContain(targetCtx, img, x, 0, PAGE_W, PAGE_H);
  } else {
    targetCtx.fillStyle = "#ffffff";
    targetCtx.fillRect(x, 0, PAGE_W, PAGE_H);
  }

  targetCtx.strokeStyle = "rgba(0,0,0,0.15)";
  targetCtx.strokeRect(x + 0.5, 0.5, PAGE_W - 1, PAGE_H - 1);
  targetCtx.restore();
}

function drawImageContain(targetCtx, img, x, y, w, h) {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  targetCtx.fillStyle = "#ffffff";
  targetCtx.fillRect(x, y, w, h);
  targetCtx.drawImage(img, dx, dy, dw, dh);
}

function drawStroke(targetCtx, stroke) {
  if (!stroke.points.length) return;
  targetCtx.save();
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.globalAlpha = stroke.alpha;
  targetCtx.strokeStyle = stroke.color;
  targetCtx.lineWidth = stroke.width;
  targetCtx.beginPath();
  targetCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i++) {
    targetCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  targetCtx.stroke();
  targetCtx.restore();
}

function drawElement(targetCtx, el) {
  if (el.type === "text") {
    if (!el.baseW) el.baseW = Math.max(40, el.w);
    if (!el.baseH) el.baseH = Math.max(30, el.h);
    if (!el.baseFontSize) el.baseFontSize = el.fontSize || 34;
    const sx = el.w / el.baseW;
    const sy = el.h / el.baseH;
    targetCtx.save();
    targetCtx.translate(el.x, el.y);
    targetCtx.scale(sx, sy);
    targetCtx.font = `${el.baseFontSize}px "BIZ UDPGothic", "Yu Gothic UI", sans-serif`;
    targetCtx.fillStyle = el.color;
    targetCtx.textBaseline = "top";
    targetCtx.beginPath();
    targetCtx.rect(0, 0, el.baseW, el.baseH);
    targetCtx.clip();
    drawWrappedText(
      targetCtx,
      el.text || "",
      6,
      6,
      Math.max(20, el.baseW - 12),
      el.baseFontSize,
    );
    targetCtx.restore();
  }

  if (el.type === "template") {
    if (!el.baseW) el.baseW = Math.max(50, el.w);
    if (!el.baseH) el.baseH = Math.max(34, el.h);
    if (!el.baseFontSize) el.baseFontSize = el.fontSize || 34;
    const sx = el.w / el.baseW;
    const sy = el.h / el.baseH;
    targetCtx.save();
    targetCtx.translate(el.x, el.y);
    targetCtx.scale(sx, sy);
    targetCtx.font = `${el.baseFontSize}px "BIZ UDPGothic", "Yu Gothic UI", sans-serif`;
    targetCtx.textBaseline = "top";
    targetCtx.fillStyle = hslaFrom(el.hue ?? 0, el.sat ?? 0, el.light ?? 30, 0.2);
    targetCtx.strokeStyle = hslaFrom(el.hue ?? 0, el.sat ?? 0, el.light ?? 30, 1);
    targetCtx.lineWidth = 2;
    targetCtx.fillRect(0, 0, el.baseW, el.baseH);
    targetCtx.strokeRect(0, 0, el.baseW, el.baseH);
    targetCtx.fillStyle = hslaFrom(el.hue ?? 0, el.sat ?? 0, el.light ?? 30, 1);
    targetCtx.beginPath();
    targetCtx.rect(0, 0, el.baseW, el.baseH);
    targetCtx.clip();
    drawWrappedText(
      targetCtx,
      el.text || "",
      10,
      8,
      Math.max(20, el.baseW - 20),
      el.baseFontSize,
    );
    targetCtx.restore();
  }

  if (el.type === "shape") {
    targetCtx.save();
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    targetCtx.translate(cx, cy);
    targetCtx.rotate(el.rotation || 0);
    targetCtx.strokeStyle = el.color;
    targetCtx.lineWidth = Math.max(1, el.strokeWidth || 2);
    targetCtx.fillStyle = hslaFrom(el.hue ?? 0, el.sat ?? 0, el.light ?? 30, 0.14);
    drawShapePath(targetCtx, el.shapeKind || "square", el.w, el.h);
    targetCtx.fill();
    targetCtx.stroke();
    targetCtx.restore();
  }

  if (el.type === "image") {
    const img = getCachedImage(el.src);
    if (img && img.complete && img.naturalWidth) {
      targetCtx.drawImage(img, el.x, el.y, el.w, el.h);
    } else {
      targetCtx.fillStyle = "#d9d9d9";
      targetCtx.fillRect(el.x, el.y, el.w, el.h);
      targetCtx.strokeStyle = "#888";
      targetCtx.strokeRect(el.x, el.y, el.w, el.h);
      targetCtx.fillStyle = "#555";
      targetCtx.fillText("loading...", el.x + 8, el.y + 8);
    }
  }
}

function drawShapePath(targetCtx, kind, w, h) {
  // Shapes are always regular.  Use the smaller dimension as a safeguard for
  // older saved notes that may still contain non-square shape bounds.
  const radius = Math.min(w, h) / 2;
  targetCtx.beginPath();
  if (kind === "circle") {
    targetCtx.arc(0, 0, radius, 0, Math.PI * 2);
    return;
  }

  if (kind === "square") {
    targetCtx.rect(-radius, -radius, radius * 2, radius * 2);
    return;
  }

  const sides = kind === "triangle" ? 3 : kind === "pentagon" ? 5 : kind === "hexagon" ? 6 : 4;
  const start = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const a = start + (Math.PI * 2 * i) / sides;
    const px = Math.cos(a) * radius;
    const py = Math.sin(a) * radius;
    if (i === 0) targetCtx.moveTo(px, py);
    else targetCtx.lineTo(px, py);
  }
  targetCtx.closePath();
}

function drawSelection(targetCtx, el) {
  if (!el) return;
  targetCtx.save();
  targetCtx.strokeStyle = "#0f6dff";
  targetCtx.lineWidth = 2;
  targetCtx.setLineDash([8, 5]);
  targetCtx.strokeRect(el.x, el.y, el.w, el.h);
  targetCtx.setLineDash([]);

  const handles = getHandles(el);
  targetCtx.fillStyle = "#fff";
  targetCtx.strokeStyle = "#0f6dff";
  handles.forEach((h) => {
    targetCtx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    targetCtx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  });

  const del = getDeleteButton(el);
  targetCtx.fillStyle = "#e53935";
  targetCtx.strokeStyle = "#ffffff";
  targetCtx.lineWidth = 2;
  targetCtx.beginPath();
  targetCtx.arc(del.x, del.y, del.r, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.stroke();
  targetCtx.strokeStyle = "#ffffff";
  targetCtx.lineWidth = 2.5;
  targetCtx.beginPath();
  targetCtx.moveTo(del.x - 4, del.y - 4);
  targetCtx.lineTo(del.x + 4, del.y + 4);
  targetCtx.moveTo(del.x + 4, del.y - 4);
  targetCtx.lineTo(del.x - 4, del.y + 4);
  targetCtx.stroke();

  if (el.type === "shape") {
    const rot = getRotateButton(el);
    targetCtx.fillStyle = "#1a73e8";
    targetCtx.strokeStyle = "#ffffff";
    targetCtx.lineWidth = 2;
    targetCtx.beginPath();
    targetCtx.arc(rot.x, rot.y, rot.r, 0, Math.PI * 2);
    targetCtx.fill();
    targetCtx.stroke();
  }
  targetCtx.restore();
}

function draw() {
  const page = currentPage();
  drawBackground(ctx, page);

  page.strokes.forEach((s) => drawStroke(ctx, s));
  if (handwritingSession?.page === page) {
    handwritingSession.strokes.forEach((s) => drawStroke(ctx, s));
  }
  if (activeStroke) drawStroke(ctx, activeStroke);
  drawCenterBinder(ctx);

  page.elements.forEach((el) => drawElement(ctx, el));

  if (currentTool === "mouse" && selectedId) {
    const el = page.elements.find((e) => e.id === selectedId);
    drawSelection(ctx, el);
  }

  updateUi();
  scheduleLocalSave();
}

function updateUi() {
  pageIndicator.textContent = `${pageIndex + 1} / ${state.pages.length}`;
  if (backgroundType) {
    const bg = currentPage().background || "plain";
    backgroundType.value = backgroundType.querySelector(`option[value="${bg}"]`) ? bg : "plain";
  }
  updateSelectedObjectInfo();
  updateSelectedTextEditor();
  updateColorPreview();
}

function wrapLineByWidth(targetCtx, line, maxWidth) {
  if (!line) return [""];
  const chunks = [];
  let current = "";
  for (const ch of line) {
    const trial = current + ch;
    if (targetCtx.measureText(trial).width <= maxWidth || current.length === 0) {
      current = trial;
    } else {
      chunks.push(current);
      current = ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function drawWrappedText(targetCtx, text, x, y, maxWidth, fontSize) {
  const lineHeight = Math.round(fontSize * 1.35);
  const lines = String(text).split("\n");
  let yPos = y;
  for (const rawLine of lines) {
    const wrapped = wrapLineByWidth(targetCtx, rawLine, maxWidth);
    for (const part of wrapped) {
      targetCtx.fillText(part, x, yPos);
      yPos += lineHeight;
    }
  }
}

function measureTextElement(text, fontSize) {
  const padding = 6;
  const lineHeight = Math.round(fontSize * 1.35);
  ctx.save();
  ctx.font = `${fontSize}px "BIZ UDPGothic", "Yu Gothic UI", sans-serif`;
  const lines = String(text).split("\n");
  const widestLine = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  ctx.restore();
  return {
    w: Math.ceil(widestLine + padding * 2),
    h: Math.ceil(lines.length * lineHeight + padding * 2),
  };
}

function createTextElement(text, x, y, settings = toolSettings.text) {
  const fontSize = Number(settings.size);
  const bounds = measureTextElement(text, fontSize);
  return {
    id: crypto.randomUUID(),
    type: "text",
    text,
    x,
    y,
    w: bounds.w,
    h: bounds.h,
    fontSize,
    baseW: bounds.w,
    baseH: bounds.h,
    baseFontSize: fontSize,
    color: hslaFrom(settings.h ?? 0, settings.s ?? 0, settings.l ?? 40),
  };
}

function updateTextElement(el, text) {
  const fontSize = el.baseFontSize || el.fontSize || 34;
  const bounds = measureTextElement(text || " ", fontSize);
  el.text = text;
  el.w = bounds.w;
  el.h = bounds.h;
  el.baseW = bounds.w;
  el.baseH = bounds.h;
  el.baseFontSize = fontSize;
}

function scheduleHandwritingRecognition() {
  if (handwritingTimer) clearTimeout(handwritingTimer);
  handwritingTimer = window.setTimeout(recognizeHandwritingSession, 900);
}

function setAiTextStatus(message) {
  if (aiTextStatus) aiTextStatus.textContent = message;
}

async function getHandwritingWorker() {
  if (!window.Tesseract) {
    throw new Error("文字認識の読み込みに失敗しました。インターネット接続を確認して再読み込みしてください。");
  }
  if (!handwritingWorkerPromise) {
    setAiTextStatus("文字認識の準備中です…");
    handwritingWorkerPromise = window.Tesseract.createWorker("jpn");
  }
  return handwritingWorkerPromise;
}

function handwritingImageData(strokes) {
  const points = strokes.flatMap((stroke) => stroke.points || []);
  const padding = 24;
  const minX = Math.min(...points.map((p) => p.x)) - padding;
  const minY = Math.min(...points.map((p) => p.y)) - padding;
  const maxX = Math.max(...points.map((p) => p.x)) + padding;
  const maxY = Math.max(...points.map((p) => p.y)) + padding;
  const image = document.createElement("canvas");
  image.width = Math.max(1, Math.ceil(maxX - minX));
  image.height = Math.max(1, Math.ceil(maxY - minY));
  const imageCtx = image.getContext("2d");
  imageCtx.fillStyle = "#fff";
  imageCtx.fillRect(0, 0, image.width, image.height);
  strokes.forEach((stroke) => {
    imageCtx.save();
    imageCtx.translate(-minX, -minY);
    imageCtx.lineCap = "round";
    imageCtx.lineJoin = "round";
    imageCtx.strokeStyle = "#000";
    imageCtx.lineWidth = Math.max(stroke.width || 4, 5);
    imageCtx.beginPath();
    imageCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => imageCtx.lineTo(point.x, point.y));
    imageCtx.stroke();
    imageCtx.restore();
  });
  return { imageData: image.toDataURL("image/png"), x: minX + padding, y: minY + padding };
}

async function recognizeHandwritingSession() {
  handwritingTimer = null;
  const session = handwritingSession;
  if (!session || !session.strokes.length) return;
  handwritingSession = null;
  const { imageData, x, y } = handwritingImageData(session.strokes);
  draw();

  try {
    setAiTextStatus("文字を認識しています…");
    const worker = await getHandwritingWorker();
    const { data } = await worker.recognize(imageData);
    const text = String(data.text || "").trim();
    if (!text) throw new Error("文字を認識できませんでした。もう一度書いてください。");
    if (!state.pages.includes(session.page)) return;
    const el = createTextElement(text, x, y, toolSettings.aiText);
    session.page.elements.push(el);
    if (session.page === currentPage() && currentTool === "mouse") selectedId = el.id;
  } catch (error) {
    if (state.pages.includes(session.page)) session.page.strokes.push(...session.strokes);
    alert(error.message || "文字を認識できませんでした。手書きはそのまま残しました。");
  }
  setAiTextStatus("書き終えると、少し待って文字へ変換します。");
  draw();
}

function getHandles(el) {
  return [
    { key: "tl", x: el.x, y: el.y },
    { key: "tr", x: el.x + el.w, y: el.y },
    { key: "bl", x: el.x, y: el.y + el.h },
    { key: "br", x: el.x + el.w, y: el.y + el.h },
  ];
}

function getDeleteButton(el) {
  const x = Math.min(W - DELETE_BTN_R - 2, el.x + el.w + DELETE_BTN_R - 2);
  const y = Math.max(DELETE_BTN_R + 2, el.y - DELETE_BTN_R + 2);
  return { x, y, r: DELETE_BTN_R };
}

function getRotateButton(el) {
  return {
    x: el.x + el.w / 2,
    y: el.y - ROTATE_BTN_OFFSET,
    r: ROTATE_BTN_R,
  };
}

function pointInRect(p, el) {
  return p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h;
}

function handleHitTest(p, el) {
  const handles = getHandles(el);
  for (const h of handles) {
    if (
      p.x >= h.x - HANDLE_SIZE &&
      p.x <= h.x + HANDLE_SIZE &&
      p.y >= h.y - HANDLE_SIZE &&
      p.y <= h.y + HANDLE_SIZE
    ) {
      return h.key;
    }
  }
  return null;
}

function deleteButtonHitTest(p, el) {
  const d = getDeleteButton(el);
  const dx = p.x - d.x;
  const dy = p.y - d.y;
  return dx * dx + dy * dy <= d.r * d.r;
}

function rotateButtonHitTest(p, el) {
  const d = getRotateButton(el);
  const dx = p.x - d.x;
  const dy = p.y - d.y;
  return dx * dx + dy * dy <= d.r * d.r;
}

function findTopElementAt(p) {
  const arr = currentPage().elements;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pointInRect(p, arr[i])) return arr[i];
  }
  return null;
}

function expandStrokePoints(stroke) {
  if (!stroke.points || stroke.points.length < 2) return stroke.points || [];
  const expanded = [stroke.points[0]];
  const step = Math.max(3, (stroke.width || 4) / 2);

  for (let i = 1; i < stroke.points.length; i++) {
    const from = stroke.points[i - 1];
    const to = stroke.points[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const pieces = Math.max(1, Math.ceil(distance / step));

    for (let j = 1; j <= pieces; j++) {
      expanded.push({
        x: from.x + (dx * j) / pieces,
        y: from.y + (dy * j) / pieces,
      });
    }
  }

  return expanded;
}

function eraseAtPoint(p) {
  const radius = Math.max(8, Number(toolSettings.eraser.size) * 2);
  const radiusSq = radius * radius;
  const nextStrokes = [];

  for (const stroke of currentPage().strokes) {
    const points = expandStrokePoints(stroke);
    let segment = [];

    for (const pt of points) {
      const dx = pt.x - p.x;
      const dy = pt.y - p.y;
      const hit = dx * dx + dy * dy <= radiusSq;

      if (hit) {
        if (segment.length >= 2) {
          nextStrokes.push({ ...stroke, points: segment, isLine: false });
        }
        segment = [];
      } else {
        segment.push(pt);
      }
    }

    if (segment.length >= 2) {
      nextStrokes.push({ ...stroke, points: segment, isLine: false });
    }
  }

  currentPage().strokes = nextStrokes;
}

function startPointer(e) {
  const p = toCanvasPoint(e);

  if (currentTool === "pen" || currentTool === "marker" || currentTool === "aiText") {
    if (currentTool === "aiText" && handwritingTimer) clearTimeout(handwritingTimer);
    if (currentTool === "aiText" && !handwritingSession) {
      recordHistory();
      handwritingSession = { page: currentPage(), strokes: [] };
    }
    if (currentTool !== "aiText") recordHistory();
    drawing = true;
    const marker = currentTool === "marker";
    const settings = currentSettings();
    activeStroke = {
      color: hsla(1),
      width: marker ? Math.max(Number(settings.size), 12) : Number(settings.size),
      alpha: marker ? 0.35 : 1,
      points: [p],
    };
    draw();
    return;
  }

  if (currentTool === "line") {
    recordHistory();
    drawing = true;
    const settings = currentSettings();
    activeStroke = {
      color: hsla(1),
      width: Number(settings.size),
      alpha: 1,
      points: [p, p],
      isLine: true,
    };
    draw();
    return;
  }

  if (currentTool === "eraser") {
    recordHistory();
    drawing = true;
    activeStroke = null;
    eraseAtPoint(p);
    draw();
    return;
  }

  if (currentTool === "text") {
    const settings = toolSettings.text;
    const text = (settings.text || "").trim();
    if (!text) {
      alert("文字を入力してからノート上をクリックしてください。");
      return;
    }
    recordHistory();
    const el = createTextElement(text, p.x, p.y, settings);
    currentPage().elements.push(el);
    selectedId = el.id;
    draw();
    return;
  }

  if (currentTool === "template") {
    recordHistory();
    const text = toolSettings.template.template || templateSelect.value;
    const c = getCurrentColorObj();
    ctx.save();
    ctx.font = `38px "BIZ UDPGothic", "Yu Gothic UI", sans-serif`;
    const tw = ctx.measureText(text).width;
    ctx.restore();
    const el = {
      id: crypto.randomUUID(),
      type: "template",
      text,
      x: p.x,
      y: p.y,
      w: tw + 36,
      h: Math.max(42, Number(toolSettings.template.size) + 22),
      fontSize: Number(toolSettings.template.size),
      baseW: tw + 36,
      baseH: Math.max(42, Number(toolSettings.template.size) + 22),
      baseFontSize: Number(toolSettings.template.size),
      hue: c.h,
      sat: c.s,
      light: c.l,
    };
    currentPage().elements.push(el);
    selectedId = el.id;
    draw();
    return;
  }

  if (currentTool === "shape") {
    recordHistory();
    const c = getCurrentColorObj();
    const size = Math.max(2, Number(toolSettings.shape.size));
    const el = {
      id: crypto.randomUUID(),
      type: "shape",
      shapeKind: toolSettings.shape.shape || shapeSelect.value,
      x: p.x,
      y: p.y,
      w: 160,
      h: 160,
      rotation: 0,
      color: hsla(1),
      strokeWidth: size,
      hue: c.h,
      sat: c.s,
      light: c.l,
    };
    currentPage().elements.push(el);
    selectedId = el.id;
    draw();
    return;
  }

  if (currentTool === "image") {
    if (!selectedImageSrc) {
      alert("先に下の『画像選択』から画像を選んでください。");
      return;
    }
    recordHistory();
    const img = getCachedImage(selectedImageSrc);
    const ratio = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.75;
    const w = 260;
    const h = w * ratio;
    const el = {
      id: crypto.randomUUID(),
      type: "image",
      src: selectedImageSrc,
      x: p.x,
      y: p.y,
      w,
      h,
      ratio,
    };
    currentPage().elements.push(el);
    selectedId = el.id;
    draw();
    return;
  }

  if (currentTool === "mouse") {
    const page = currentPage();
    if (selectedId) {
      const selected = page.elements.find((el) => el.id === selectedId);
      if (selected) {
        if (deleteButtonHitTest(p, selected)) {
          deleteSelected();
          return;
        }
        if (selected.type === "shape" && rotateButtonHitTest(p, selected)) {
          const cx = selected.x + selected.w / 2;
          const cy = selected.y + selected.h / 2;
          interaction = {
            mode: "rotate",
            id: selected.id,
            centerX: cx,
            centerY: cy,
            startAngle: Math.atan2(p.y - cy, p.x - cx),
            startRotation: selected.rotation || 0,
          };
          return;
        }
        const handle = handleHitTest(p, selected);
        if (handle) {
          recordHistory();
          interaction = {
            mode: "resize",
            id: selected.id,
            handle,
            start: p,
            startRect: { x: selected.x, y: selected.y, w: selected.w, h: selected.h },
          };
          return;
        }
      }
    }

    const target = findTopElementAt(p);
    if (target) {
      recordHistory();
      selectedId = target.id;
      const idx = page.elements.findIndex((el) => el.id === target.id);
      const [pick] = page.elements.splice(idx, 1);
      page.elements.push(pick);
      interaction = {
        mode: "move",
        id: target.id,
        offsetX: p.x - target.x,
        offsetY: p.y - target.y,
      };
    } else {
      selectedId = null;
    }
    draw();
  }
}

function movePointer(e) {
  const p = toCanvasPoint(e);

  if (drawing && currentTool === "eraser") {
    eraseAtPoint(p);
    draw();
    return;
  }

  if (drawing && activeStroke) {
    if (activeStroke.isLine) {
      activeStroke.points[1] = p;
    } else {
      activeStroke.points.push(p);
    }
    draw();
    return;
  }

  if (!interaction) return;
  const el = currentPage().elements.find((x) => x.id === interaction.id);
  if (!el) return;

  if (interaction.mode === "move") {
    el.x = p.x - interaction.offsetX;
    el.y = p.y - interaction.offsetY;
  }

  if (interaction.mode === "resize") {
    resizeElement(el, interaction, p);
  }

  if (interaction.mode === "rotate") {
    const now = Math.atan2(p.y - interaction.centerY, p.x - interaction.centerX);
    el.rotation = interaction.startRotation + (now - interaction.startAngle);
  }
  draw();
}

function endPointer() {
  if (drawing && activeStroke) {
    const stroke = activeStroke.isLine
      ? { ...activeStroke, points: expandStrokePoints(activeStroke), isLine: false }
      : activeStroke;
    if (currentTool === "aiText") {
      handwritingSession?.strokes.push(stroke);
      scheduleHandwritingRecognition();
    } else {
      currentPage().strokes.push(stroke);
    }
  }
  drawing = false;
  activeStroke = null;
  interaction = null;
  draw();
}

function resizeElement(el, interactionData, p) {
  const r = interactionData.startRect;

  let newX = r.x;
  let newY = r.y;
  let newW = r.w;
  let newH = r.h;

  if (interactionData.handle.includes("r")) newW = Math.max(24, p.x - r.x);
  if (interactionData.handle.includes("l")) {
    newW = Math.max(24, r.w + (r.x - p.x));
    newX = r.x + r.w - newW;
  }
  if (interactionData.handle.includes("b")) newH = Math.max(24, p.y - r.y);
  if (interactionData.handle.includes("t")) {
    newH = Math.max(24, r.h + (r.y - p.y));
    newY = r.y + r.h - newH;
  }

  if (el.type === "shape") {
    const size = Math.max(newW, newH);
    if (interactionData.handle.includes("l")) newX = r.x + r.w - size;
    if (interactionData.handle.includes("t")) newY = r.y + r.h - size;
    newW = size;
    newH = size;
  }

  el.x = newX;
  el.y = newY;
  el.w = newW;
  el.h = newH;
}

function getCachedImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const img = new Image();
  img.src = src;
  img.onload = () => draw();
  imageCache.set(src, img);
  return img;
}

function deleteSelected() {
  if (!selectedId) return;
  recordHistory();
  const page = currentPage();
  page.elements = page.elements.filter((e) => e.id !== selectedId);
  selectedId = null;
  draw();
}

function clearCurrentPage() {
  const ok = confirm("このページの内容をすべて消去します。よろしいですか？");
  if (!ok) return;
  recordHistory();
  const page = currentPage();
  page.strokes = [];
  page.elements = [];
  selectedId = null;
  draw();
}

function exportJson() {
  const payload = {
    noteTitle: noteTitle.value,
    subject: subjectSelect.value,
    subjectOther: subjectOther.value,
    noteDate: noteDate.value,
    toolSettings,
    pages: state.pages,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  const safeName = makeBaseFileName();
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
        throw new Error("ページデータがありません");
      }
      recordHistory();
      state.pages = parsed.pages.map((p) => ({
        background: ["plain", "fourLine", "vertical5mm", "grid5mm"].includes(p.background)
          ? p.background
          : "plain",
        strokes: Array.isArray(p.strokes) ? p.strokes : [],
        elements: Array.isArray(p.elements) ? p.elements : [],
      }));
      pageIndex = 0;
      noteTitle.value = parsed.noteTitle || "ノート";
      subjectSelect.value = parsed.subject || "国語";
      subjectOther.value = parsed.subjectOther || "";
      noteDate.value = parsed.noteDate || getTodayLocalDateString();
      if (parsed.toolSettings) {
        Object.keys(defaultToolSettings).forEach((tool) => {
          toolSettings[tool] = {
            ...defaultToolSettings[tool],
            ...(parsed.toolSettings[tool] || {}),
          };
        });
        syncDetailInputsFromTool();
      }
      subjectOther.style.display = subjectSelect.value === "その他" ? "inline-block" : "none";
      selectedId = null;
      draw();
    } catch (err) {
      alert(`読み込みに失敗しました: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function renderPageToDataUrl(page) {
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const offCtx = off.getContext("2d");
  drawBackground(offCtx, page);
  page.strokes.forEach((s) => drawStroke(offCtx, s));
  drawCenterBinder(offCtx);
  page.elements.forEach((el) => drawElement(offCtx, { ...el }));
  return off.toDataURL("image/png");
}

function exportPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("PDFライブラリの読み込みに失敗しました。ページを再読み込みしてください。");
    return;
  }
  const images = state.pages.map((p) => renderPageToDataUrl(p));
  const title = makeBaseFileName().replace(/[<>]/g, "");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: W >= H ? "landscape" : "portrait",
    unit: "px",
    format: [W, H],
    compress: true,
  });

  images.forEach((src, idx) => {
    if (idx > 0) {
      pdf.addPage([W, H], W >= H ? "landscape" : "portrait");
    }
    pdf.addImage(src, "PNG", 0, 0, W, H, undefined, "FAST");
  });

  pdf.save(`${title}.pdf`);
}

function addPage() {
  recordHistory();
  const bg = currentPage().background || "plain";
  state.pages.splice(pageIndex + 1, 0, createEmptyPage(bg));
  pageIndex += 1;
  selectedId = null;
  draw();
}

function removePage() {
  if (state.pages.length <= 1) {
    alert("1ページは残す必要があります。");
    return;
  }
  recordHistory();
  state.pages.splice(pageIndex, 1);
  pageIndex = Math.max(0, pageIndex - 1);
  selectedId = null;
  draw();
}

function prevPage() {
  pageIndex = Math.max(0, pageIndex - 1);
  selectedId = null;
  draw();
}

function nextPage() {
  pageIndex = Math.min(state.pages.length - 1, pageIndex + 1);
  selectedId = null;
  draw();
}

function setTopMenuCollapsed(collapsed) {
  if (!mainArea || !topMenuToggle) return;
  mainArea.classList.toggle("top-collapsed", collapsed);
  topMenuToggle.setAttribute("aria-label", collapsed ? "上部メニューを表示" : "上部メニューを隠す");
}

function resetNote() {
  const ok = confirm("ノートを白紙に戻します。よろしいですか？");
  if (!ok) return;
  recordHistory();
  state.pages = state.pages.map(() => createEmptyPage("plain"));
  pageIndex = 0;
  selectedId = null;
  draw();
}

toolButtons.forEach((btn) => btn.addEventListener("click", () => setTool(btn.dataset.tool)));
[hueInput, satInput, lightInput].forEach((input) => {
  input.addEventListener("input", () => {
    const settings = currentSettings();
    if ("h" in settings) settings.h = Number(hueInput.value);
    if ("s" in settings) settings.s = Number(satInput.value);
    if ("l" in settings) settings.l = Number(lightInput.value);
    updateColorPreview();
    draw();
  });
});

sizeInput.addEventListener("input", () => {
  const settings = currentSettings();
  settings.size = Number(sizeInput.value);
});

if (textInput) {
  textInput.addEventListener("input", () => {
    toolSettings.text.text = textInput.value;
  });
}

if (selectedTextInput) {
  selectedTextInput.addEventListener("focus", () => {
    if (getSelectedTextElement() && !selectedTextEditInProgress) {
      recordHistory();
      selectedTextEditInProgress = true;
    }
  });
  selectedTextInput.addEventListener("input", () => {
    const selected = getSelectedTextElement();
    if (!selected) return;
    updateTextElement(selected, selectedTextInput.value);
    draw();
  });
  selectedTextInput.addEventListener("blur", () => {
    selectedTextEditInProgress = false;
  });
}

if (templateSelect) {
  templateSelect.addEventListener("change", () => {
    toolSettings.template.template = templateSelect.value;
  });
}

if (shapeSelect) {
  shapeSelect.addEventListener("change", () => {
    toolSettings.shape.shape = shapeSelect.value;
  });
}

if (colorPlane) {
  colorPlane.addEventListener("pointerdown", (e) => {
    colorPlane.setPointerCapture(e.pointerId);
    pickColorFromPlane(e);
  });
  colorPlane.addEventListener("pointermove", (e) => {
    if (e.buttons) pickColorFromPlane(e);
  });
}

if (lightBar) {
  lightBar.addEventListener("pointerdown", (e) => {
    lightBar.setPointerCapture(e.pointerId);
    pickLightFromBar(e);
  });
  lightBar.addEventListener("pointermove", (e) => {
    if (e.buttons) pickLightFromBar(e);
  });
}

imageInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    selectedImageSrc = reader.result;
    if (imagePreview) {
      imagePreview.src = selectedImageSrc;
      imagePreview.hidden = false;
    }
    getCachedImage(selectedImageSrc);
  };
  reader.readAsDataURL(file);
});

if (backgroundType) {
  backgroundType.addEventListener("change", () => {
    recordHistory();
    currentPage().background = backgroundType.value;
    draw();
  });
}

prevPageBtn.addEventListener("click", prevPage);
nextPageBtn.addEventListener("click", nextPage);
addPageBtn.addEventListener("click", addPage);
removePageBtn.addEventListener("click", removePage);

savePdfBtn.addEventListener("click", exportPdf);
saveDataBtn.addEventListener("click", exportJson);
resetNoteBtn.addEventListener("click", resetNote);
loadDataInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importJson(file);
  e.target.value = "";
});

deleteSelectedBtn.addEventListener("click", deleteSelected);
clearPageBtn.addEventListener("click", clearCurrentPage);
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
noteTitle.addEventListener("input", () => {
  state.noteTitle = noteTitle.value;
  scheduleLocalSave();
});

subjectSelect.addEventListener("change", () => {
  subjectOther.style.display = subjectSelect.value === "その他" ? "inline-block" : "none";
  state.subject = subjectSelect.value;
  scheduleLocalSave();
});

subjectOther.addEventListener("input", () => {
  state.subjectOther = subjectOther.value;
  scheduleLocalSave();
});

noteDate.addEventListener("change", () => {
  state.noteDate = noteDate.value;
  scheduleLocalSave();
});

createNoteBtn.addEventListener("click", createNewNote);
goHomeBtn.addEventListener("click", returnHome);

window.addEventListener("pagehide", () => {
  persistCurrentNote().catch(() => {});
});

if (topMenuToggle) {
  topMenuToggle.addEventListener("click", () => {
    const collapsed = mainArea.classList.contains("top-collapsed");
    setTopMenuCollapsed(!collapsed);
  });
}

document.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && currentTool === "mouse") {
    const activeTag = document.activeElement?.tagName;
    if (activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
      deleteSelected();
    }
  }
});

canvas.addEventListener("pointerdown", startPointer);
canvas.addEventListener("pointermove", movePointer);
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointerleave", endPointer);

updateColorPreview();
updateToolDetails(currentTool);
updateUndoRedoButtons();
noteDate.value = getTodayLocalDateString();
state.noteDate = noteDate.value;
setTopMenuCollapsed(true);
editorScreen.hidden = true;
homeScreen.hidden = false;
renderHome();
