// ============ IMAGE PROCESSING MODULE (Optimized) ============

import { t as tr, tc } from './utils.js';

// State
let allImages = [], activeImageId = null, pdfOrder = [], pdfDocs = [];

// Constants
const SUPPORTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/bmp', 'image/avif'];
// A4 in PostScript points (1 pt = 1/72 in) + the 10 mm margin used by the image path.
const MM_TO_PT = 72 / 25.4;
const A4_WIDTH_PT = 595.28, A4_HEIGHT_PT = 841.89, A4_MARGIN_PT = 10 * MM_TO_PT;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const isPdfFile = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
const getPdfLib = () => window.PDFLib || null;
const BACKGROUND_REMOVAL_BASE_CONFIG = Object.freeze({
  rescale: true,
  output: { format: 'image/png', quality: 1 }
});

// Background Removal State
let bgWarmupPromise = null, bgWorker = null, bgWorkerUrl = null, bgTaskSeq = 0;
const bgJobs = new Map();
let compressionTimeout = null;
let compressionTaskSeq = 0;

// ============ UTILITIES ============
const generateId = () => 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const getActive = () => allImages.find(i => i.id === activeImageId);
// An item of the PDF list can be an image (from allImages) or an imported PDF document.
const pdfItemById = (id) => allImages.find(i => i.id === id) || pdfDocs.find(i => i.id === id);
const getDisplaySrc = (img) => img.compressionPreview || img.processed || img.url;
const supportsWebGpu = () => typeof navigator !== 'undefined' && !!navigator.gpu;
function getBackgroundRemovalConfig() {
  const useGpu = supportsWebGpu();
  return {
    ...BACKGROUND_REMOVAL_BASE_CONFIG,
    device: useGpu ? 'gpu' : 'cpu',
    model: useGpu ? 'isnet_fp16' : 'isnet_quint8',
    proxyToWorker: useGpu
  };
}
const getExt = (img) => {
  const fmt = $('#imgFormatSelect')?.value;
  if (fmt && fmt !== 'original') return fmt;
  const ext = img.name.split('.').pop().toLowerCase();
  return ['png','jpg','jpeg','webp','gif'].includes(ext) ? ext : 'png';
};

// Button factory
const createBtn = (cls, icon, onclick, title = '') => 
  Object.assign(document.createElement('button'), {
    className: cls, title, type: 'button',
    innerHTML: icon.startsWith('fa-') ? `<i class="fas ${icon}"></i>` : icon,
    onclick
  });

// Unified image processing (resize + format + quality)
const processImage = (src, { w, h, format, quality = 1, rotation = 0 } = {}) => new Promise(resolve => {
  const img = new Image();
  img.onload = () => {
    const normalizedRotation = ((rotation % 360) + 360) % 360;
    const quarterTurns = normalizedRotation / 90;
    const isQuarterTurn = Number.isInteger(quarterTurns) && quarterTurns % 2 !== 0;
    const canvasWidth = w || img.width;
    const canvasHeight = h || img.height;
    const canvas = Object.assign(document.createElement('canvas'), {
      width: isQuarterTurn ? canvasHeight : canvasWidth,
      height: isQuarterTurn ? canvasWidth : canvasHeight
    });
    const ctx = canvas.getContext('2d');
    
    // Normalize format
    let mime = format || 'image/png';
    if (mime && !mime.includes('/')) {
      mime = `image/${mime.replace('jpg', 'jpeg')}`;
    }
    
    // If quality < 1 and format is PNG, we must use a lossy format (JPEG/WebP)
    if (quality < 1 && mime === 'image/png') {
      mime = 'image/jpeg';
    }

    // Handle background for JPEG (transparency to white)
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (normalizedRotation) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((normalizedRotation * Math.PI) / 180);
      ctx.drawImage(img, -canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
    } else {
      ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
    }
    canvas.toBlob(blob => resolve(blob), mime, quality);
  };
  img.onerror = () => resolve(null);
  img.src = src;
});

// ============ BACKGROUND REMOVAL WORKER ============
function getBgWorker() {
  if (bgWorker) return Promise.resolve(bgWorker);
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Web Workers not supported'));

  if (!bgWorkerUrl) {
    const code = `
      import { removeBackground, preload } from "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
      let warmupP = null;
      const getCfg = c => c || { rescale:true, output:{format:'image/png',quality:1}, device:'cpu', model:'isnet_quint8', proxyToWorker:false };
      
      self.onmessage = async e => {
        const { id, type, file, config } = e.data || {};
        if (type === 'warmup') {
          const startedAt = performance.now();
          try {
            warmupP = warmupP || preload(getCfg(config)).catch(() => warmupP = null);
            await warmupP;
            self.postMessage({ id, type:'warmup-done', ms: performance.now() - startedAt });
          } catch(err) {
            self.postMessage({ id, type:'error', error:err?.message });
          }
          return;
        }
        if (type !== 'remove') return;
        const startedAt = performance.now();
        try {
          const blob = await removeBackground(file, {
            ...getCfg(config),
            progress: (stage, cur, total) => self.postMessage({ id, type:'progress', stage, cur, total })
          });
          self.postMessage({ id, type:'done', blob, ms: performance.now() - startedAt });
        } catch(err) {
          self.postMessage({ id, type:'error', error:err?.message });
        }
      };`;
    bgWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }

  bgWorker = new Worker(bgWorkerUrl, { type: 'module' });
  
  bgWorker.onmessage = e => {
    const { id, type, stage, cur, total, blob, error, ms } = e.data || {};
    const job = bgJobs.get(id);
    if (!job) return;
    
    if (type === 'progress') {
      const rawPct = total > 0 ? Math.round((cur / total) * 100) : 0;
      const pct = Math.max(job.img.progress || 0, rawPct);
      job.img.progress = pct;
      updateBgProgressUI(job.img);
      return;
    }
    
    bgJobs.delete(id);
    if (type === 'done') {
      job.resolve({ blob, ms });
    } else {
      job.reject(new Error(error));
    }
  };
  
  bgWorker.onerror = () => {
    [...bgJobs.values()].forEach(j => j.reject(new Error('Worker crashed')));
    bgJobs.clear(); bgWorker?.terminate(); bgWorker = null; bgWarmupPromise = null;
  };
  
  return Promise.resolve(bgWorker);
}

function warmupBg() {
  bgWarmupPromise = bgWarmupPromise || getBgWorker()
    .then(w => new Promise((resolve, reject) => {
      const id = ++bgTaskSeq;
      const handler = e => {
        if (e.data?.id !== id) return;
        w.removeEventListener('message', handler);
        if (e.data?.type === 'warmup-done') {
          if (typeof e.data?.ms === 'number') {
            console.info(`[bg-removal] warmup ${Math.round(e.data.ms)} ms`);
          }
          resolve();
        } else {
          reject(new Error(e.data?.error));
        }
      };
      w.addEventListener('message', handler);
      w.postMessage({ id, type:'warmup', config: getBackgroundRemovalConfig() });
    }))
    .catch(() => { bgWarmupPromise = null; });
  return bgWarmupPromise;
}

async function removeBg(file, img) {
  const worker = await getBgWorker();
  const id = ++bgTaskSeq;
  return new Promise((resolve, reject) => {
    bgJobs.set(id, { img, resolve, reject });
    worker.postMessage({ id, type:'remove', file, config: getBackgroundRemovalConfig() });
  });
}

function updateBgProgressUI(img) {
  const pct = img.progress || 0;
  if (activeImageId === img.id) {
    const bar = $('#imgBgProgressBar'), text = $('#imgBgProgressText');
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = pct + '%';
    $('#imgBgProgress').style.display = 'block';
  }
  const thumb = $(`.gallery-thumb[data-id="${img.id}"]`);
  if (thumb) {
    const tBar = thumb.querySelector('.thumb-progress-bar');
    const tText = thumb.querySelector('.thumb-progress-text');
    if (tBar) tBar.style.width = pct + '%';
    if (tText) tText.textContent = pct + '%';
  }
}

// ============ IMAGE LOADING ============
function loadImageData(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => resolve({
      id: generateId(), file, url, name: file.name,
      width: img.width, height: img.height,
      originalWidth: img.width, originalHeight: img.height,
      processed: null, processedSize: null, compressionPreview: null, rotation: 0, cropData: null,
      history: [], isProcessing: false, progress: 0,
      currentSize: file.size
    });
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

async function handleFiles(files, target = 'editor') {
  // Sequential on purpose: pdfOrder must follow the order the files were dropped in.
  let addedPdf = false, handled = 0;

  for (const file of [...files]) {
    if (isPdfFile(file)) {
      handled++;
      addedPdf = (await addPdfFiles([file])) || addedPdf;
      continue;
    }
    if (!SUPPORTED_FORMATS.includes(file.type)) continue;
    handled++;

    const name = file.name.toLowerCase().replace(/\.heic$/i, '.png');
    if (allImages.some(i => i.name.toLowerCase() === name)) continue;

    let f = file;
    if (file.name.toLowerCase().endsWith('.heic')) {
      try {
        const blob = await heic2any({ blob: file, toType: 'image/png' });
        f = new File([blob], name, { type: 'image/png' });
      } catch (e) { console.error('HEIC failed:', e); continue; }
    }

    const data = await loadImageData(f);
    if (!data) continue;
    
    allImages.push(data);
    if (!pdfOrder.includes(data.id)) pdfOrder.push(data.id);
  }

  if (!handled) return;

  updateAllViews();
  if (target === 'editor' && !activeImageId && allImages.length) selectImage(allImages[0].id);
  // PDFs only exist in the PDF view: jump there so the user sees what was added.
  if (addedPdf) window.switchImgView?.('pdf');
}

// ============ PDF DOCUMENTS ============
async function addPdfFiles(files) {
  if (!files.length) return false;
  const PDFLib = getPdfLib();
  if (!PDFLib?.PDFDocument) {
    alert(tr('pdf.error_lib'));
    return false;
  }

  let added = false;
  for (const file of files) {
    if (pdfDocs.some(d => d.name.toLowerCase() === file.name.toLowerCase())) continue;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      const item = {
        id: generateId(), isPdf: true, file, doc,
        name: file.name, pageCount: doc.getPageCount(),
        width: 0, height: 0, rotation: 0
      };
      pdfDocs.push(item);
      pdfOrder.push(item.id);
      added = true;
    } catch (e) {
      console.error('PDF load failed:', file.name, e);
      const key = /encrypt/i.test(String(e?.message)) ? 'pdf.error_encrypted' : 'pdf.error_read';
      alert(tr(key, { name: file.name }));
    }
  }
  return added;
}

// ============ UI UPDATES ============
function updateAllViews() {
  $('#imgInitialState').style.display = allImages.length ? 'none' : 'flex';
  $('#imgEditorLayout').style.display = allImages.length ? 'grid' : 'none';
  renderGallery(); renderPreview(); renderPdfGrid();
  $('#imgCountBadge').textContent = allImages.length;
  updatePdfBtn();
}

function updateOptionsPanel() {
  const img = getActive();
  if ($('#imgWidthInput')) $('#imgWidthInput').value = img?.width || '';
  if ($('#imgHeightInput')) $('#imgHeightInput').value = img?.height || '';
  $$('#imgRemoveBgBtn, #imgWatermarkBtn').forEach(b => b.disabled = !img || img.isProcessing);
}

// ============ THUMBNAIL RENDERING ============
function createThumb(img, cls = '') {
  const div = document.createElement('div');
  div.className = `gallery-thumb ${cls} ${img.id === activeImageId ? 'active' : ''} ${img.isProcessing ? 'processing' : ''}`;
  div.dataset.id = img.id;
  div.innerHTML = `
    <img src="${getDisplaySrc(img)}" alt="${img.name}" draggable="false"
         style="transform: rotate(${img.rotation || 0}deg)">
    ${img.isProcessing ? `
      <div class="thumb-progress-overlay">
        <div class="thumb-progress-bar" style="width:${img.progress}%"></div>
        <span class="thumb-progress-text">${img.progress}%</span>
      </div>` : ''}
    <div class="thumb-info">${img.width}x${img.height}</div>
  `;
  div.append(
    createBtn('thumb-remove', 'fa-times', e => { e.stopPropagation(); deleteImg(img.id); }, tr('pdf.delete')),
    createBtn('thumb-rotate', '↻', e => { e.stopPropagation(); rotateImg(img.id); }, tr('pdf.rotate'))
  );
  div.onclick = () => selectImage(img.id);
  return div;
}

function renderGallery() {
  const list = $('#imgGalleryList');
  if (!list) return;
  list.innerHTML = '';
  allImages.forEach(img => list.appendChild(createThumb(img)));
}

function renderPdfGrid() {
  const grid = $('#imgPdfGrid');
  if (!grid) return;
  grid.innerHTML = pdfOrder.length ? '' : `<div class="img-pdf-empty">${tr('pdf.no_images')}</div>`;

  pdfOrder.forEach(id => {
    const item = pdfItemById(id);
    if (!item) return;
    grid.appendChild(item.isPdf ? createPdfDocThumb(item) : makePdfThumb(createThumb(item, 'img-pdf-thumb'), id));
  });
}

// Drag & drop reordering shared by image and PDF thumbnails.
function makePdfThumb(thumb, id) {
  thumb.draggable = true;
  thumb.ondragstart = e => { thumb.classList.add('dragging'); e.dataTransfer.setData('text/plain', id); };
  thumb.ondragend = () => thumb.classList.remove('dragging');
  thumb.ondragover = e => e.preventDefault();
  thumb.ondrop = e => {
    e.preventDefault();
    const from = e.dataTransfer.getData('text/plain');
    const i1 = pdfOrder.indexOf(from), i2 = pdfOrder.indexOf(id);
    if (i1 > -1 && i2 > -1 && i1 !== i2) {
      pdfOrder.splice(i2, 0, pdfOrder.splice(i1, 1)[0]);
      renderPdfGrid();
    }
  };
  return thumb;
}

function createPdfDocThumb(item) {
  const div = document.createElement('div');
  div.className = 'gallery-thumb img-pdf-thumb pdf-doc-thumb';
  div.dataset.id = item.id;
  div.title = item.name;
  div.innerHTML = `
    <div class="pdf-doc-body">
      <i class="fas fa-file-pdf"></i>
      <span class="pdf-doc-name"></span>
      <span class="pdf-doc-pages"></span>
    </div>`;
  div.querySelector('.pdf-doc-name').textContent = item.name;
  div.querySelector('.pdf-doc-pages').textContent = tc('pdf.doc_pages_one', 'pdf.doc_pages_other', item.pageCount);
  div.append(createBtn('thumb-remove', 'fa-times', e => { e.stopPropagation(); deletePdfItem(item.id); }, tr('pdf.delete')));
  return makePdfThumb(div, item.id);
}

// ============ IMAGE OPERATIONS ============
function selectImage(id) {
  // Optional: Revoke previous image preview to save memory
  const prev = getActive();
  if (prev && prev.id !== id && prev.compressionPreview) {
    URL.revokeObjectURL(prev.compressionPreview);
    prev.compressionPreview = null;
  }
  
  activeImageId = id;
  const img = getActive();
  if ($('#imgQualitySlider')) {
    $('#imgQualitySlider').value = 100;
    $('#imgQualityValue').textContent = '100%';
  }
  if ($('#imgTargetSizeInput') && img) {
    const kb = Math.round((img.processedSize || img.file.size) / 1024);
    $('#imgTargetSizeInput').value = '';
    $('#imgTargetSizeInput').max = kb;
    $('#imgTargetSizeInput').placeholder = kb;
  }
  renderGallery(); renderPreview(); updateOptionsPanel();
}

function deleteImg(id) {
  const idx = allImages.findIndex(i => i.id === id);
  if (idx === -1) return;
  const img = allImages[idx];
  img.url && URL.revokeObjectURL(img.url);
  img.processed && URL.revokeObjectURL(img.processed);
  img.compressionPreview && URL.revokeObjectURL(img.compressionPreview);
  allImages.splice(idx, 1);
  pdfOrder = pdfOrder.filter(i => i !== id);
  if (activeImageId === id) activeImageId = allImages[0]?.id || null;
  updateAllViews();
}

function deletePdfItem(id) {
  const before = pdfDocs.length;
  pdfDocs = pdfDocs.filter(d => d.id !== id);
  if (pdfDocs.length === before) return;
  pdfOrder = pdfOrder.filter(i => i !== id);
  renderPdfGrid();
  updatePdfBtn();
}

async function rotateImg(id) {
  const img = allImages.find(i => i.id === id);
  if (!img) return;
  
  const format = $('#imgFormatSelect')?.value;
  const targetFormat = (!format || format === 'original') ? img.file.type : format;
  const q = 1;

  const blob = await processImage(img.processed || img.url, {
    w: img.width, h: img.height,
    format: targetFormat,
    quality: q,
    rotation: 90
  });
  
  if (blob) {
    img.processed && URL.revokeObjectURL(img.processed);
    img.processed = URL.createObjectURL(blob);
    img.processedSize = blob.size;
    img.currentSize = blob.size;
    
    // Reset preview on structural change
    if (img.compressionPreview) {
      URL.revokeObjectURL(img.compressionPreview);
      img.compressionPreview = null;
    }

    [img.width, img.height] = [img.height, img.width];
    img.rotation = 0;
    updateAllViews();
  }
}

function renderPreview() {
  const preview = $('#imgPreview'), container = $('#imgPreviewContainer');
  const img = getActive();
  
  if (!img) {
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    if (container) container.classList.add('empty');
    if ($('#imgDownloadBtn')) $('#imgDownloadBtn').disabled = true;
    return;
  }
  
  if (preview) {
    preview.src = getDisplaySrc(img);
    preview.style.display = 'block';
    preview.style.transform = `rotate(${img.rotation || 0}deg)`;
    preview.style.opacity = img.isProcessing ? '0.5' : '1';
  }
  if (container) container.classList.remove('empty');
  if ($('#imgDownloadBtn')) $('#imgDownloadBtn').disabled = false;
  
  const sizeEl = $('#imgOriginalSizeValue');
  if (sizeEl && img.file) {
    const origKB = Math.round(img.file.size / 1024);
    const currKB = Math.round((img.currentSize || img.file.size) / 1024);
    sizeEl.innerHTML = `${origKB} KB ${currKB !== origKB ? `→ <strong>${currKB} KB</strong>` : ''}`;
  }
  
  // Progress
  const progress = $('#imgBgProgress');
  if (progress) progress.style.display = img.isProcessing ? 'block' : 'none';
  if (img.isProcessing) updateBgProgressUI(img);
}

// ============ FORMAT, RESIZE & COMPRESSION ============
async function applyFormatConversion() {
  const img = getActive();
  if (!img) return;
  const format = $('#imgFormatSelect')?.value;
  const targetFormat = (!format || format === 'original') ? img.file.type : format;
  const q = 1;
  
  const blob = await processImage(img.processed || img.url, {
    w: img.width, h: img.height,
    format: targetFormat, 
    quality: q
  });
  
  if (blob) {
    img.processed && URL.revokeObjectURL(img.processed);
    img.processed = URL.createObjectURL(blob);
    img.processedSize = blob.size;
    img.currentSize = blob.size;
    
    // Reset preview on structural change
    if (img.compressionPreview) {
      URL.revokeObjectURL(img.compressionPreview);
      img.compressionPreview = null;
    }

    updateAllViews();
  }
}


async function applyCompression(isRealTime = false, source = 'slider') {
  const img = getActive();
  if (!img) return;

  const targetKB = (source === 'kb') ? parseInt($('#imgTargetSizeInput')?.value || 0) : 0;
  const quality = (source === 'slider') ? parseInt($('#imgQualitySlider')?.value || 100) / 100 : 0;
  
  clearTimeout(compressionTimeout);
  if (isRealTime) {
    compressionTimeout = setTimeout(() => {
      void executeCompression(img, quality, targetKB, source).catch(err => console.error('Compression failed:', err));
    }, 150);
  } else {
    void executeCompression(img, quality, targetKB, source).catch(err => console.error('Compression failed:', err));
  }
}

async function executeCompression(img, q, targetKB, source) {
  const taskId = ++compressionTaskSeq;
  const format = $('#imgFormatSelect')?.value;
  const targetFormat = (!format || format === 'original') ? img.file.type : format;
  const sourceSize = img.processedSize || img.file.size;
  const sourceSrc = img.processed || img.url;
  
  // Reset if max quality and no target size
  if (source === 'slider' && q >= 1) {
    if (img.compressionPreview) {
      URL.revokeObjectURL(img.compressionPreview);
      img.compressionPreview = null;
      img.currentSize = sourceSize;
    }
    return updateAllViews();
  }

  let finalBlob = null;
  
  if (source === 'kb' && targetKB > 0) {
    // Binary search for target quality with the closest blob as fallback.
    let minQ = 0.01, maxQ = 1, bestQ = 1;
    let bestBlob = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    let attempts = 0;
    const targetBytes = targetKB * 1024;

    while (attempts < 10 && taskId === compressionTaskSeq) {
      const currentQ = (minQ + maxQ) / 2;
      const blob = await processImage(sourceSrc, { 
        w: img.width, h: img.height, format: targetFormat, quality: currentQ 
      });
      if (!blob) break;
      
      const diff = Math.abs(blob.size - targetBytes);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestBlob = blob;
        bestQ = currentQ;
      }

      if (blob.size > targetBytes) {
        maxQ = currentQ;
      } else {
        minQ = currentQ;
      }

      attempts++;
    }
    finalBlob = bestBlob;
    // Update slider visually
    if ($('#imgQualitySlider')) {
       $('#imgQualitySlider').value = Math.round(bestQ * 100);
       $('#imgQualityValue').textContent = $('#imgQualitySlider').value + '%';
    }
  } else {
    // Quality slider source
    const quality = source === 'slider' ? q : (parseInt($('#imgQualitySlider')?.value || 100) / 100);
    finalBlob = await processImage(sourceSrc, { 
      w: img.width, h: img.height, format: targetFormat, quality: quality 
    });
  }

  if (taskId !== compressionTaskSeq) return;

  if (finalBlob) {
    // Strictly cap at source size
    if (finalBlob.size > sourceSize) {
      if (img.compressionPreview) {
        URL.revokeObjectURL(img.compressionPreview);
        img.compressionPreview = null;
      }
      img.currentSize = sourceSize;
    } else {
      img.compressionPreview && URL.revokeObjectURL(img.compressionPreview);
      img.compressionPreview = URL.createObjectURL(finalBlob);
      img.currentSize = finalBlob.size;
    }
    updateAllViews();
  }
}

// ============ BACKGROUND REMOVAL ============
async function backgroundRemoval() {
  const img = getActive();
  if (!img || img.isProcessing) return;
  
  img.isProcessing = true; img.progress = 0;
  updateAllViews(); updateOptionsPanel();
  await nextFrame();
  warmupBg();
  
  try {
    const source = img.processed || img.url || img.file;
    const startedAt = performance.now();
    const result = await removeBg(source, img);
    if (result?.blob) {
      img.processed && URL.revokeObjectURL(img.processed);
      img.processed = URL.createObjectURL(result.blob);
      img.processedSize = result.blob.size;
      img.currentSize = result.blob.size;
      
      // Reset preview on structural change
      if (img.compressionPreview) {
        URL.revokeObjectURL(img.compressionPreview);
        img.compressionPreview = null;
      }

      img.progress = 100;
      updateBgProgressUI(img);
      console.info(`[bg-removal] image ${img.name} ${Math.round(result.ms || (performance.now() - startedAt))} ms`);
    }
  } catch (e) {
    console.error('Background removal failed:', e);
    alert('Error al eliminar el fondo. Inténtalo de nuevo.');
  } finally {
    img.isProcessing = false;
    updateAllViews(); updateOptionsPanel();
  }
}

// ============ PDF ============
function removeFromPdf(id) { pdfOrder = pdfOrder.filter(i => i !== id); renderPdfGrid(); updatePdfBtn(); }
function clearAllPdf() { pdfOrder = []; pdfDocs = []; renderPdfGrid(); updatePdfBtn(); }
function updatePdfBtn() { if ($('#imgConvertPdfBtn')) $('#imgConvertPdfBtn').disabled = !pdfOrder.length; }

const sanitizeFileName = (name) => {
  const clean = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return clean || 'documento';
};

// Contain-fit placement for a page that may carry its own /Rotate.
// pdf-lib does not bake the source /Rotate when embedding a page, so the
// rotation is re-applied here and the anchor compensates for it.
function fitRotatedPage(page, targetW, targetH, margin) {
  const { width: w, height: h } = page.getSize();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const swapped = angle % 180 !== 0;
  const visualW = swapped ? h : w;
  const visualH = swapped ? w : h;
  const innerW = targetW - margin * 2, innerH = targetH - margin * 2;
  const scale = Math.min(innerW / visualW, innerH / visualH);
  const boxW = w * scale, boxH = h * scale;
  const originX = margin + (innerW - visualW * scale) / 2;
  const originY = margin + (innerH - visualH * scale) / 2;
  const anchors = {
    90: [originX + boxH, originY],
    180: [originX + boxW, originY + boxH],
    270: [originX, originY + boxW]
  };
  const [x, y] = anchors[angle] || [originX, originY];
  return { x, y, width: boxW, height: boxH, rotate: window.PDFLib.degrees(angle) };
}

// Images -> one jsPDF page each (same layout rules as before).
// Returns the jsPDF document plus the page index of every image.
async function buildImagePages(items, isA4) {
  const { jsPDF } = window.jspdf;
  let doc = null;
  const pageIndex = new Map();

  for (const item of items) {
    const loaded = await new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const rot = item.rotation || 0;
        const w = rot % 180 ? image.height : image.width;
        const h = rot % 180 ? image.width : image.height;

        if (isA4) {
          if (!doc) doc = new jsPDF('p', 'mm', 'a4');
          else doc.addPage();
          const r = Math.min(190 / w, 277 / h);
          doc.addImage(getDisplaySrc(item), 'PNG', 10, 10, w * r, h * r, null, 'FAST', rot);
        } else {
          const tw = 210, th = (h / w) * tw;
          // jsPDF flips a page whose aspect does not match the document orientation,
          // so the orientation must be passed explicitly for every page: a mixed
          // portrait/landscape batch would otherwise swap the later pages.
          const orientation = tw > th ? 'l' : 'p';
          if (!doc) doc = new jsPDF({ orientation, unit: 'mm', format: [tw, th] });
          else doc.addPage([tw, th], orientation);
          doc.addImage(getDisplaySrc(item), 'PNG', 0, 0, tw, th, null, 'FAST', rot);
        }
        resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = getDisplaySrc(item);
    });

    if (loaded) pageIndex.set(item.id, doc.getNumberOfPages() - 1);
  }

  return { doc, pageIndex };
}

async function convertToPdf() {
  if (!pdfOrder.length) return;
  const { jsPDF } = window.jspdf || {};
  const PDFLib = getPdfLib();
  if (!jsPDF || !PDFLib?.PDFDocument) return alert(tr('pdf.error_lib'));

  const btn = $('#imgConvertPdfBtn');
  const previousLabel = btn ? btn.innerHTML : '';
  const isA4 = ($('input[name="imgPdfFormat"]:checked')?.value || 'uniform') === 'a4';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>${tr('pdf.generating')}</span>`;
  }

  try {
    // 1) Images become pages of an intermediate jsPDF document.
    const imageItems = pdfOrder.map(pdfItemById).filter(item => item && !item.isPdf);
    const { doc: jsPdfDoc, pageIndex } = await buildImagePages(imageItems, isA4);
    const imageSource = jsPdfDoc ? await PDFLib.PDFDocument.load(jsPdfDoc.output('arraybuffer')) : null;

    // 2) Assemble with pdf-lib following the drag & drop order.
    const out = await PDFLib.PDFDocument.create();
    for (const id of pdfOrder) {
      const item = pdfItemById(id);
      if (!item) continue;

      if (item.isPdf) {
        const src = item.doc;
        if (isA4) {
          // Re-layout every page on an A4 sheet with a 10 mm margin.
          for (const page of src.getPages()) {
            const target = out.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
            target.drawPage(await out.embedPage(page), fitRotatedPage(page, A4_WIDTH_PT, A4_HEIGHT_PT, A4_MARGIN_PT));
          }
        } else {
          // Exact copy: keeps text, vectors and the original page size.
          const copied = await out.copyPages(src, src.getPageIndices());
          copied.forEach(page => out.addPage(page));
        }
      } else if (imageSource && pageIndex.has(id)) {
        const [page] = await out.copyPages(imageSource, [pageIndex.get(id)]);
        out.addPage(page);
      }
    }

    if (!out.getPageCount()) { alert(tr('pdf.error_empty')); return; }

    const bytes = await out.save();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `${sanitizeFileName($('#imgPdfFilename')?.value)}.pdf`
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    console.error('PDF generation failed:', e);
    alert(tr('pdf.error_generic', { error: e?.message || e }));
  } finally {
    if (btn) { btn.disabled = !pdfOrder.length; btn.innerHTML = previousLabel; }
  }
}

// ============ DOWNLOAD ============
function downloadImg(img) {
  const a = Object.assign(document.createElement('a'), {
    href: getDisplaySrc(img),
    download: `${img.name.replace(/\.[^.]+$/, '')}.${getExt(img)}`
  });
  a.click();
}

function downloadImage() { const img = getActive(); if (img) downloadImg(img); }

function downloadAllImages() { allImages.forEach((img, i) => setTimeout(() => downloadImg(img), i * 500)); }

function clearAllImages() {
  allImages.forEach(img => { img.url && URL.revokeObjectURL(img.url); img.processed && URL.revokeObjectURL(img.processed); });
  allImages = []; activeImageId = null; pdfOrder = []; pdfDocs = [];
  updateAllViews(); updateOptionsPanel();
}

// ============ SETUP ============
function setupDropZone() {
  const zone = $('#imgDropZone');
  if (!zone) return;
  
  zone.onclick = () => $('#imgFileInput').click();
  ['dragover', 'dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.toggle('drag-over', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'editor');
  }));

  window.addEventListener('dragover', e => e.dataTransfer.types.includes('Files') && e.preventDefault());
  window.addEventListener('drop', e => {
    if (!e.dataTransfer.files.length || e.dataTransfer.types.includes('text/html')) return;
    if (e.target.closest('.img-preview-container,.img-gallery,.img-pdf-grid,.gallery-thumb,.img-pdf-thumb,img,canvas')) return;
    e.preventDefault();
    const hasSupported = [...e.dataTransfer.files].some(f => f.type.startsWith('image/') || isPdfFile(f));
    if (hasSupported && $('.nav-btn.active')?.dataset.tab === 'imgpdf') {
      handleFiles(e.dataTransfer.files, $('.img-toolbar-btn.active')?.dataset.imgView === 'pdf' ? 'pdf' : 'editor');
    }
  });
}

function setupMiniDropZones() {
  ['#imgMiniDropZone', '#imgCompactDropZone'].forEach(sel => {
    const zone = $(sel);
    if (!zone) return;
    zone.onclick = e => { e.stopPropagation(); $('#imgFileInput').click(); };
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'editor');
    });
  });
}

function setupFileInput() {
  $('#imgFileInput')?.addEventListener('change', e => {
    if (e.target.files.length) handleFiles(e.target.files, 'editor');
    e.target.value = '';
  });
}

function setupOptionsPanel() {
  $('#imgFormatSelect')?.addEventListener('change', applyFormatConversion);
  
  $('#imgKeepAspectCheck')?.addEventListener('change', () => {
    if ($('#imgAspectLockIcon')) $('#imgAspectLockIcon').className = $('#imgKeepAspectCheck').checked ? 'fas fa-lock' : 'fas fa-lock-open';
  });
  
  // Dimension inputs
  $('#imgWidthInput')?.addEventListener('input', () => {
    const img = getActive();
    if (img && $('#imgKeepAspectCheck')?.checked) {
      $('#imgHeightInput').value = Math.round($('#imgWidthInput').value / (img.originalWidth / img.originalHeight));
    }
  });
  
  $('#imgHeightInput')?.addEventListener('input', () => {
    const img = getActive();
    if (img && $('#imgKeepAspectCheck')?.checked) {
      $('#imgWidthInput').value = Math.round($('#imgHeightInput').value * (img.originalWidth / img.originalHeight));
    }
  });
  
  // Quality slider
  if ($('#imgQualitySlider')) {
    $('#imgQualitySlider').addEventListener('input', () => {
      $('#imgQualityValue').textContent = $('#imgQualitySlider').value + '%';
      applyCompression(true, 'slider');
    });
    $('#imgQualitySlider').addEventListener('change', () => applyCompression(false, 'slider'));
  }
  
  // Target KB input
  $('#imgTargetSizeInput')?.addEventListener('input', () => {
    const rawValue = $('#imgTargetSizeInput').value;
    if (rawValue === '') {
      clearTimeout(compressionTimeout);
      return;
    }

    if (Number.isNaN(parseInt(rawValue)) || parseInt(rawValue) < 1) {
      clearTimeout(compressionTimeout);
      return;
    }
  });
  
  $('#imgTargetSizeInput')?.addEventListener('change', () => applyCompression(false, 'kb'));
  
  $('#imgRemoveBgBtn')?.addEventListener('click', backgroundRemoval);
}

function setupPreviewActions() {
  $('#imgDownloadBtn')?.addEventListener('click', downloadImage);
  $('#imgDownloadAllBtn')?.addEventListener('click', downloadAllImages);
  $('#imgClearAllBtn')?.addEventListener('click', clearAllImages);
}

function setupPdfConvert() {
  $('#imgConvertPdfBtn')?.addEventListener('click', convertToPdf);
  $('#imgPdfClearAllBtn')?.addEventListener('click', clearAllPdf);
  
  const pdfZone = $('#imgPdfDropZone');
  if (!pdfZone) return;
  
  pdfZone.onclick = () => $('#imgPdfFileInput').click();
  pdfZone.addEventListener('dragover', e => { e.preventDefault(); pdfZone.querySelector('.upload-zone')?.classList.add('drag-over'); });
  pdfZone.addEventListener('dragleave', () => pdfZone.querySelector('.upload-zone')?.classList.remove('drag-over'));
  pdfZone.addEventListener('drop', e => {
    e.preventDefault();
    pdfZone.querySelector('.upload-zone')?.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'pdf');
  });
  
  $('#imgPdfFileInput')?.addEventListener('change', e => {
    if (e.target.files.length) handleFiles(e.target.files, 'pdf');
    e.target.value = '';
  });
}

function setupImageViewer() {
  const viewer = $('#imageViewer'), lightbox = $('#lightboxImage'), preview = $('#imgPreview');
  if (!viewer || !lightbox || !preview) return;
  
  preview.addEventListener('dblclick', () => {
    if (!preview.src || preview.src.endsWith('#')) return;
    lightbox.src = preview.src;
    viewer.classList.add('active');
  });
  
  const hide = () => {
    viewer.classList.remove('active');
    setTimeout(() => lightbox.src = '', 300);
  };
  
  $('#closeImageViewer').onclick = hide;
  viewer.onclick = e => { if (e.target === viewer || e.target.id === 'imageViewerContent') hide(); };
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && viewer.classList.contains('active')) hide(); });
}

// ============ INIT ============
function initImgModule() {
  setupDropZone();
  setupFileInput();
  setupMiniDropZones();
  setupOptionsPanel();
  setupPreviewActions();
  setupPdfConvert();
  setupImageViewer();
  warmupBg();
  
  window.switchImgView = view => {
    $$('.img-toolbar-btn').forEach(b => b.classList.toggle('active', b.dataset.imgView === view));
    const editor = $('#imgEditorView'), pdf = $('#imgPdfView');
    if (editor) editor.style.display = view === 'editor' ? 'block' : 'none';
    if (pdf) pdf.style.display = view === 'pdf' ? 'block' : 'none';
  };
}

export { initImgModule };
