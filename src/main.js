import './styles.css';
import { PDFDocument, degrees } from 'pdf-lib';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let pdfjs;
const databaseName = 'pdf-signature-tool';
const storeName = 'settings';
const defaultPlacement = { x: 0.66, y: 0.83, width: 0.22 };
const canvasRenderTasks = new WeakMap();
const canvasRenderRequests = new WeakMap();
const state = {
  config: null,
  files: [],
  signatureBytes: null,
  signatureUrl: null,
  signatureAspect: 3.2,
  setupPdfBytes: null,
  setupViewport: null,
  setupPlacement: null,
  result: null,
  isProcessing: false,
};

const el = (id) => document.getElementById(id);
const elements = {
  signatureStatus: el('signature-status'),
  settingsButton: el('settings-button'),
  forgetButton: el('forget-button'),
  dropzone: el('dropzone'),
  pdfInput: el('pdf-input'),
  selectPdfs: el('select-pdfs'),
  fileList: el('file-list'),
  fileCount: el('file-count'),
  fixPlacementButton: el('fix-placement-button'),
  progressRegion: el('progress-region'),
  progressMessage: el('progress-message'),
  progressCount: el('progress-count'),
  progressFill: el('progress-fill'),
  resultMessage: el('result-message'),
  downloadRow: el('download-row'),
  downloadSummary: el('download-summary'),
  downloadButton: el('download-button'),
  setupDialog: el('setup-dialog'),
  signatureInput: el('signature-input'),
  signatureFileLabel: el('signature-file-label'),
  sampleInput: el('sample-input'),
  sampleFileLabel: el('sample-file-label'),
  setupPreview: el('setup-preview'),
  setupCanvas: el('setup-canvas'),
  setupOverlay: el('setup-overlay'),
  setupSignatureImage: el('setup-signature-image'),
  setupPageSize: el('setup-page-size'),
  setupError: el('setup-error'),
  saveSettings: el('save-settings'),
  cancelSetup: el('cancel-setup'),
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readConfig() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get('signature');
    request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function writeConfig(config) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(config, 'signature');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function deleteConfig() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete('signature');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

function setStatus(message, ready = false) {
  elements.signatureStatus.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  if (!ready) dot.style.cssText = 'background:#c27b5e;box-shadow:0 0 0 3px #f4e5df';
  const text = document.createElement('span');
  text.textContent = message;
  elements.signatureStatus.append(dot, text);
  elements.forgetButton.hidden = !ready;
}

function showMessage(message, isError = false) {
  elements.resultMessage.textContent = message;
  elements.resultMessage.classList.toggle('error', isError);
  elements.resultMessage.hidden = false;
}

function clearResult() {
  if (state.result) URL.revokeObjectURL(state.result.url);
  state.result = null;
  elements.downloadRow.hidden = true;
}

function clearCurrentPdf(message = '') {
  clearResult();
  state.files = [];
  state.setupPdfBytes = null;
  renderFiles();
  if (message) showMessage(message);
}

function renderFiles() {
  elements.fileCount.textContent = state.files.length ? '1 PDF selected' : 'No PDF selected';
  elements.fileList.replaceChildren();
  for (const entry of state.files) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const icon = document.createElement('span');
    icon.className = 'pdf-icon';
    icon.textContent = 'PDF';
    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = entry.file.name;
    const meta = document.createElement('div');
    meta.className = `file-meta${entry.error ? ' file-error' : ''}`;
    meta.textContent = entry.error || (entry.pageCount ? `${entry.pageCount} ${entry.pageCount === 1 ? 'page' : 'pages'} · ${formatSize(entry.file.size)}` : 'Reading PDF…');
    info.append(name, meta);
    const remove = document.createElement('button');
    remove.className = 'remove-file';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${entry.file.name}`);
    remove.addEventListener('click', () => clearCurrentPdf());
    row.append(icon, info, document.createTextNode(''), remove);
    elements.fileList.append(row);
  }
}

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function addFiles(fileList) {
  const incoming = Array.from(fileList).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!incoming.length) return;
  if (incoming.length > 1) {
    showMessage('Please add one PDF at a time.', true);
    return;
  }
  clearResult();
  elements.resultMessage.hidden = true;
  const entry = { file: incoming[0], pageCount: 0, error: null };
  state.files = [entry];
  renderFiles();
  try {
    const document = await PDFDocument.load(await entry.file.arrayBuffer(), { ignoreEncryption: false });
    entry.pageCount = document.getPageCount();
    if (!entry.pageCount) entry.error = 'This PDF has no pages.';
  } catch {
    entry.error = 'Could not read this PDF. It may be damaged or password-protected.';
  }
  renderFiles();
  if (entry.error) {
    showMessage(entry.error, true);
  } else if (state.config) {
    await signCurrentPdf();
  } else {
    state.setupPdfBytes = await entry.file.arrayBuffer();
    await openSetup();
  }
}

async function loadPdfJs(bytes) {
  pdfjs ??= import('pdfjs-dist').then((module) => {
    module.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return module;
  });
  const module = await pdfjs;
  return module.getDocument({ data: bytes.slice() }).promise;
}

async function renderPdfPage(bytes, canvas, targetWidth = 540, targetHeight = window.innerHeight * 0.4) {
  const requestId = (canvasRenderRequests.get(canvas) || 0) + 1;
  canvasRenderRequests.set(canvas, requestId);
  canvasRenderTasks.get(canvas)?.cancel();
  const pdf = await loadPdfJs(bytes);
  const page = await pdf.getPage(1);
  if (canvasRenderRequests.get(canvas) !== requestId) return null;
  const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const scale = Math.min(targetWidth / baseViewport.width, targetHeight / baseViewport.height, 1.55);
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const context = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.round(viewport.width * devicePixelRatio);
  canvas.height = Math.round(viewport.height * devicePixelRatio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const task = page.render({ canvasContext: context, viewport, transform: devicePixelRatio === 1 ? null : [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] });
  canvasRenderTasks.set(canvas, task);
  try {
    await task.promise;
  } finally {
    if (canvasRenderTasks.get(canvas) === task) canvasRenderTasks.delete(canvas);
  }
  if (canvasRenderRequests.get(canvas) !== requestId) return null;
  const view = page.getViewport({ scale: 1, rotation: page.rotate });
  return { width: viewport.width, height: viewport.height, baseWidth: view.width, baseHeight: view.height, rotation: page.rotate };
}

function normalizedPlacementToBox(page, placement) {
  const { width, height } = page.getSize();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const displayWidth = rotation === 90 || rotation === 270 ? height : width;
  const displayHeight = rotation === 90 || rotation === 270 ? width : height;
  const boxWidth = displayWidth * placement.width;
  const boxHeight = boxWidth / state.config.signatureAspect;
  const left = displayWidth * placement.x;
  const top = displayHeight * placement.y;
  if (rotation === 90) return { x: top + boxHeight, y: left, width: boxWidth, height: boxHeight, rotation: 90 };
  if (rotation === 180) return { x: width - left, y: top + boxHeight, width: boxWidth, height: boxHeight, rotation: 180 };
  if (rotation === 270) return { x: width - top - boxHeight, y: height - left, width: boxWidth, height: boxHeight, rotation: -90 };
  return { x: left, y: height - top - boxHeight, width: boxWidth, height: boxHeight, rotation: 0 };
}

async function openSetup() {
  elements.setupError.hidden = true;
  elements.signatureInput.value = '';
  elements.sampleInput.value = '';
  elements.signatureFileLabel.textContent = state.config ? 'Choose a new PNG signature' : 'Choose a PNG signature';
  elements.sampleFileLabel.textContent = state.files[0]?.file.name || 'Choose a representative PDF';
  state.setupPdfBytes = state.files[0] ? await state.files[0].file.arrayBuffer() : null;
  state.signatureBytes = state.config?.signatureBytes ?? null;
  state.signatureAspect = state.config?.signatureAspect || state.signatureAspect;
  state.setupPlacement = state.config ? { ...state.config.placement } : { ...defaultPlacement };
  if (state.signatureUrl) URL.revokeObjectURL(state.signatureUrl);
  state.signatureUrl = state.signatureBytes ? URL.createObjectURL(new Blob([state.signatureBytes], { type: 'image/png' })) : null;
  elements.setupSignatureImage.src = state.signatureUrl || '';
  elements.setupPreview.hidden = true;
  elements.setupOverlay.hidden = !state.signatureUrl;
  elements.saveSettings.disabled = !state.signatureBytes || !state.setupPdfBytes;
  elements.setupDialog.showModal();
  if (state.setupPdfBytes) await renderSetupPreview();
}

async function renderSetupPreview() {
  if (!state.setupPdfBytes) return;
  try {
    const page = await renderPdfPage(new Uint8Array(state.setupPdfBytes), elements.setupCanvas);
    if (!page) return;
    state.setupViewport = page;
    elements.setupPageSize.textContent = `${Math.round(page.baseWidth)} × ${Math.round(page.baseHeight)} pt`;
    elements.setupPreview.hidden = false;
    elements.setupOverlay.hidden = !state.signatureBytes;
    positionSetupOverlay();
    elements.saveSettings.disabled = !state.signatureBytes;
  } catch (error) {
    if (error?.name === 'RenderingCancelledException') return;
    elements.setupError.textContent = 'This sample PDF could not be previewed. Try another PDF.';
    elements.setupError.hidden = false;
  }
}

function positionSetupOverlay() {
  if (!state.setupViewport || !state.signatureBytes) return;
  const { width, height } = state.setupViewport;
  const placement = state.setupPlacement;
  const overlayWidth = width * placement.width;
  const overlayHeight = overlayWidth / state.signatureAspect;
  elements.setupOverlay.style.left = `${elements.setupCanvas.offsetLeft + placement.x * width}px`;
  elements.setupOverlay.style.top = `${elements.setupCanvas.offsetTop + placement.y * height}px`;
  elements.setupOverlay.style.width = `${overlayWidth}px`;
  elements.setupOverlay.style.height = `${overlayHeight}px`;
}

function setupDrag(event) {
  if (!event.target.closest('.signature-overlay')) return;
  event.preventDefault();
  const overlay = elements.setupOverlay;
  const isResize = event.target.closest('.resize-handle');
  const rect = elements.setupCanvas.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const start = { ...state.setupPlacement };
  const { width, height } = state.setupViewport;
  overlay.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const dx = (moveEvent.clientX - startX) / rect.width;
    const dy = (moveEvent.clientY - startY) / rect.height;
    if (isResize) {
      const maxWidth = Math.min(.65, 1 - start.x, (1 - start.y) * height * state.signatureAspect / width);
      state.setupPlacement.width = Math.max(.07, Math.min(maxWidth, start.width + dx));
    } else {
      state.setupPlacement.x = Math.max(0, Math.min(1 - start.width, start.x + dx));
      const overlayHeight = start.width * width / state.signatureAspect;
      state.setupPlacement.y = Math.max(0, Math.min(1 - overlayHeight / height, start.y + dy));
    }
    positionSetupOverlay();
  };
  const done = () => {
    overlay.removeEventListener('pointermove', move);
    overlay.removeEventListener('pointerup', done);
    overlay.removeEventListener('pointercancel', done);
  };
  overlay.addEventListener('pointermove', move);
  overlay.addEventListener('pointerup', done);
  overlay.addEventListener('pointercancel', done);
}

async function saveSettings() {
  if (!state.signatureBytes || !state.setupPdfBytes) return;
  const config = {
    signatureBytes: state.signatureBytes,
    signatureAspect: state.signatureAspect,
    placement: state.setupPlacement,
  };
  try {
    await writeConfig(config);
    state.config = config;
    elements.setupDialog.close();
    if (state.signatureUrl) URL.revokeObjectURL(state.signatureUrl);
    state.signatureUrl = null;
    setStatus('Signature Ready', true);
    renderFiles();
    if (state.files[0]?.pageCount && !state.files[0].error) await signCurrentPdf();
  } catch {
    elements.setupError.textContent = 'Could not save settings in this browser. Check available storage and try again.';
    elements.setupError.hidden = false;
  }
}

async function signCurrentPdf() {
  const entry = state.files[0];
  if (state.isProcessing || !entry?.pageCount || entry.error || !state.config) return;
  state.isProcessing = true;
  clearResult();
  elements.progressRegion.hidden = false;
  elements.progressMessage.textContent = `Signing ${entry.file.name}`;
  elements.progressCount.textContent = `${entry.pageCount} ${entry.pageCount === 1 ? 'page' : 'pages'}`;
  elements.progressFill.style.width = '0';
  try {
    const document = await PDFDocument.load(await entry.file.arrayBuffer(), { ignoreEncryption: false });
    const signature = await document.embedPng(state.config.signatureBytes);
    const pages = document.getPages();
    for (const [index, page] of pages.entries()) {
      const box = normalizedPlacementToBox(page, state.config.placement);
      page.drawImage(signature, { x: box.x, y: box.y, width: box.width, height: box.height, rotate: degrees(box.rotation) });
      elements.progressFill.style.width = `${Math.round((index + 1) / pages.length * 100)}%`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const stem = entry.file.name.replace(/\.pdf$/i, '');
    const blob = new Blob([await document.save()], { type: 'application/pdf' });
    state.result = { name: `${stem}_signed.pdf`, url: URL.createObjectURL(blob) };
    elements.downloadSummary.textContent = `${entry.file.name} is signed and ready.`;
    elements.downloadRow.hidden = false;
    showMessage('Your PDF is signed and ready to download.');
  } catch {
    showMessage('This PDF could not be signed. It may be damaged or password-protected.', true);
  } finally {
    state.isProcessing = false;
    elements.progressRegion.hidden = true;
  }
}

function triggerDownload(url, name) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadResult() {
  if (!state.result) return;
  const { url, name } = state.result;
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  state.result = null;
  state.files = [];
  state.setupPdfBytes = null;
  renderFiles();
  elements.downloadRow.hidden = true;
  showMessage('Download started. Add another PDF when you are ready.');
}

elements.selectPdfs.addEventListener('click', () => elements.pdfInput.click());
elements.dropzone.addEventListener('click', (event) => {
  if (!event.target.closest('button')) elements.pdfInput.click();
});
elements.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); elements.pdfInput.click(); }
});
elements.pdfInput.addEventListener('change', () => { addFiles(elements.pdfInput.files); elements.pdfInput.value = ''; });
for (const eventName of ['dragenter', 'dragover']) elements.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropzone.classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) elements.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropzone.classList.remove('dragging'); });
elements.dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
elements.settingsButton.addEventListener('click', openSetup);
elements.fixPlacementButton.addEventListener('click', () => {
  if (!state.config) {
    showMessage('Set up a signature first, then you can adjust its placement.', true);
    openSetup();
  } else if (!state.files.length) {
    showMessage('Add a PDF first so you can preview its placement.', true);
  } else {
    openSetup();
  }
});
elements.forgetButton.addEventListener('click', async () => {
  if (!window.confirm('Forget the saved signature and placement on this browser?')) return;
  await deleteConfig();
  state.config = null;
  clearResult();
  setStatus('Signature setup needed');
  renderFiles();
  openSetup();
});
elements.signatureInput.addEventListener('change', async () => {
  const file = elements.signatureInput.files[0];
  if (!file) return;
  if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
    elements.setupError.textContent = 'Please choose a PNG image.';
    elements.setupError.hidden = false;
    return;
  }
  state.signatureBytes = await file.arrayBuffer();
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    state.signatureAspect = image.naturalWidth / image.naturalHeight;
    if (state.signatureUrl) URL.revokeObjectURL(state.signatureUrl);
    state.signatureUrl = url;
    elements.setupSignatureImage.src = url;
    elements.signatureFileLabel.textContent = file.name;
    elements.setupOverlay.hidden = false;
    elements.saveSettings.disabled = !state.setupPdfBytes;
    positionSetupOverlay();
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    elements.setupError.textContent = 'This PNG could not be opened. Choose another image.';
    elements.setupError.hidden = false;
  };
  image.src = url;
});
elements.sampleInput.addEventListener('change', async () => {
  const file = elements.sampleInput.files[0];
  if (!file) return;
  state.setupPdfBytes = await file.arrayBuffer();
  elements.sampleFileLabel.textContent = file.name;
  elements.setupError.hidden = true;
  await renderSetupPreview();
  elements.saveSettings.disabled = !state.signatureBytes || elements.setupPreview.hidden;
});
elements.setupOverlay.addEventListener('pointerdown', setupDrag);
elements.saveSettings.addEventListener('click', saveSettings);
elements.cancelSetup.addEventListener('click', () => elements.setupDialog.close());
elements.downloadButton.addEventListener('click', downloadResult);

async function initialize() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => {});
  }
  try {
    state.config = await readConfig();
    if (state.config) {
      state.signatureAspect = state.config.signatureAspect;
      setStatus('Signature Ready', true);
    } else {
      setStatus('Signature setup needed');
      openSetup();
    }
    renderFiles();
  } catch {
    setStatus('Signature setup needed');
    showMessage('This browser could not open local signature storage. Enable site storage and reload.', true);
  }
}

initialize();
