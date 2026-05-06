// ============ IMAGE PROCESSING MODULE (Optimized) ============

// State
let allImages = [], activeImageId = null, pdfImageOrder = [];

// Constants
const SUPPORTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/bmp', 'image/avif'];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const BACKGROUND_REMOVAL_CONFIG = Object.freeze({
  device: 'cpu', model: 'isnet_quint8', rescale: true,
  output: { format: 'image/png', quality: 1 }
});

// Background Removal State
let bgWarmupPromise = null, bgWorker = null, bgWorkerUrl = null, bgTaskSeq = 0;
const bgJobs = new Map();
let compressionTimeout = null;

// ============ UTILITIES ============
const generateId = () => 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const getActive = () => allImages.find(i => i.id === activeImageId);
const getDisplaySrc = (img) => img.compressionPreview || img.processed || img.url;
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
const processImage = (src, { w, h, format, quality = 1 } = {}) => new Promise(resolve => {
  const img = new Image();
  img.onload = () => {
    const canvas = Object.assign(document.createElement('canvas'), {
      width: w || img.width, height: h || img.height
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

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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
      const getCfg = c => c || { device:'cpu', model:'isnet_quint8', rescale:true, output:{format:'image/png',quality:1} };
      
      self.onmessage = async e => {
        const { id, type, file, config } = e.data || {};
        if (type === 'warmup') {
          try { warmupP = warmupP || preload(getCfg(config)).catch(() => warmupP = null);
            await warmupP; self.postMessage({ id, type:'warmup-done' });
          } catch(err) { self.postMessage({ id, type:'error', error:err?.message }); }
          return;
        }
        if (type !== 'remove') return;
        try {
          const blob = await removeBackground(file, {
            ...getCfg(config),
            progress: (stage, cur, total) => self.postMessage({ id, type:'progress', stage, cur, total })
          });
          self.postMessage({ id, type:'done', blob });
        } catch(err) { self.postMessage({ id, type:'error', error:err?.message }); }
      };`;
    bgWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }

  bgWorker = new Worker(bgWorkerUrl, { type: 'module' });
  
  bgWorker.onmessage = e => {
    const { id, type, stage, cur, total, blob, error } = e.data || {};
    const job = bgJobs.get(id);
    if (!job) return;
    
    if (type === 'progress') {
      const pct = Math.max(job.img.progress || 0, 
        stage?.startsWith('fetch:') ? Math.min(70, (cur/total)*70) :
        stage === 'compute:decode' ? 72 : stage === 'compute:inference' ? 84 :
        stage === 'compute:mask' ? 92 : stage === 'compute:encode' ? 96 + (cur/total)*4 :
        (cur/total)*100);
      job.img.progress = Math.round(pct);
      updateBgProgressUI(job.img);
      return;
    }
    
    bgJobs.delete(id);
    type === 'done' ? job.resolve(blob) : job.reject(new Error(error));
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
        e.data?.type === 'warmup-done' ? resolve() : reject(new Error(e.data?.error));
      };
      w.addEventListener('message', handler);
      w.postMessage({ id, type:'warmup', config: BACKGROUND_REMOVAL_CONFIG });
    }))
    .catch(() => { bgWarmupPromise = null; });
  return bgWarmupPromise;
}

async function removeBg(file, img) {
  const worker = await getBgWorker();
  const id = ++bgTaskSeq;
  return new Promise((resolve, reject) => {
    bgJobs.set(id, { img, resolve, reject });
    worker.postMessage({ id, type:'remove', file, config: BACKGROUND_REMOVAL_CONFIG });
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
      processed: null, compressionPreview: null, rotation: 0, cropData: null,
      history: [], isProcessing: false, progress: 0,
      currentSize: file.size
    });
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

async function handleFiles(files, target = 'editor') {
  const valid = [...files].filter(f => SUPPORTED_FORMATS.includes(f.type));
  if (!valid.length) return;

  for (const file of valid) {
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
    if (!pdfImageOrder.includes(data.id)) pdfImageOrder.push(data.id);
  }

  updateAllViews();
  if (target === 'editor' && !activeImageId && allImages.length) selectImage(allImages[0].id);
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
    createBtn('thumb-remove', 'fa-times', e => { e.stopPropagation(); deleteImg(img.id); }),
    createBtn('thumb-rotate', '↻', e => { e.stopPropagation(); rotateImg(img.id); }, 'Rotar')
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
  grid.innerHTML = pdfImageOrder.length ? '' : '<div class="img-pdf-empty">No images loaded</div>';
  
  pdfImageOrder.forEach(id => {
    const img = allImages.find(i => i.id === id);
    if (!img) return;
    const thumb = createThumb(img, 'img-pdf-thumb');
    thumb.draggable = true;
    thumb.ondragstart = e => { thumb.classList.add('dragging'); e.dataTransfer.setData('text/plain', id); };
    thumb.ondragend = () => thumb.classList.remove('dragging');
    thumb.ondragover = e => e.preventDefault();
    thumb.ondrop = e => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/plain');
      const i1 = pdfImageOrder.indexOf(from), i2 = pdfImageOrder.indexOf(id);
      if (i1 > -1 && i2 > -1) {
        pdfImageOrder.splice(i2, 0, pdfImageOrder.splice(i1, 1)[0]);
        renderPdfGrid();
      }
    };
    grid.appendChild(thumb);
  });
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
  if ($('#imgQualitySlider')) {
    $('#imgQualitySlider').value = 100;
    $('#imgQualityValue').textContent = '100%';
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
  pdfImageOrder = pdfImageOrder.filter(i => i !== id);
  if (activeImageId === id) activeImageId = allImages[0]?.id || null;
  updateAllViews();
}

async function rotateImg(id) {
  const img = allImages.find(i => i.id === id);
  if (!img) return;
  
  const format = $('#imgFormatSelect')?.value;
  const targetFormat = (!format || format === 'original') ? img.file.type : format;
  const q = parseInt($('#imgQualitySlider')?.value || 100) / 100;

  const blob = await processImage(img.processed || img.url, {
    w: img.height, h: img.width,
    format: targetFormat,
    quality: q
  });
  
  if (blob) {
    img.processed && URL.revokeObjectURL(img.processed);
    img.processed = URL.createObjectURL(blob);
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
  const q = parseInt($('#imgQualitySlider')?.value || 100) / 100;
  
  const blob = await processImage(img.processed || img.url, {
    w: img.width, h: img.height,
    format: targetFormat, 
    quality: q
  });
  
  if (blob) {
    img.processed && URL.revokeObjectURL(img.processed);
    img.processed = URL.createObjectURL(blob);
    img.currentSize = blob.size;
    
    // Reset preview on structural change
    if (img.compressionPreview) {
      URL.revokeObjectURL(img.compressionPreview);
      img.compressionPreview = null;
    }

    updateAllViews();
  }
}

async function applyResize(all = false) {
  const w = parseInt($('#imgWidthInput')?.value), h = parseInt($('#imgHeightInput')?.value);
  if (!w || !h || w < 1 || h < 1) return;
  
  const format = $('#imgFormatSelect')?.value;
  const q = parseInt($('#imgQualitySlider')?.value || 100) / 100;

  for (const img of (all ? allImages : [getActive()].filter(Boolean))) {
    const targetFormat = (!format || format === 'original') ? img.file.type : format;
    const blob = await processImage(img.processed || img.url, { 
      w, h, 
      format: targetFormat, 
      quality: q 
    });
    if (blob) {
      img.processed && URL.revokeObjectURL(img.processed);
      img.processed = URL.createObjectURL(blob);
      img.currentSize = blob.size;
      img.width = w; img.height = h;

      // Reset preview on structural change
      if (img.compressionPreview) {
        URL.revokeObjectURL(img.compressionPreview);
        img.compressionPreview = null;
      }
    }
  }
  updateAllViews();
}

async function applyCompression(isRealTime = false) {
  const img = getActive();
  if (!img) return;

  const targetKB = parseInt($('#imgTargetSizeInput')?.value || 0);
  const qSlider = parseInt($('#imgQualitySlider')?.value || 100);
  
  if (isRealTime) {
    clearTimeout(compressionTimeout);
    compressionTimeout = setTimeout(() => executeCompression(img, qSlider / 100, targetKB), 150);
  } else {
    executeCompression(img, qSlider / 100, targetKB);
  }
}

async function executeCompression(img, q, targetKB) {
  const format = $('#imgFormatSelect')?.value;
  const targetFormat = (!format || format === 'original') ? img.file.type : format;
  
  if (q >= 1 && targetKB <= 0) {
    if (img.compressionPreview) {
      URL.revokeObjectURL(img.compressionPreview);
      img.compressionPreview = null;
    }
    return updateAllViews();
  }

  let blob = await processImage(img.processed || img.url, { 
    w: img.width, h: img.height,
    format: targetFormat, 
    quality: q 
  });

  // Simple refinement if we have a target size
  if (blob && targetKB > 0 && Math.abs(blob.size / 1024 - targetKB) > (targetKB * 0.1)) {
    const currentKB = blob.size / 1024;
    let q2 = Math.min(1, Math.max(0.01, q * Math.sqrt(targetKB / currentKB)));
    const blob2 = await processImage(img.processed || img.url, { 
      w: img.width, h: img.height,
      format: targetFormat, 
      quality: q2 
    });
    if (blob2 && Math.abs(blob2.size / 1024 - targetKB) < Math.abs(blob.size / 1024 - targetKB)) {
      blob = blob2;
      q = q2;
      $('#imgQualitySlider').value = Math.round(q * 100);
      $('#imgQualityValue').textContent = $('#imgQualitySlider').value + '%';
    }
  }

  if (blob) {
    img.compressionPreview && URL.revokeObjectURL(img.compressionPreview);
    img.compressionPreview = URL.createObjectURL(blob);
    img.currentSize = blob.size;
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
    const blob = img.processed ? await fetch(img.processed).then(r => r.blob()) : img.file;
    const result = await removeBg(blob, img);
    if (result) {
      img.processed && URL.revokeObjectURL(img.processed);
      img.processed = URL.createObjectURL(result);
      
      // Reset preview on structural change
      if (img.compressionPreview) {
        URL.revokeObjectURL(img.compressionPreview);
        img.compressionPreview = null;
      }

      img.progress = 100;
      updateBgProgressUI(img);
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
function removeFromPdf(id) { pdfImageOrder = pdfImageOrder.filter(i => i !== id); renderPdfGrid(); updatePdfBtn(); }
function clearAllPdf() { pdfImageOrder = []; renderPdfGrid(); updatePdfBtn(); }
function updatePdfBtn() { if ($('#imgConvertPdfBtn')) $('#imgConvertPdfBtn').disabled = !pdfImageOrder.length; }

async function convertToPdf() {
  if (!pdfImageOrder.length || !window.jspdf?.jsPDF) return alert('PDF library not loaded');
  
  const { jsPDF } = window.jspdf;
  const format = $('input[name="imgPdfFormat"]:checked')?.value || 'uniform';
  const isA4 = format === 'a4';
  let doc = null;
  
  for (let i = 0; i < pdfImageOrder.length; i++) {
    const img = allImages.find(im => im.id === pdfImageOrder[i]);
    if (!img) continue;
    
    await new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const rot = img.rotation || 0;
        const w = rot % 180 ? image.height : image.width;
        const h = rot % 180 ? image.width : image.height;
        
        if (isA4) {
          if (!doc) doc = new jsPDF('p', 'mm', 'a4');
          else doc.addPage();
          const pw = 190, ph = 277;
          const r = Math.min(pw / w, ph / h);
          doc.addImage(getDisplaySrc(img), 'PNG', 10, 10, w * r, h * r, null, 'FAST', rot);
        } else {
          const tw = 210, th = (h / w) * tw;
          if (!doc) doc = new jsPDF({ orientation: tw > th ? 'l' : 'p', unit: 'mm', format: [tw, th] });
          else doc.addPage([tw, th]);
          doc.addImage(getDisplaySrc(img), 'PNG', 0, 0, tw, th, null, 'FAST', rot);
        }
        resolve();
      };
      image.src = getDisplaySrc(img);
    });
  }
  
  doc?.save(`${$('#imgPdfFilename')?.value || 'documento'}.pdf`);
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
  allImages = []; activeImageId = null; pdfImageOrder = [];
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
    const hasImages = [...e.dataTransfer.files].some(f => f.type.startsWith('image/'));
    if (hasImages && $('.nav-btn.active')?.dataset.tab === 'imgpdf') {
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
  
  // Resize buttons
  $('#imgApplyResizeBtn')?.addEventListener('click', () => {
    const opts = $('#imgResizeOptions');
    if (opts) opts.style.display = opts.style.display === 'none' ? 'flex' : 'none';
  });
  
  $('#imgApplyToActiveBtn')?.addEventListener('click', () => {
    applyResize(false);
    if ($('#imgResizeOptions')) $('#imgResizeOptions').style.display = 'none';
  });
  
  $('#imgApplyToAllBtn')?.addEventListener('click', () => {
    applyResize(true);
    if ($('#imgResizeOptions')) $('#imgResizeOptions').style.display = 'none';
  });
  
  // Quality slider
  if ($('#imgQualitySlider')) {
    $('#imgQualitySlider').value = 100;
    $('#imgQualityValue').textContent = '100%';
    $('#imgQualitySlider').addEventListener('input', () => {
      $('#imgQualityValue').textContent = $('#imgQualitySlider').value + '%';
      applyCompression(true); // Real-time debounced preview
    });
    $('#imgQualitySlider').addEventListener('change', () => applyCompression(false));
  }
  
  // Target KB sync
  $('#imgTargetSizeInput')?.addEventListener('input', () => {
    const img = getActive();
    if (!img) return;
    const targetKB = parseInt($('#imgTargetSizeInput').value);
    if (!targetKB || targetKB <= 0) return;
    
    const originalKB = Math.round(img.file.size / 1024);
    // Rough heuristic: quality is roughly proportional to size ratio
    // We cap it between 1% and 100%
    const q = Math.min(100, Math.max(1, Math.round((targetKB / originalKB) * 100)));
    
    $('#imgQualitySlider').value = q;
    $('#imgQualityValue').textContent = q + '%';
    applyCompression(true); // Real-time debounced preview
  });
  
  $('#imgTargetSizeInput')?.addEventListener('change', () => applyCompression(false));
  
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
