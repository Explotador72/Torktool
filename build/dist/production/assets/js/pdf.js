(function () {
  const t = (key, params) => window.i18n?.t(key, params) ?? key;
  const tc = (oneKey, otherKey, count, params = {}) => t(count === 1 ? oneKey : otherKey, { ...params, count });

  const imgInput = document.getElementById('imgInput');
  const btnPdf = document.getElementById('convertPdfBtn');
  const previewPdf = document.getElementById('previewPdf');
  const fileNameInput = document.getElementById('nameInput');
  const pdfActionsArea = document.getElementById('pdfActionsArea');
  const imageCountText = document.getElementById('imageCountText');
  const pdfDropZone = document.getElementById('pdfDropZone');
  const a4Checkbox = document.getElementById('A4Checkbox');
  const uniformCheckbox = document.getElementById('UniformCheckbox');
  const MAX_EXPORT_DIMENSION = 1800;
  const EXPORT_QUALITY = 0.82;
  const A4_PORTRAIT = { width: 794, height: 1123 };
  const A4_LANDSCAPE = { width: 1123, height: 794 };
  const UNIFORM_MARGIN = 56;

  if (!imgInput || !btnPdf || !previewPdf || !fileNameInput || !pdfActionsArea || !imageCountText || !pdfDropZone) {
    return;
  }

  let images = [];
  let draggingIndex = null;

  function setGenerateButtonState(isLoading) {
    btnPdf.disabled = isLoading || images.length === 0;
    btnPdf.innerHTML = isLoading
      ? `<i class="fas fa-spinner fa-spin"></i><span>${t('pdf.generating')}</span>`
      : `<i class="fas fa-file-export"></i><span>${t('pdf.generate')}</span>`;
  }

  async function processFiles(files) {
    const validFiles = files.filter((file) => file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.heic'));

    for (const file of validFiles) {
      let currentFile = file;
      const isHEIC = file.name.toLowerCase().endsWith('.heic');

      if (isHEIC) {
        try {
          showGlobalProgress(`${t('progress.heic_conversion')}: ${file.name}...`, 50);
          const blob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.8,
          });

          currentFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
          hideGlobalProgress();
        } catch (error) {
          console.error('HEIC Error:', error);
          continue;
        }
      }

      const id = Math.random().toString(36).slice(2, 11);
      images.push({
        id,
        file: currentFile,
        url: URL.createObjectURL(currentFile),
        rotation: 0,
      });
    }

    renderPreviews();
    updateUIState();
  }

  function updateUIState() {
    const hasImages = images.length > 0;
    pdfActionsArea.style.display = hasImages ? 'flex' : 'none';
    imageCountText.textContent = tc('pdf.images_selected_one', 'pdf.images_selected_other', images.length);
    setGenerateButtonState(false);
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
            <button class="btn-blur js-rotate" type="button" title="${t('pdf.rotate')}">
              <i class="fas fa-rotate"></i>
            </button>
            <button class="btn-blur delete js-delete" type="button" title="${t('pdf.delete')}">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;

      card.querySelector('.js-rotate')?.addEventListener('click', (event) => {
        event.stopPropagation();
        image.rotation = (image.rotation + 90) % 360;
        renderPreviews();
      });

      card.querySelector('.js-delete')?.addEventListener('click', (event) => {
        event.stopPropagation();
        images = images.filter((item) => item.id !== image.id);
        renderPreviews();
        updateUIState();
      });

      card.addEventListener('dragstart', (event) => {
        draggingIndex = index;
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', image.id);

        const dragGhost = card.cloneNode(true);
        dragGhost.style.position = 'absolute';
        dragGhost.style.top = '-9999px';
        dragGhost.style.left = '-9999px';
        dragGhost.style.width = `${card.offsetWidth}px`;
        dragGhost.style.height = `${card.offsetHeight}px`;
        dragGhost.style.pointerEvents = 'none';
        document.body.appendChild(dragGhost);
        event.dataTransfer.setDragImage(dragGhost, card.offsetWidth / 2, card.offsetHeight / 2);
        window.requestAnimationFrame(() => dragGhost.remove());
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        previewPdf.querySelectorAll('.image-card-pro').forEach((item) => item.classList.remove('drag-over-card'));
        draggingIndex = null;
      });

      card.addEventListener('dragover', (event) => {
        event.preventDefault();
        card.classList.add('drag-over-card');
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-card');
      });

      card.addEventListener('drop', (event) => {
        event.preventDefault();
        if (draggingIndex !== null && draggingIndex !== index) {
          const movedItem = images.splice(draggingIndex, 1)[0];
          images.splice(index, 0, movedItem);
          renderPreviews();
        }
        draggingIndex = null;
      });

      previewPdf.appendChild(card);
    });
  }

  async function getProcessedImageData(imageObject) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const rotated = imageObject.rotation % 180 !== 0;
        const sourceWidth = rotated ? img.height : img.width;
        const sourceHeight = rotated ? img.width : img.height;
        const scale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(sourceWidth, sourceHeight));
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((imageObject.rotation * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);

        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', EXPORT_QUALITY),
          width: canvas.width,
          height: canvas.height,
        });
      };
      img.src = imageObject.url;
    });
  }

  function getExportMode() {
    if (a4Checkbox?.checked) {
      return 'a4';
    }
    if (uniformCheckbox?.checked) {
      return 'uniform';
    }
    return 'uniform';
  }

  function getContainFrame(pageWidth, pageHeight, imageWidth, imageHeight, options = {}) {
    const margin = options.margin || 0;
    const allowUpscale = options.allowUpscale !== false;
    const usableWidth = Math.max(1, pageWidth - margin * 2);
    const usableHeight = Math.max(1, pageHeight - margin * 2);
    const scale = allowUpscale
      ? Math.min(usableWidth / imageWidth, usableHeight / imageHeight)
      : Math.min(1, usableWidth / imageWidth, usableHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
      width,
      height,
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
    };
  }

  pdfDropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    pdfDropZone.classList.add('drag-over');
  });

  pdfDropZone.addEventListener('dragleave', () => {
    pdfDropZone.classList.remove('drag-over');
  });

  pdfDropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    pdfDropZone.classList.remove('drag-over');
    await processFiles(Array.from(event.dataTransfer.files));
  });

  imgInput.addEventListener('change', async (event) => {
    await processFiles(Array.from(event.target.files));
  });

  btnPdf.addEventListener('click', async () => {
    if (images.length === 0) {
      return;
    }

    setGenerateButtonState(true);

    try {
      const renderedImages = [];

      for (let index = 0; index < images.length; index += 1) {
        renderedImages.push(await getProcessedImageData(images[index]));
      }

      const { jsPDF } = window.jspdf;
      const exportMode = getExportMode();
      const firstPage = renderedImages[0];
      const firstPageSize = exportMode === 'a4'
        ? (firstPage.width >= firstPage.height ? A4_LANDSCAPE : A4_PORTRAIT)
        : { width: firstPage.width, height: firstPage.height };

      const pdf = new jsPDF({
        orientation: firstPageSize.width >= firstPageSize.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [firstPageSize.width, firstPageSize.height],
        hotfixes: ['px_scaling'],
        compress: false,
      });

      renderedImages.forEach((image, index) => {
        const pageSize = exportMode === 'a4'
          ? (image.width >= image.height ? A4_LANDSCAPE : A4_PORTRAIT)
          : { width: image.width, height: image.height };

        if (index > 0) {
          const orientation = pageSize.width >= pageSize.height ? 'landscape' : 'portrait';
          pdf.addPage([pageSize.width, pageSize.height], orientation);
        }

        const frame = exportMode === 'uniform'
          ? getContainFrame(pageSize.width, pageSize.height, image.width, image.height, { margin: UNIFORM_MARGIN, allowUpscale: false })
          : getContainFrame(pageSize.width, pageSize.height, image.width, image.height, { margin: 0, allowUpscale: true });
        pdf.addImage(image.dataUrl, 'JPEG', frame.x, frame.y, frame.width, frame.height, undefined, 'FAST');
      });

      const fileName = fileNameInput.value || 'TorkTool_Document';
      pdf.save(`${fileName}.pdf`);
    } finally {
      setGenerateButtonState(false);
    }
  });

  pdfDropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      imgInput.click();
    }
  });

  updateUIState();
})();
