let allImages = [], activeImageId = null, pdfImageOrder = [];
const SUPPORTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/bmp', 'image/avif'];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const BACKGROUND_REMOVAL_CONFIG = Object.freeze({
  device: 'cpu',
  model: 'isnet_quint8',
  rescale: true,
  output: { format: 'image/png', quality: 1 }
});
let backgroundRemovalWarmupPromise = null;
let backgroundRemovalWorker = null;
let backgroundRemovalWorkerUrl = null;
let backgroundRemovalTaskSeq = 0;
const backgroundRemovalJobs = new Map();

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function warmupBackgroundRemoval() {
  if (!backgroundRemovalWarmupPromise) {
    backgroundRemovalWarmupPromise = getBackgroundRemovalWorker()
      .then(worker => new Promise((resolve, reject) => {
        const id = ++backgroundRemovalTaskSeq;
        const onMessage = (event) => {
          const data = event.data || {};
          if (data.id !== id || data.type !== 'warmup-done' && data.type !== 'error') return;
          worker.removeEventListener('message', onMessage);
          data.type === 'warmup-done' ? resolve() : reject(new Error(data.error || 'Warmup failed'));
        };
        worker.addEventListener('message', onMessage);
        worker.postMessage({ id, type: 'warmup', config: BACKGROUND_REMOVAL_CONFIG });
      }))
      .catch(err => {
        console.warn('Background removal preload failed:', err);
        backgroundRemovalWarmupPromise = null;
      });
  }
  return backgroundRemovalWarmupPromise;
}

function getBackgroundRemovalWorker() {
  if (backgroundRemovalWorker) return Promise.resolve(backgroundRemovalWorker);

  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Web Worker not supported'));
  }

  if (!backgroundRemovalWorkerUrl) {
    const workerSource = `
      import { removeBackground, preload } from "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

      let warmupPromise = null;

      function getConfig(config) {
        return config || {
          device: 'cpu',
          model: 'isnet_quint8',
          rescale: true,
          output: { format: 'image/png', quality: 1 }
        };
      }

      function warmup(config) {
        if (!warmupPromise) {
          warmupPromise = preload(getConfig(config)).catch(() => {
            warmupPromise = null;
          });
        }
        return warmupPromise;
      }

      self.onmessage = async (event) => {
        const { id, type, file, config } = event.data || {};

        if (type === 'warmup') {
          try {
            await warmup(config);
            self.postMessage({ id, type: 'warmup-done' });
          } catch (error) {
            self.postMessage({ id, type: 'error', error: error?.message || 'Warmup failed' });
          }
          return;
        }

        if (type !== 'remove') return;

        try {
          const blob = await removeBackground(file, {
            ...getConfig(config),
            progress: (stage, current, total) => {
              self.postMessage({ id, type: 'progress', stage, current, total });
            }
          });
          self.postMessage({ id, type: 'done', blob });
        } catch (error) {
          self.postMessage({ id, type: 'error', error: error?.message || 'Background removal failed' });
        }
      };
    `;
    backgroundRemovalWorkerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  }

  backgroundRemovalWorker = new Worker(backgroundRemovalWorkerUrl, { type: 'module' });
  backgroundRemovalWorker.onmessage = (event) => {
    const data = event.data || {};
    const job = backgroundRemovalJobs.get(data.id);
    if (!job) return;

    if (data.type === 'progress') {
      const pct = getBackgroundRemovalPercent(data.stage, data.current, data.total, job.percent);
      if (pct > job.percent) {
        job.percent = pct;
        job.img.progress = pct;
        renderBackgroundRemovalProgress(job.img);
      }
      return;
    }

    backgroundRemovalJobs.delete(data.id);

    if (data.type === 'done') {
      job.resolve(data.blob);
      return;
    }

    job.reject(new Error(data.error || 'Background removal failed'));
  };

  backgroundRemovalWorker.onerror = (error) => {
    const err = new Error(error.message || 'Background removal worker crashed');
    backgroundRemovalJobs.forEach(job => job.reject(err));
    backgroundRemovalJobs.clear();
    backgroundRemovalWorker?.terminate();
    backgroundRemovalWorker = null;
    backgroundRemovalWarmupPromise = null;
  };

  return Promise.resolve(backgroundRemovalWorker);
}

async function removeBackgroundInWorker(file, img) {
  const worker = await getBackgroundRemovalWorker();
  const id = ++backgroundRemovalTaskSeq;

  return new Promise((resolve, reject) => {
    backgroundRemovalJobs.set(id, {
      img,
      percent: img.progress || 0,
      resolve,
      reject
    });

    worker.postMessage({
      id,
      type: 'remove',
      file,
      config: BACKGROUND_REMOVAL_CONFIG
    });
  });
}

function getBackgroundRemovalPercent(stage, current, total, lastPercent = 0) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;

  if (typeof stage === 'string') {
    if (stage.startsWith('fetch:')) return Math.max(lastPercent, Math.min(70, Math.round(ratio * 70)));
    if (stage === 'compute:decode') return Math.max(lastPercent, 72);
    if (stage === 'compute:inference') return Math.max(lastPercent, 84);
    if (stage === 'compute:mask') return Math.max(lastPercent, 92);
    if (stage === 'compute:encode') return Math.max(lastPercent, Math.min(100, 96 + Math.round(ratio * 4)));
  }

  return Math.max(lastPercent, Math.round(ratio * 100));
}

function renderBackgroundRemovalProgress(img) {
  const percent = Math.max(0, Math.min(100, Math.round(img.progress || 0)));

  if (activeImageId === img.id) {
    const progress = $('#imgBgProgress'), bar = $('#imgBgProgressBar'), text = $('#imgBgProgressText');
    if (progress && bar && text) {
      progress.style.display = 'block';
      bar.style.width = percent + '%';
      text.textContent = percent + '%';
    }
  }

  const thumb = document.querySelector(`.gallery-thumb[data-id="${img.id}"]`);
  if (thumb) {
    const thumbBar = thumb.querySelector('.thumb-progress-bar');
    const thumbText = thumb.querySelector('.thumb-progress-text');
    if (thumbBar) thumbBar.style.width = percent + '%';
    if (thumbText) thumbText.textContent = percent + '%';
  }
}

function initImgModule() {
  setupDropZone();
  setupFileInput();
  setupMiniDropZones();
  setupOptionsPanel();
  setupPreviewActions();
  setupPdfConvert();
  void warmupBackgroundRemoval();
  
  window.switchImgView = (view) => {
    $$('.img-toolbar-btn').forEach(b => b.classList.toggle('active', b.dataset.imgView === view));
    const editor = $('#imgEditorView'), pdf = $('#imgPdfView');
    if (editor) editor.style.display = view === 'editor' ? 'block' : 'none';
    if (pdf) pdf.style.display = view === 'pdf' ? 'block' : 'none';
  };
}

function generateId() { return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }

// ============ DROP ZONES (Simplificado) ============
function setupDropZone() {
  const zone = $('#imgDropZone');
  if (!zone) return;
  
  //Upload files manually
  zone.onclick = () => $('#imgFileInput').click();
  ['dragover', 'dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.toggle('drag-over', ev === 'dragover');
    if (ev === 'drop') e.dataTransfer.files.length && handleFiles(e.dataTransfer.files, 'editor');
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

function setupFileInput() {
  $('#imgFileInput')?.addEventListener('change', e => {
    e.target.files.length && handleFiles(e.target.files, 'editor');
    e.target.value = '';
  });
}

function setupMiniDropZones() {
  ['#imgMiniDropZone', '#imgCompactDropZone'].forEach(sel => {
    const zone = $(sel);
    if (!zone) return;
    zone.onclick = (e) => { e.stopPropagation(); $('#imgFileInput').click(); };
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      e.dataTransfer.files.length && handleFiles(e.dataTransfer.files, 'editor');
    });
  });
}

// ============ FILE HANDLING (Fusionado) ============
async function handleFiles(files, target = 'editor') {
  const validFiles = [...files].filter(f => SUPPORTED_FORMATS.includes(f.type) || f.type === 'image/heic');
  if (!validFiles.length) return;

  for (const file of validFiles) {
    const fileName = file.name.toLowerCase().replace(/\.heic$/i, '.png');
    if (allImages.some(img => img.name.toLowerCase() === fileName)) continue;

    let processedFile = file;
    if (file.name.toLowerCase().endsWith('.heic') || file.type === 'image/heic') {
      try {
        const blob = await heic2any({ blob: file, toType: 'image/png' });
        processedFile = new File([blob], file.name.replace(/\.heic$/i, '.png'), { type: 'image/png' });
      } catch (err) { console.error('HEIC conversion failed:', err); continue; }
    }

    const imageData = await loadImageData(processedFile);
    if (imageData) {
      allImages.push(imageData);
      if (!pdfImageOrder.includes(imageData.id)) pdfImageOrder.push(imageData.id);
    }
  }

  updateAllViews();
  if (target === 'editor' && !activeImageId && allImages.length) selectImage(allImages[0].id);
}

function loadImageData(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => resolve({ id: generateId(), file, url, name: file.name, width: img.width, height: img.height, originalWidth: img.width, originalHeight: img.height, processed: null, rotation: 0, cropData: null, history: [], isProcessing: false, progress: 0 });
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// ============ VIEW UPDATES (Simplificado) ============
function updateAllViews() {
  $('#imgInitialState').style.display = allImages.length ? 'none' : 'flex';
  $('#imgEditorLayout').style.display = allImages.length ? 'grid' : 'none';
  renderGallery();
  renderPreview();
  renderPdfGrid();
  $('#imgCountBadge').textContent = allImages.length;
  updatePdfConvertButton();
}

function deleteImage(id) {
  const idx = allImages.findIndex(img => img.id === id);
  if (idx === -1) return;
  const img = allImages[idx];
  img.url && URL.revokeObjectURL(img.url);
  img.processed && URL.revokeObjectURL(img.processed);
  allImages.splice(idx, 1);
  pdfImageOrder = pdfImageOrder.filter(i => i !== id);
  if (activeImageId === id) activeImageId = allImages.length ? allImages[0].id : null;
  updateAllViews();
  if (!allImages.length) updateOptionsPanel();
}

// ============ GALLERY RENDERING ============
function createThumb(imgData, extraClass = '', actions = null) {
  const thumb = document.createElement('div');
  thumb.className = `gallery-thumb ${extraClass} ${imgData.isProcessing ? 'processing' : ''}`;
  thumb.dataset.id = imgData.id;
  const rotation = imgData.rotation || 0;
  
  let thumbHtml = `<img src="${imgData.processed || imgData.url}" alt="${imgData.name}" draggable="false" style="transform: rotate(${rotation}deg);">`;
  if (imgData.isProcessing) {
    thumbHtml += `<div class="thumb-progress-overlay"><div class="thumb-progress-bar" style="width: ${imgData.progress}%"></div><span class="thumb-progress-text">${imgData.progress}%</span></div>`;
  }
  thumbHtml += `<div class="thumb-info">${imgData.width}x${imgData.height}</div>`;
  thumb.innerHTML = thumbHtml;
  
  const removeBtn = document.createElement('button');
  const rotateBtn = document.createElement('button');
  removeBtn.type = 'button';
  rotateBtn.type = 'button';
  rotateBtn.className = 'thumb-rotate';
  rotateBtn.setAttribute('aria-label', 'Rotar imagen');
  rotateBtn.title = 'Rotar imagen';
  rotateBtn.innerHTML = '<span aria-hidden="true">&#8635;</span>';
  removeBtn.className = 'thumb-remove';
  removeBtn.setAttribute('aria-label', 'Eliminar imagen');
  removeBtn.innerHTML = '<i class="fas fa-times"></i>';
  removeBtn.onclick = (e) => { e.stopPropagation(); deleteImage(imgData.id); };
  rotateBtn.onclick = (e) => { e.stopPropagation(); rotateImage(imgData.id); };
  thumb.appendChild(removeBtn);
  thumb.appendChild(rotateBtn);
  
  if (actions) thumb.appendChild(actions);
  thumb.onclick = () => selectImage(imgData.id);
  return thumb;
}

function renderGallery() {
  const list = $('#imgGalleryList');
  if (!list) return;
  list.innerHTML = '';
  allImages.forEach(img => {
    const thumb = createThumb(img, img.id === activeImageId ? 'active' : '');
    list.appendChild(thumb);
  });
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
    
    thumb.addEventListener('dragstart', e => { thumb.classList.add('dragging'); e.dataTransfer.setData('text/plain', id); });
    thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'));
    thumb.addEventListener('dragover', e => e.preventDefault());
    thumb.addEventListener('drop', e => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== id) {
        const from = pdfImageOrder.indexOf(fromId), to = pdfImageOrder.indexOf(id);
        if (from > -1 && to > -1) { pdfImageOrder.splice(to, 0, pdfImageOrder.splice(from, 1)[0]); renderPdfGrid(); }
      }
    });
    
    grid.appendChild(thumb);
  });
}

// ============ IMAGE OPERATIONS (Simplificado) ============
function selectImage(id) {
  activeImageId = id;
  renderGallery();
  renderPreview();
  updateOptionsPanel();
}

function renderPreview() {
  const preview = $('#imgPreview'), container = $('#imgPreviewContainer'), download = $('#imgDownloadBtn');
  const img = allImages.find(i => i.id === activeImageId);
  
  if (!img) {
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    if (container) container.classList.add('empty');
    if (download) download.disabled = true;
    return;
  }
  
  if (preview) { 
    preview.src = img.processed || img.url; 
    preview.style.display = 'block'; 
    preview.style.transform = `rotate(${img.rotation || 0}deg)`;
    preview.style.opacity = img.isProcessing ? '0.5' : '1';
  }
  if (container) {
    container.classList.remove('empty');
    const progress = $('#imgBgProgress'), bar = $('#imgBgProgressBar'), text = $('#imgBgProgressText');
    if (progress && bar && text) {
      if (img.isProcessing) {
        progress.style.display = 'block';
        bar.style.width = img.progress + '%';
        text.textContent = img.progress + '%';
      } else {
        progress.style.display = 'none';
      }
    }
  }
  if (download) download.disabled = false;
  
  const sizeEl = $('#imgOriginalSizeValue');
  if (sizeEl && img.file) sizeEl.textContent = `${Math.round(img.file.size / 1024)} KB`;
}

function updateOptionsPanel() {
  const img = allImages.find(i => i.id === activeImageId);
  if ($('#imgWidthInput')) $('#imgWidthInput').value = img ? img.width : '';
  if ($('#imgHeightInput')) $('#imgHeightInput').value = img ? img.height : '';
  ['#imgRemoveBgBtn', '#imgWatermarkBtn'].forEach(s => { 
    if ($(s)) $(s).disabled = !img || img.isProcessing; 
  });
}

// ============ FORMAT & RESIZE (Fusionado) ============
async function applyFormatConversion() {
  const img = allImages.find(i => i.id === activeImageId);
  if (!img) return;
  const format = $('#imgFormatSelect')?.value || 'original';
  
  if (format === 'original') { img.processed = null; return updateAllViews(); }
  
  const converted = await convertImage(img.processed || img.url, format, parseInt($('#imgQualitySlider')?.value || 100) / 100);
  if (converted) { img.processed && URL.revokeObjectURL(img.processed); img.processed = converted; updateAllViews(); }
}

function convertImage(src, format, quality = 1) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), format === 'jpeg' ? 'image/jpeg' : `image/${format}`, quality);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function applyResize(applyAll = false) {
  const w = parseInt($('#imgWidthInput')?.value), h = parseInt($('#imgHeightInput')?.value);
  if (!w || !h || w < 1 || h < 1) return;
  
  for (const img of (applyAll ? allImages : [allImages.find(i => i.id === activeImageId)])) {
    if (!img) continue;
    const resized = await resizeImage(img.processed || img.url, w, h);
    if (resized) { img.processed && URL.revokeObjectURL(img.processed); img.processed = resized; img.width = w; img.height = h; }
  }
  updateAllViews();
}

function resizeImage(src, w, h) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ============ BACKGROUND REMOVAL ============
async function backgroundRemoval() {
  const img = allImages.find(i => i.id === activeImageId);
  if (!img || img.isProcessing) return;
  
  img.isProcessing = true;
  img.progress = 0;
  updateAllViews();
  updateOptionsPanel();
  await nextFrame();
  void warmupBackgroundRemoval();
  
  try {
    const sourceBlob = img.processed
      ? await fetch(img.processed).then(r => r.blob())
      : img.file;
    const blob = await removeBackgroundInWorker(sourceBlob, img);
    
    if (blob) {
      img.processed && URL.revokeObjectURL(img.processed);
      img.processed = URL.createObjectURL(blob);
      img.progress = 100;
      renderBackgroundRemovalProgress(img);
    }
  } catch (err) {
    console.error('Background removal failed:', err);
    alert('Error al eliminar el fondo. Intentalo de nuevo.');
  } finally {
    img.isProcessing = false;
    updateAllViews();
    updateOptionsPanel();
  }
}

// ============ PDF (Simplificado) ============
async function rotateImage(id) {
  const img = allImages.find(i => i.id === id);
  if (!img) return;

  const src = img.processed || img.url;
  const rotated = await new Promise(resolve => {
    const tempImg = new Image();
    tempImg.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      // Rotate 90 degrees clockwise
      canvas.width = tempImg.height;
      canvas.height = tempImg.width;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(90 * Math.PI / 180);
      ctx.drawImage(tempImg, -tempImg.width / 2, -tempImg.height / 2);
      canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), img.file?.type || 'image/png');
    };
    tempImg.onerror = () => resolve(null);
    tempImg.src = src;
  });

  if (rotated) {
    if (img.processed) URL.revokeObjectURL(img.processed);
    img.processed = rotated;
    // Swap dimensions
    [img.width, img.height] = [img.height, img.width];
    // Reset visual rotation as it's now baked into the image data
    img.rotation = 0;
    if (id === activeImageId) updateOptionsPanel();
    updateAllViews();
  }
}

function removeFromPdf(id) { pdfImageOrder = pdfImageOrder.filter(i => i !== id); renderPdfGrid(); updatePdfConvertButton(); }
function clearAllPdfImages() { pdfImageOrder = []; renderPdfGrid(); updatePdfConvertButton(); }
function updatePdfConvertButton() { if ($('#imgConvertPdfBtn')) $('#imgConvertPdfBtn').disabled = !pdfImageOrder.length; }

async function convertToPdf() {
  if (!pdfImageOrder.length) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) return alert('PDF library not loaded');
  
  const format = $('input[name="imgPdfFormat"]:checked')?.value || 'uniform';
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

        if (format === 'uniform') {
          const targetWidth = 210; // Base width in mm (A4 width)
          const targetHeight = (h / w) * targetWidth;
          const orientation = targetWidth > targetHeight ? 'l' : 'p';
          
          if (!doc) {
            doc = new jsPDF({
              orientation,
              unit: 'mm',
              format: [targetWidth, targetHeight]
            });
          } else {
            doc.addPage([targetWidth, targetHeight], orientation);
          }
          doc.addImage(img.processed || img.url, 'PNG', 0, 0, targetWidth, targetHeight, null, 'FAST', rot);
        } else {
          // Standard A4 format
          if (!doc) {
            doc = new jsPDF('p', 'mm', 'a4');
          } else {
            doc.addPage('a4', 'p');
          }
          
          const pw = doc.internal.pageSize.getWidth() - 20;
          const ph = doc.internal.pageSize.getHeight() - 20;
          const ratio = Math.min(pw / w, ph / h);
          const finalW = w * ratio;
          const finalH = h * ratio;
          const x = (doc.internal.pageSize.getWidth() - finalW) / 2;
          const y = (doc.internal.pageSize.getHeight() - finalH) / 2;
          
          doc.addImage(img.processed || img.url, 'PNG', x, y, finalW, finalH, null, 'FAST', rot);
        }
        resolve();
      };
      image.src = img.processed || img.url;
    });
  }
  
  if (doc) {
    doc.save(`${$('#imgPdfFilename')?.value || 'documento'}.pdf`);
  }
}

// ============ DOWNLOAD (Fusionado) ============
function getExtension(img) {
  const format = $('#imgFormatSelect')?.value;
  if (format && format !== 'original') return format;
  const ext = img.name.split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'png';
}

function downloadImage() {
  const img = allImages.find(i => i.id === activeImageId);
  if (!img) return;
  const a = Object.assign(document.createElement('a'), { href: img.processed || img.url, download: `${img.name.replace(/\.[^.]+$/, '')}.${getExtension(img)}` });
  a.click();
}

function downloadAllImages() {
  allImages.forEach((img, i) => setTimeout(() => {
    const a = Object.assign(document.createElement('a'), { href: img.processed || img.url, download: `${img.name.replace(/\.[^.]+$/, '')}.${getExtension(img)}` });
    a.click();
  }, i * 500));
}

function clearAllImages() {
  allImages.forEach(img => { img.url && URL.revokeObjectURL(img.url); img.processed && URL.revokeObjectURL(img.processed); });
  allImages = []; activeImageId = null; pdfImageOrder = [];
  updateAllViews(); updateOptionsPanel();
}

// ============ SETUP (Simplificado) ============
function setupOptionsPanel() {
  $('#imgFormatSelect')?.addEventListener('change', applyFormatConversion);
  $('#imgKeepAspectCheck')?.addEventListener('change', () => { if ($('#imgAspectLockIcon')) $('#imgAspectLockIcon').className = $('#imgKeepAspectCheck').checked ? 'fas fa-lock' : 'fas fa-lock-open'; });
  $('#imgApplyResizeBtn')?.addEventListener('click', () => { const o = $('#imgResizeOptions'); if (o) o.style.display = o.style.display === 'none' ? 'flex' : 'none'; });
  $('#imgApplyToActiveBtn')?.addEventListener('click', () => { applyResize(false); $('#imgResizeOptions').style.display = 'none'; });
  $('#imgApplyToAllBtn')?.addEventListener('click', () => { applyResize(true); $('#imgResizeOptions').style.display = 'none'; });
  $('#imgRemoveBgBtn')?.addEventListener('click', backgroundRemoval);
  if ($('#imgQualitySlider') && $('#imgQualityValue')) {
    $('#imgQualitySlider').value = 100; $('#imgQualityValue').textContent = '100%';
    $('#imgQualitySlider').addEventListener('input', () => $('#imgQualityValue').textContent = $('#imgQualitySlider').value + '%');
    $('#imgQualitySlider').addEventListener('change', async () => {
      const img = allImages.find(i => i.id === activeImageId);
      if (!img) return;
      const q = parseInt($('#imgQualitySlider').value) / 100, f = $('#imgFormatSelect')?.value || 'original';
      const c = await convertImage(img.processed || img.url, f !== 'original' ? f : (img.name.split('.').pop() || 'png'), q);
      if (c) { img.processed && URL.revokeObjectURL(img.processed); img.processed = c; updateAllViews(); }
    });
  }
}

function setupPreviewActions() {
  $('#imgDownloadBtn')?.addEventListener('click', downloadImage);
  $('#imgDownloadAllBtn')?.addEventListener('click', downloadAllImages);
  $('#imgClearAllBtn')?.addEventListener('click', clearAllImages);
}

function setupPdfConvert() {
  $('#imgConvertPdfBtn')?.addEventListener('click', convertToPdf);
  $('#imgPdfClearAllBtn')?.addEventListener('click', clearAllPdfImages);
  $('#imgPdfDropZone')?.addEventListener('click', () => $('#imgPdfFileInput').click());
  $('#imgPdfDropZone')?.addEventListener('dragover', e => { e.preventDefault(); $('.upload-zone').classList.add('drag-over'); });
  $('#imgPdfDropZone')?.addEventListener('dragleave', () => $('.upload-zone').classList.remove('drag-over'));
  $('#imgPdfDropZone')?.addEventListener('drop', e => { e.preventDefault(); $('.upload-zone').classList.remove('drag-over'); e.dataTransfer.files.length && handleFiles(e.dataTransfer.files, 'pdf'); });
  $('#imgPdfFileInput')?.addEventListener('change', e => { e.target.files.length && handleFiles(e.target.files, 'pdf'); e.target.value = ''; });
}

export { initImgModule };
