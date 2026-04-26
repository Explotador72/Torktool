
import { t, tc, showGlobalProgress, hideGlobalProgress } from './utils.js';

const imgInput = document.getElementById('imgInput');
const btnPdf = document.getElementById('convertPdfBtn');
const previewPdf = document.getElementById('previewPdf');
const fileNameInput = document.getElementById('nameInput');
const pdfActionsArea = document.getElementById('pdfActionsArea');
const imageCountText = document.getElementById('imageCountText');
const pdfDropZone = document.getElementById('pdfDropZone');
const a4Checkbox = document.getElementById('A4Checkbox');
const uniformCheckbox = document.getElementById('UniformCheckbox');

const MAX_EXPORT_DIMENSION = 1200;
const EXPORT_QUALITY = 0.82;
const A4_PORTRAIT = { width: 794, height: 1123 };
const A4_LANDSCAPE = { width: 1123, height: 794 };
const UNIFORM_MARGIN = 0;

let images = [];
let draggingIndex = null;

export function initPdfModule() {
  if (!imgInput || !btnPdf || !previewPdf || !fileNameInput || !pdfActionsArea || !imageCountText || !pdfDropZone) return;

  pdfDropZone.addEventListener('dragover', (e) => { e.preventDefault(); pdfDropZone.classList.add('drag-over'); });
  pdfDropZone.addEventListener('dragleave', () => pdfDropZone.classList.remove('drag-over'));
  pdfDropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    pdfDropZone.classList.remove('drag-over');
    await processFiles(Array.from(e.dataTransfer.files));
  });

  imgInput.addEventListener('change', async (e) => await processFiles(Array.from(e.target.files)));

  btnPdf.addEventListener('click', generatePdf);

  pdfDropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imgInput.click(); }
  });

  updateUIState();
}

async function processFiles(files) {
  const validFiles = files.filter((file) => file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.heic'));
  for (const file of validFiles) {
    let currentFile = file;
    if (file.name.toLowerCase().endsWith('.heic')) {
      try {
        showGlobalProgress(`${t('progress.heic_conversion')}: ${file.name}...`, 50);
        const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
        currentFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
        hideGlobalProgress();
      } catch (error) { console.error('HEIC Error:', error); continue; }
    }
    const id = Math.random().toString(36).slice(2, 11);
    images.push({ id, file: currentFile, url: URL.createObjectURL(currentFile), rotation: 0 });
  }
  renderPreviews();
  updateUIState();
}

function renderPreviews() {
  previewPdf.innerHTML = '';
  images.forEach((image, index) => {
    const card = document.createElement('div');
    card.className = 'image-card-pro';
    card.draggable = true;
    card.innerHTML = `
      <span class="image-index">${index + 1}</span>
      <img src="${image.url}" style="transform: rotate(${image.rotation}deg)" draggable="false">
      <div class="card-overlay">
        <div class="card-actions">
          <button class="btn-blur js-rotate" type="button" title="${t('pdf.rotate')}"><i class="fas fa-rotate"></i></button>
          <button class="btn-blur delete js-delete" type="button" title="${t('pdf.delete')}"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;

    card.querySelector('.js-rotate')?.addEventListener('click', (e) => {
      e.stopPropagation(); image.rotation = (image.rotation + 90) % 360; renderPreviews();
    });

    card.querySelector('.js-delete')?.addEventListener('click', (e) => {
      e.stopPropagation(); images = images.filter((item) => item.id !== image.id);
      renderPreviews(); updateUIState();
    });

    card.addEventListener('dragstart', (e) => {
      draggingIndex = index; card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      previewPdf.querySelectorAll('.image-card-pro').forEach((item) => item.classList.remove('drag-over-card'));
      draggingIndex = null;
    });

    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over-card'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over-card'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggingIndex !== null && draggingIndex !== index) {
        const movedItem = images.splice(draggingIndex, 1)[0];
        images.splice(index, 0, movedItem);
        renderPreviews();
      }
    });
    previewPdf.appendChild(card);
  });
}

function updateUIState() {
  const hasImages = images.length > 0;
  pdfActionsArea.style.display = hasImages ? 'flex' : 'none';
  imageCountText.textContent = tc('pdf.images_selected_one', 'pdf.images_selected_other', images.length);
  btnPdf.disabled = !hasImages;
}

async function generatePdf() {
  if (images.length === 0) return;
  btnPdf.disabled = true;
  btnPdf.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>${t('pdf.generating')}</span>`;

  try {
    const renderedImages = [];
    for (const img of images) renderedImages.push(await getProcessedImageData(img));

    const { jsPDF } = window.jspdf;
    const exportMode = a4Checkbox?.checked ? 'a4' : 'uniform';
    const firstPage = renderedImages[0];
    const firstPageSize = exportMode === 'a4' 
      ? (firstPage.width >= firstPage.height ? A4_LANDSCAPE : A4_PORTRAIT)
      : { width: firstPage.width, height: firstPage.height };

    const pdf = new jsPDF({
      orientation: firstPageSize.width >= firstPageSize.height ? 'landscape' : 'portrait',
      unit: 'px', format: [firstPageSize.width, firstPageSize.height], hotfixes: ['px_scaling']
    });

    renderedImages.forEach((image, index) => {
      const pageSize = exportMode === 'a4' 
        ? (image.width >= image.height ? A4_LANDSCAPE : A4_PORTRAIT)
        : { width: image.width, height: image.height };

      if (index > 0) pdf.addPage([pageSize.width, pageSize.height], pageSize.width >= pageSize.height ? 'landscape' : 'portrait');
      
      const frame = getContainFrame(pageSize.width, pageSize.height, image.width, image.height, { margin: exportMode === 'uniform' ? UNIFORM_MARGIN : 0, allowUpscale: exportMode === 'a4' });
      pdf.addImage(image.dataUrl, 'JPEG', frame.x, frame.y, frame.width, frame.height, undefined, 'FAST');
    });

    pdf.save(`${fileNameInput.value || 'TorkTool'}.pdf`);
  } finally {
    btnPdf.disabled = false;
    btnPdf.innerHTML = `<i class="fas fa-file-export"></i><span>${t('pdf.generate')}</span>`;
  }
}

async function getProcessedImageData(imageObject) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const rotated = imageObject.rotation % 180 !== 0;
      const sw = rotated ? img.height : img.width;
      const sh = rotated ? img.width : img.height;
      const scale = MAX_EXPORT_DIMENSION / Math.max(sw, sh);
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((imageObject.rotation * Math.PI) / 180);
      ctx.drawImage(img, -(img.width * scale) / 2, -(img.height * scale) / 2, img.width * scale, img.height * scale);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', EXPORT_QUALITY), width: canvas.width, height: canvas.height });
    };
    img.src = imageObject.url;
  });
}

function getContainFrame(pw, ph, iw, ih, options = {}) {
  const m = options.margin || 0;
  const uw = pw - m * 2;
  const uh = ph - m * 2;
  const s = options.allowUpscale ? Math.min(uw / iw, uh / ih) : Math.min(1, uw / iw, uh / ih);
  const w = iw * s;
  const h = ih * s;
  return { width: w, height: h, x: (pw - w) / 2, y: (ph - h) / 2 };
}
