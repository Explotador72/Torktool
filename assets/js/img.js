import { removeBackground } from "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
let allImages = [], activeImageId = null, pdfImageOrder = [];
const SUPPORTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/bmp', 'image/avif'];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function initImgModule() {
  setupDropZone();
  setupFileInput();
  setupMiniDropZones();
  setupOptionsPanel();
  setupPreviewActions();
  setupPdfConvert();
  
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
    img.onload = () => resolve({ id: generateId(), file, url, name: file.name, width: img.width, height: img.height, originalWidth: img.width, originalHeight: img.height, processed: null, rotation: 0, cropData: null, history: [] });
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
  thumb.className = `gallery-thumb ${extraClass}`;
  thumb.dataset.id = imgData.id;
  const rotation = imgData.rotation || 0;
  thumb.innerHTML = `<img src="${imgData.processed || imgData.url}" alt="${imgData.name}" draggable="false" style="transform: rotate(${rotation}deg);"><div class="thumb-info">${imgData.width}x${imgData.height}</div>`;
  
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
  }
  if (container) container.classList.remove('empty');
  if (download) download.disabled = false;
  
  const sizeEl = $('#imgOriginalSizeValue');
  if (sizeEl && img.file) sizeEl.textContent = `${Math.round(img.file.size / 1024)} KB`;
}

function updateOptionsPanel() {
  const img = allImages.find(i => i.id === activeImageId);
  if ($('#imgWidthInput')) $('#imgWidthInput').value = img ? img.width : '';
  if ($('#imgHeightInput')) $('#imgHeightInput').value = img ? img.height : '';
  ['#imgRemoveBgBtn', '#imgWatermarkBtn'].forEach(s => { if ($(s)) $(s).disabled = !img; });
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
  if (!img) return;
  
  const progress = $('#imgBgProgress'), bar = $('#imgBgProgressBar'), text = $('#imgBgProgressText'), btn = $('#imgRemoveBgBtn');
  if (progress) progress.style.display = 'block';
  if (btn) btn.disabled = true;
  
  try {
    const blob = await removeBackground(img.processed || img.url, {
      progress: (_, current, total) => {
        const pct = Math.round((current / total) * 100);
        if (bar) bar.style.width = pct + '%';
        if (text) text.textContent = pct + '%';
      }
    });
    if (blob) { img.processed && URL.revokeObjectURL(img.processed); img.processed = URL.createObjectURL(blob); updateAllViews(); }
  } catch (err) { alert('Background removal failed: ' + err.message); }
  finally { if (progress) progress.style.display = 'none'; if (btn) btn.disabled = false; }
}

// ============ PDF (Simplificado) ============
function rotateImage(id) {
  const img = allImages.find(i => i.id === id);
  if (img) { img.rotation = (img.rotation + 90) % 360; updateAllViews(); }
}

function removeFromPdf(id) { pdfImageOrder = pdfImageOrder.filter(i => i !== id); renderPdfGrid(); updatePdfConvertButton(); }
function clearAllPdfImages() { pdfImageOrder = []; renderPdfGrid(); updatePdfConvertButton(); }
function updatePdfConvertButton() { if ($('#imgConvertPdfBtn')) $('#imgConvertPdfBtn').disabled = !pdfImageOrder.length; }

async function convertToPdf() {
  if (!pdfImageOrder.length) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) return alert('PDF library not loaded');
  
  const doc = new jsPDF();
  const format = $('input[name="imgPdfFormat"]:checked')?.value || 'uniform';
  
  for (let i = 0; i < pdfImageOrder.length; i++) {
    const img = allImages.find(im => im.id === pdfImageOrder[i]);
    if (!img) continue;
    if (i > 0) doc.addPage();
    
    await new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const rot = img.rotation || 0, w = rot % 180 ? image.height : image.width, h = rot % 180 ? image.width : image.height;
        const pw = doc.internal.pageSize.getWidth() - 20, ph = doc.internal.pageSize.getHeight() - 20;
        const ratio = Math.min(pw / w, ph / h);
        doc.addImage(img.processed || img.url, img.file.type === 'image/png' ? 'PNG' : 'JPEG', (pw - w * ratio) / 2 + 10, (ph - h * ratio) / 2 + 10, w * ratio, h * ratio, null, 'FAST', rot);
        resolve();
      };
      image.src = img.processed || img.url;
    });
  }
  doc.save(`${$('#imgPdfFilename')?.value || 'documento'}.pdf`);
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
