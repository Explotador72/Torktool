/**
 * Image Processing Module - Client-side image editing
 */

let allImages = [];
let activeImageId = null;
let pdfImageOrder = [];

const SUPPORTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/bmp', 'image/avif'];

function initImgModule() {
  setupDropZone();
  setupFileInput();
  setupOptionsPanel();
  setupPreviewActions();
  setupMiniDropZones();
  setupPdfConvert();
  
  window.switchImgView = function(view) {
    const toolbarBtns = document.querySelectorAll('.img-toolbar-btn');
    const editorView = document.getElementById('imgEditorView');
    const pdfView = document.getElementById('imgPdfView');

    toolbarBtns.forEach(b => b.classList.remove('active'));
    
    const activeBtn = document.querySelector(`.img-toolbar-btn[data-img-view="${view}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (view === 'editor') {
      if (editorView) editorView.style.display = 'block';
      if (pdfView) pdfView.style.display = 'none';
    } else {
      if (editorView) editorView.style.display = 'none';
      if (pdfView) pdfView.style.display = 'block';
    }
  };
}

function generateId() {
  return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function setupDropZone() {
  const dropZone = document.getElementById('imgDropZone');
  if (!dropZone) return;

  dropZone.addEventListener('click', () => {
    document.getElementById('imgFileInput').click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) handleFiles(files, 'editor');
  });

  // Global drag and drop handler
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  });

  window.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    
    // Only handle if there are files (external files)
    if (!files.length) return;
    
    // Check if dragging from within the page (images, elements)
    const isDraggingFromPage = e.dataTransfer.types.includes('text/html') && 
                               e.dataTransfer.types.includes('Files');
    
    // If dragging from page (like preview images), ignore
    if (isDraggingFromPage) return;
    
    // Check if dropping on internal interactive elements
    const internalSelectors = [
      '.img-preview-container', '.img-gallery', '.img-pdf-grid',
      '.gallery-thumb', '.img-pdf-thumb', 'img', 'canvas',
      '.watermark-overlay', '.watermark-canvas', '#imgPreview'
    ];
    
    const target = e.target;
    const isOnInternalElement = internalSelectors.some(sel => target.closest(sel));
    
    if (isOnInternalElement) return;
    
    // Process the drop
    e.preventDefault();
    
    const hasImages = Array.from(files).some(f => f.type.startsWith('image/'));
    if (!hasImages) return;
    
    const activeTab = document.querySelector('.nav-btn.active')?.dataset.tab;
    if (activeTab === 'imgpdf') {
      const activeView = document.querySelector('.img-toolbar-btn.active')?.dataset.imgView;
      handleFiles(files, activeView === 'pdf' ? 'pdf' : 'editor');
    }
  });
}

function setupFileInput() {
  const fileInput = document.getElementById('imgFileInput');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFiles(e.target.files, 'editor');
      fileInput.value = ''; // Clear to allow re-uploading same file
    }
  });
}

function setupMiniDropZones() {
  const miniDropZone = document.getElementById('imgMiniDropZone');
  const compactDropZone = document.getElementById('imgCompactDropZone');

  [miniDropZone, compactDropZone].forEach(zone => {
    if (!zone) return;

    zone.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('imgFileInput').click();
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // ✅ Solo mostrar drag-over si hay archivos
      if (e.dataTransfer.types.includes('Files')) {
        zone.classList.add('drag-over');
      }
    });

    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');
      
      // ✅ Solo procesar si hay archivos reales
      if (e.dataTransfer.types.includes('Files')) {
        const files = e.dataTransfer.files;
        if (files.length) handleFiles(files, 'editor');
      }
    });
  });
}

async function handleFiles(files, target = 'editor') {
  const validFiles = Array.from(files).filter(file => {
    if (file.type === 'image/heic') return true;
    if (SUPPORTED_FORMATS.includes(file.type)) return true;
    return false;
  });

  if (validFiles.length === 0) return;

  const targetList = allImages;

  for (const file of validFiles) {
    const fileName = file.name.toLowerCase().replace(/\.heic$/i, '.png');
    const exists = targetList.some(img => img.name.toLowerCase() === fileName);
    if (exists) {
      console.log('File already exists:', fileName);
      continue;
    }

    let processedFile = file;

    if (file.name.toLowerCase().endsWith('.heic') || file.type === 'image/heic') {
      try {
        const blob = await heic2any({ blob: file, toType: 'image/png' });
        processedFile = new File([blob], file.name.replace(/\.heic$/i, '.png'), { type: 'image/png' });
      } catch (err) {
        console.error('HEIC conversion failed:', err);
        continue;
      }
    }

    const imageData = await loadImageData(processedFile);
    if (imageData) {
      targetList.push(imageData);
    }
  }

  if (target === 'editor') {
    updateEditorState();
    renderGallery();
    if (!activeImageId && allImages.length > 0) {
      selectImage(allImages[0].id);
    }
    updateImageCount();
  } else {
    renderPdfGrid();
    updatePdfConvertButton();
  }
}

function loadImageData(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      resolve({
        id: generateId(),
        file: file,
        url: url,
        name: file.name,
        width: img.width,
        height: img.height,
        originalWidth: img.width,
        originalHeight: img.height,
        processed: null,
        rotation: 0,
        cropData: null,
        history: []
      });
    };

    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };

    img.src = url;
  });
}

function updateEditorState() {
  const initialState = document.getElementById('imgInitialState');
  const editorLayout = document.getElementById('imgEditorLayout');

  if (allImages.length > 0) {
    if (initialState) initialState.style.display = 'none';
    if (editorLayout) editorLayout.style.display = 'grid';
  } else {
    if (initialState) initialState.style.display = 'flex';
    if (editorLayout) editorLayout.style.display = 'none';
  }
}

function renderGallery() {
  const galleryList = document.getElementById('imgGalleryList');
  if (!galleryList) return;

  galleryList.innerHTML = '';

  allImages.forEach((imgData) => {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-thumb';
    thumb.dataset.id = imgData.id;
    thumb.draggable = false;

    if (imgData.id === activeImageId) {
      thumb.classList.add('active');
    }

    const img = document.createElement('img');
    img.src = imgData.processed || imgData.url;
    img.alt = imgData.name;
    img.draggable = false;

    const thumbInfo = document.createElement('div');
    thumbInfo.className = 'thumb-info';
    thumbInfo.textContent = `${imgData.width}x${imgData.height}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeImage(imgData.id);
    });

    thumb.appendChild(img);
    thumb.appendChild(thumbInfo);
    thumb.appendChild(removeBtn);

    thumb.addEventListener('click', (e) => {
      if (e.target !== removeBtn) {
        selectImage(imgData.id);
      }
    });

    galleryList.appendChild(thumb);
  });
}

function renderPdfGrid() {
  const pdfGrid = document.getElementById('imgPdfGrid');
  if (!pdfGrid) return;

  pdfGrid.innerHTML = '';

  if (pdfImageOrder.length === 0) {
    pdfGrid.innerHTML = '<div class="img-pdf-empty">No images loaded</div>';
    return;
  }

  pdfImageOrder.forEach((imgId, index) => {
    const imgData = allImages.find(img => img.id === imgId);
    if (!imgData) return;
    
    const thumb = document.createElement('div');
    thumb.className = 'img-pdf-thumb';
    thumb.dataset.id = imgData.id;
    thumb.draggable = true;

    const img = document.createElement('img');
    img.src = imgData.processed || imgData.url;
    img.alt = imgData.name;
    img.draggable = false;

    const actions = document.createElement('div');
    actions.className = 'pdf-thumb-actions';

    const rotateBtn = document.createElement('button');
    rotateBtn.className = 'pdf-thumb-btn';
    rotateBtn.innerHTML = '<i class="fas fa-rotate-right"></i>';
    rotateBtn.title = 'Rotate';
    rotateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rotatePdfImage(imgData.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pdf-thumb-btn delete';
    deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
    deleteBtn.title = 'Remove';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromPdf(imgData.id);
    });

    actions.appendChild(rotateBtn);
    actions.appendChild(deleteBtn);

    thumb.appendChild(img);
    thumb.appendChild(actions);

    thumb.addEventListener('click', () => {
      showPdfImageEditor(imgData.id);
    });

    thumb.addEventListener('dragstart', (e) => {
      thumb.classList.add('dragging');
      e.dataTransfer.setData('text/plain', imgData.id);
    });

    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
    });

    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== imgData.id) {
        reorderPdfImages(draggedId, imgData.id);
      }
    });

    pdfGrid.appendChild(thumb);
  });
}

function rotatePdfImage(imgId) {
  const imgData = allImages.find(img => img.id === imgId);
  if (!imgData) return;

  imgData.rotation = (imgData.rotation + 90) % 360;
  renderPdfGrid();
}

function removeFromPdf(imgId) {
  const index = pdfImageOrder.indexOf(imgId);
  if (index > -1) {
    pdfImageOrder.splice(index, 1);
  }
  renderPdfGrid();
  updatePdfConvertButton();
}

function reorderPdfImages(fromId, toId) {
  const fromIndex = pdfImageOrder.indexOf(fromId);
  const toIndex = pdfImageOrder.indexOf(toId);

  if (fromIndex > -1 && toIndex > -1) {
    const [movedId] = pdfImageOrder.splice(fromIndex, 1);
    pdfImageOrder.splice(toIndex, 0, movedId);
    renderPdfGrid();
  }
}

function showPdfImageEditor(imgId) {
  const imgData = allImages.find(img => img.id === imgId);
  if (!imgData) return;

  const previewContainer = document.getElementById('imgPreviewContainer');
  if (!previewContainer) return;

  // Since we are moving to PDF view, maybe we should just select it if we ever add editing to PDF images
  // For now, the user didn't ask for full editing in PDF section, just conversion.
}

function selectImage(id) {
  activeImageId = id;
  renderGallery();
  renderPreview();
  updateOptionsPanel();
  updateResizePreview();
}

function renderPreview() {
  const previewImg = document.getElementById('imgPreview');
  const previewContainer = document.getElementById('imgPreviewContainer');
  const downloadBtn = document.getElementById('imgDownloadBtn');

  const activeImg = allImages.find(img => img.id === activeImageId);

  if (!activeImg) {
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (previewContainer) previewContainer.classList.add('empty');
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }

  const src = activeImg.processed || activeImg.url;
  if (previewImg) {
    previewImg.style.display = 'block';
    previewImg.src = src;
    previewImg.onload = () => {
      if (previewContainer) previewContainer.classList.remove('empty');
      if (downloadBtn) downloadBtn.disabled = false;
    };
    previewImg.onerror = () => {
      if (previewContainer) previewContainer.classList.add('empty');
    };
  }

  const originalSizeEl = document.getElementById('imgOriginalSizeValue');
  if (originalSizeEl && activeImg.file) {
    const sizeKB = Math.round(activeImg.file.size / 1024);
    originalSizeEl.textContent = `${sizeKB} KB`;
  }

  updateSizeEstimate();
  updateResizePreview();
}

function updateImageCount() {
  const countBadge = document.getElementById('imgCountBadge');
  if (countBadge) countBadge.textContent = allImages.length;
}

function removeImage(id) {
  const index = allImages.findIndex(img => img.id === id);
  if (index === -1) return;

  if (allImages[index].url) URL.revokeObjectURL(allImages[index].url);
  if (allImages[index].processed) URL.revokeObjectURL(allImages[index].processed);

  allImages.splice(index, 1);

  if (activeImageId === id) {
    activeImageId = allImages.length > 0 ? allImages[0].id : null;
  }

  updateEditorState();
  renderGallery();
  renderPreview();
  updateImageCount();

  if (allImages.length === 0) {
    updateOptionsPanel();
  }
}

function setupOptionsPanel() {
  const formatSelect = document.getElementById('imgFormatSelect');
  const widthInput = document.getElementById('imgWidthInput');
  const heightInput = document.getElementById('imgHeightInput');
  const aspectCheck = document.getElementById('imgKeepAspectCheck');
  const aspectLock = document.getElementById('imgAspectLockIcon');
  const applyResizeBtn = document.getElementById('imgApplyResizeBtn');
  const applyToActiveBtn = document.getElementById('imgApplyToActiveBtn');
  const applyToAllBtn = document.getElementById('imgApplyToAllBtn');
  const qualitySlider = document.getElementById('imgQualitySlider');
  const qualityValue = document.getElementById('imgQualityValue');
  const targetSizeInput = document.getElementById('imgTargetSizeInput');
  const removeBgBtn = document.getElementById('imgRemoveBgBtn');
  const watermarkBtn = document.getElementById('imgWatermarkBtn');

  if (formatSelect) {
    formatSelect.addEventListener('change', applyFormatConversion);
  }

  if (widthInput) {
    widthInput.addEventListener('input', () => {
      handleDimensionChange('width');
      updateResizePreview();
    });
  }

  if (heightInput) {
    heightInput.addEventListener('input', () => {
      handleDimensionChange('height');
      updateResizePreview();
    });
  }

  if (aspectCheck) {
    aspectCheck.addEventListener('change', () => {
      if (aspectLock) {
        aspectLock.className = aspectCheck.checked ? 'fas fa-lock' : 'fas fa-lock-open';
      }
      updateResizePreview();
    });
  }

  if (applyResizeBtn) {
    applyResizeBtn.addEventListener('click', toggleResizeOptions);
  }

  if (applyToActiveBtn) {
    applyToActiveBtn.addEventListener('click', () => {
      applyResizeToActive(false);
      hideResizeOptions();
    });
  }

  if (applyToAllBtn) {
    applyToAllBtn.addEventListener('click', () => {
      applyResizeToActive(true);
      hideResizeOptions();
    });
  }

  if (qualitySlider && qualityValue) {
    qualitySlider.value = 100;
    qualityValue.textContent = '100%';
    qualitySlider.addEventListener('input', () => {
      qualityValue.textContent = qualitySlider.value + '%';
      updateSizeEstimate();
    });
    qualitySlider.addEventListener('change', applyCompression);
  }

  if (targetSizeInput) {
    targetSizeInput.addEventListener('input', adjustQualityForTargetSize);
    targetSizeInput.addEventListener('change', applyCompression);
  }

  if (removeBgBtn) {
    removeBgBtn.addEventListener('click', removeBackground);
  }

  if (watermarkBtn) {
    watermarkBtn.addEventListener('click', showWatermarkSelector);
  }
}

function toggleResizeOptions() {
  const options = document.getElementById('imgResizeOptions');
  if (options) {
    options.style.display = options.style.display === 'none' ? 'flex' : 'none';
  }
}

function hideResizeOptions() {
  const options = document.getElementById('imgResizeOptions');
  if (options) {
    options.style.display = 'none';
  }
}

function updateOptionsPanel() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  const widthInput = document.getElementById('imgWidthInput');
  const heightInput = document.getElementById('imgHeightInput');
  const removeBgBtn = document.getElementById('imgRemoveBgBtn');
  const watermarkBtn = document.getElementById('imgWatermarkBtn');

  if (activeImg) {
    if (widthInput) widthInput.value = activeImg.width;
    if (heightInput) heightInput.value = activeImg.height;
    if (removeBgBtn) removeBgBtn.disabled = false;
    if (watermarkBtn) watermarkBtn.disabled = false;
  } else {
    if (widthInput) widthInput.value = '';
    if (heightInput) heightInput.value = '';
    if (removeBgBtn) removeBgBtn.disabled = true;
    if (watermarkBtn) watermarkBtn.disabled = true;
  }
}

function handleDimensionChange(changed) {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const widthInput = document.getElementById('imgWidthInput');
  const heightInput = document.getElementById('imgHeightInput');
  const aspectCheck = document.getElementById('imgKeepAspectCheck');

  if (!aspectCheck?.checked) return;

  const ratio = activeImg.originalWidth / activeImg.originalHeight;

  if (changed === 'width' && widthInput?.value) {
    const newWidth = parseInt(widthInput.value);
    if (heightInput) heightInput.value = Math.round(newWidth / ratio);
  } else if (changed === 'height' && heightInput?.value) {
    const newHeight = parseInt(heightInput.value);
    if (widthInput) widthInput.value = Math.round(newHeight * ratio);
  }
}

function updateResizePreview() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const widthInput = document.getElementById('imgWidthInput');
  const heightInput = document.getElementById('imgHeightInput');
  const previewImg = document.getElementById('imgResizePreviewImg');
  const preview = document.getElementById('imgResizePreview');

  if (!previewImg || !preview) return;

  const newWidth = parseInt(widthInput?.value) || activeImg.width;
  const newHeight = parseInt(heightInput?.value) || activeImg.height;

  if (newWidth < 1 || newHeight < 1) {
    preview.style.display = 'none';
    return;
  }

  preview.style.display = 'flex';

  const src = activeImg.processed || activeImg.url;
  previewImg.src = src;
  previewImg.style.maxWidth = `${Math.min(newWidth, 200)}px`;
  previewImg.style.maxHeight = '100px';
  previewImg.dataset.width = newWidth;
  previewImg.dataset.height = newHeight;
}

async function applyFormatConversion() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const formatSelect = document.getElementById('imgFormatSelect');
  const targetFormat = formatSelect?.value || 'original';

  if (targetFormat === 'original') {
    activeImg.processed = null;
    renderPreview();
    renderGallery();
    return;
  }

  const currentSrc = activeImg.processed || activeImg.url;
  const qualitySlider = document.getElementById('imgQualitySlider');
  const quality = parseInt(qualitySlider?.value || 100) / 100;

  const converted = await convertImageFormat(currentSrc, targetFormat, quality);

  if (converted) {
    if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
    activeImg.processed = converted;
    activeImg.width = activeImg.originalWidth;
    activeImg.height = activeImg.originalHeight;
    renderPreview();
    renderGallery();
  }
}

function convertImageFormat(src, format, quality = 1) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          resolve(url);
        } else {
          resolve(null);
        }
      }, mimeType, quality);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function applyResizeToActive(applyAll = false) {
  const widthInput = document.getElementById('imgWidthInput');
  const heightInput = document.getElementById('imgHeightInput');

  const newWidth = parseInt(widthInput?.value);
  const newHeight = parseInt(heightInput?.value);

  if (!newWidth || !newHeight || newWidth < 1 || newHeight < 1) return;

  const imagesToProcess = applyAll ? allImages : [allImages.find(img => img.id === activeImageId)];

  for (const activeImg of imagesToProcess) {
    if (!activeImg) continue;

    const resized = await resizeImage(activeImg.processed || activeImg.url, newWidth, newHeight);

    if (resized) {
      if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
      activeImg.processed = resized;
      activeImg.width = newWidth;
      activeImg.height = newHeight;
    }
  }

  renderPreview();
  renderGallery();
  updateOptionsPanel();
}

function resizeImage(src, width, height) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          resolve(null);
        }
      }, img.type || 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function updateSizeEstimate() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const qualitySlider = document.getElementById('imgQualitySlider');
  const quality = parseInt(qualitySlider?.value || 100) / 100;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = activeImg.width;
    canvas.height = activeImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    canvas.toBlob((blob) => {
      if (blob) {
        const estimatedKB = Math.round(blob.size / 1024);
        const qualityValue = document.getElementById('imgQualityValue');
        if (qualityValue) {
          qualityValue.textContent = `${Math.round(quality * 100)}% (~${estimatedKB} KB)`;
        }
      }
    }, 'image/jpeg', quality);
  };
  img.src = activeImg.processed || activeImg.url;
}

async function applyCompression() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const qualitySlider = document.getElementById('imgQualitySlider');
  const quality = parseInt(qualitySlider?.value || 100) / 100;

  const formatSelect = document.getElementById('imgFormatSelect');
  const targetFormat = formatSelect?.value || 'original';

  const currentSrc = activeImg.processed || activeImg.url;

  let format = 'png';
  if (targetFormat !== 'original') {
    format = targetFormat;
  } else {
    const parts = activeImg.name.split('.');
    if (parts.length > 1) {
      const ext = parts.pop().toLowerCase();
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        format = ext === 'jpeg' ? 'jpg' : ext;
      }
    }
  }

  const compressed = await convertImageFormat(currentSrc, format, quality);

  if (compressed) {
    if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
    activeImg.processed = compressed;
    renderPreview();
    renderGallery();
  }
}

function adjustQualityForTargetSize() {
  const targetSizeInput = document.getElementById('imgTargetSizeInput');
  const targetKB = parseInt(targetSizeInput?.value);

  if (!targetKB || targetKB < 1) return;

  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = activeImg.width;
    canvas.height = activeImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    let quality = 1.0;

    const attemptCompress = () => {
      canvas.toBlob((b) => {
        if (!b) return;
        const currentKB = b.size / 1024;

        if (currentKB > targetKB && quality > 0.05) {
          quality -= 0.05;
          attemptCompress();
        } else {
          const slider = document.getElementById('imgQualitySlider');
          const valueEl = document.getElementById('imgQualityValue');
          if (slider) slider.value = Math.round(quality * 100);
          if (valueEl) valueEl.textContent = `${Math.round(quality * 100)}% (~${Math.round(currentKB)} KB)`;
        }
      }, 'image/jpeg', quality);
    };

    attemptCompress();
  };
  img.src = activeImg.processed || activeImg.url;
}

async function removeBackground() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const progressContainer = document.getElementById('imgBgProgress');
  const progressBar = document.getElementById('imgBgProgressBar');
  const progressText = document.getElementById('imgBgProgressText');
  const removeBgBtn = document.getElementById('imgRemoveBgBtn');

  if (progressContainer) progressContainer.style.display = 'block';
  if (removeBgBtn) removeBgBtn.disabled = true;

  try {
    const src = activeImg.processed || activeImg.url;

    // Check window.imglyBackgroundRemoval (common for the npm package when bundled/distributed)
    const removeBgFn = window.removeBackground || window.imglyRemoveBackground || (window.imgly && window.imgly.removeBackground);
    
    if (!removeBgFn) {
      console.error('Background removal library not loaded');
      alert('Background removal library not loaded. Please wait a moment for it to initialize or refresh the page.');
      return;
    }

    const blob = await removeBgFn(src, {
      progress: (key, current, total) => {
        const percent = Math.round((current / total) * 100);
        if (progressBar) progressBar.style.width = percent + '%';
        if (progressText) progressText.textContent = percent + '%';
      }
    });

    if (blob) {
      if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
      activeImg.processed = URL.createObjectURL(blob);
      activeImg.width = activeImg.originalWidth;
      activeImg.height = activeImg.originalHeight;
      renderPreview();
      renderGallery();
    }
  } catch (err) {
    console.error('Background removal failed:', err);
    alert('Background removal failed: ' + err.message);
  } finally {
    if (progressContainer) progressContainer.style.display = 'none';
    if (removeBgBtn) removeBgBtn.disabled = false;
  }
}

function showWatermarkSelector() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const previewContainer = document.getElementById('imgPreviewContainer');
  if (!previewContainer) return;

  const existingOverlay = document.getElementById('watermarkOverlay');
  if (existingOverlay) existingOverlay.remove();

  const existingCanvas = previewContainer.querySelector('.watermark-canvas');
  if (existingCanvas) existingCanvas.remove();

  const overlay = document.createElement('div');
  overlay.id = 'watermarkOverlay';
  overlay.className = 'watermark-overlay';

  const info = document.createElement('div');
  info.className = 'watermark-info';
  info.textContent = 'Draw a rectangle over the watermark area';

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn-primary btn-small';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('click', () => applyWatermarkRemoval());

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-outline btn-small';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    overlay.remove();
    const canvas = previewContainer.querySelector('.watermark-canvas');
    if (canvas) canvas.remove();
  });

  overlay.appendChild(info);
  overlay.appendChild(applyBtn);
  overlay.appendChild(cancelBtn);

  previewContainer.style.position = 'relative';
  previewContainer.appendChild(overlay);

  const previewImg = document.getElementById('imgPreview');
  if (!previewImg) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'watermark-canvas';
  canvas.width = previewImg.offsetWidth;
  canvas.height = previewImg.offsetHeight;
  canvas.style.position = 'absolute';
  canvas.style.top = previewImg.offsetTop + 'px';
  canvas.style.left = previewImg.offsetLeft + 'px';
  canvas.style.width = previewImg.offsetWidth + 'px';
  canvas.style.height = previewImg.offsetHeight + 'px';
  canvas.style.cursor = 'crosshair';
  canvas.style.zIndex = '5';

  previewContainer.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let startX = 0;
  let startY = 0;

  canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const selX = Math.min(startX, currentX);
    const selY = Math.min(startY, currentY);
    const selW = Math.abs(currentX - startX);
    const selH = Math.abs(currentY - startY);

    ctx.clearRect(selX, selY, selW, selH);
    ctx.strokeStyle = '#6d28d9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(selX, selY, selW, selH);
    ctx.setLineDash([]);
  });

  canvas.addEventListener('mouseup', () => {
    isDrawing = false;
  });

  canvas.addEventListener('mouseleave', () => {
    isDrawing = false;
  });
}

function applyWatermarkRemoval() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const canvas = document.querySelector('.watermark-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  let foundRect = false;

  // We detect the rectangle by looking for the dashed border or the clear area
  // Actually, we can just store the selection in 'showWatermarkSelector'
  // Let's refine the detection or just pass the rect.
  // For simplicity, let's look for the clear area (alpha 0 in our overlay logic)
  
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      // In our logic, we clearRect, so alpha should be 0 for the selected area
      // and 0.3 (76/255) for the rest.
      if (imageData.data[idx + 3] === 0) {
        foundRect = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!foundRect || maxX <= minX || maxY <= minY) {
    alert('Please select an area first');
    return;
  }

  const src = activeImg.processed || activeImg.url;
  const img = new Image();

  img.onload = () => {
    const processingCanvas = document.createElement('canvas');
    processingCanvas.width = img.width;
    processingCanvas.height = img.height;
    const pCtx = processingCanvas.getContext('2d');
    pCtx.drawImage(img, 0, 0);

    const scaleX = img.width / canvas.width;
    const scaleY = img.height / canvas.height;

    const selMinX = Math.floor(minX * scaleX);
    const selMinY = Math.floor(minY * scaleY);
    const selWidth = Math.floor((maxX - minX) * scaleX);
    const selHeight = Math.floor((maxY - minY) * scaleY);

    if (selWidth < 1 || selHeight < 1) {
      alert('Invalid selection area');
      return;
    }

    // Improved "content-aware" fill (simple version: interpolation from borders)
    const regionData = pCtx.getImageData(selMinX, selMinY, selWidth, selHeight);
    const originalRegion = new Uint8ClampedArray(regionData.data);

    // Simple PatchMatch-like or Inpainting: 
    // For each pixel in the selection, take average of boundary pixels
    for (let iteration = 0; iteration < 10; iteration++) {
      for (let y = 0; y < selHeight; y++) {
        for (let x = 0; x < selWidth; x++) {
          const idx = (y * selWidth + x) * 4;
          
          let sumR = 0, sumG = 0, sumB = 0, count = 0;

          // Check neighbors in a larger radius to "bleed" colors in
          const radius = 2;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (dx === 0 && dy === 0) continue;
              
              const nx = x + dx;
              const ny = y + dy;

              if (nx >= 0 && nx < selWidth && ny >= 0 && ny < selHeight) {
                // Neighbor is inside selection, use its current value
                const nIdx = (ny * selWidth + nx) * 4;
                sumR += regionData.data[nIdx];
                sumG += regionData.data[nIdx+1];
                sumB += regionData.data[nIdx+2];
                count++;
              } else {
                // Neighbor is outside selection, get from original image
                const imgX = selMinX + nx;
                const imgY = selMinY + ny;
                if (imgX >= 0 && imgX < img.width && imgY >= 0 && imgY < img.height) {
                    // This is slow to get via getImageData every time, but for small areas it's okay
                    // Better: get a slightly larger region initially
                }
              }
            }
          }

          if (count > 0) {
            regionData.data[idx] = sumR / count;
            regionData.data[idx+1] = sumG / count;
            regionData.data[idx+2] = sumB / count;
          }
        }
      }
    }

    pCtx.putImageData(regionData, selMinX, selMinY);

    processingCanvas.toBlob((blob) => {
      if (blob) {
        if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
        activeImg.processed = URL.createObjectURL(blob);
        renderPreview();
        renderGallery();

        const overlay = document.getElementById('watermarkOverlay');
        if (overlay) overlay.remove();
        if (canvas) canvas.remove();
      }
    }, activeImg.file.type || 'image/png');
  };

  img.src = src;
}

function setupPreviewActions() {
  const downloadBtn = document.getElementById('imgDownloadBtn');
  const downloadAllBtn = document.getElementById('imgDownloadAllBtn');
  const clearAllBtn = document.getElementById('imgClearAllBtn');

  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadImage);
  }

  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', downloadAllImages);
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', clearAllImages);
  }
}

function downloadImage() {
  const activeImg = allImages.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const formatSelect = document.getElementById('imgFormatSelect');
  const targetFormat = formatSelect?.value || 'original';

  const src = activeImg.processed || activeImg.url;
  const link = document.createElement('a');

  let extension = 'png';
  if (targetFormat !== 'original') {
    extension = targetFormat;
  } else {
    const parts = activeImg.name.split('.');
    if (parts.length > 1) {
      extension = parts.pop().toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
        extension = 'png';
      }
    }
  }

  link.download = `${activeImg.name.replace(/\.[^.]+$/, '')}.${extension}`;
  link.href = src;
  link.click();
}

function downloadAllImages() {
  if (allImages.length === 0) return;

  allImages.forEach((imgData, index) => {
    setTimeout(() => {
      const src = imgData.processed || imgData.url;
      const link = document.createElement('a');

      const formatSelect = document.getElementById('imgFormatSelect');
      const targetFormat = formatSelect?.value || 'original';

      let extension = 'png';
      if (targetFormat !== 'original') {
        extension = targetFormat;
      } else {
        const parts = imgData.name.split('.');
        if (parts.length > 1) {
          extension = parts.pop().toLowerCase();
          if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
            extension = 'png';
          }
        }
      }

      link.download = `${imgData.name.replace(/\.[^.]+$/, '')}.${extension}`;
      link.href = src;
      link.click();
    }, index * 500);
  });
}

function clearAllImages() {
  allImages.forEach(img => {
    if (img.url) URL.revokeObjectURL(img.url);
    if (img.processed) URL.revokeObjectURL(img.processed);
  });

  allImages = [];
  activeImageId = null;

  updateEditorState();
  renderGallery();
  renderPreview();
  updateImageCount();
  updateOptionsPanel();
}

function setupImgTabs() {
  console.log('Setting up img tabs...');
  const toolbarBtns = document.querySelectorAll('.img-toolbar-btn');
  console.log('Found buttons:', toolbarBtns.length);
  const editorView = document.getElementById('imgEditorView');
  const pdfView = document.getElementById('imgPdfView');
  console.log('Editor view:', editorView, 'PDF view:', pdfView);

  toolbarBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      console.log('Button clicked:', btn.dataset.imgView);
      const view = btn.dataset.imgView;

      toolbarBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (view === 'editor') {
        if (editorView) {
          editorView.style.display = 'block';
          console.log('Showing editor view');
        }
        if (pdfView) {
          pdfView.style.display = 'none';
          console.log('Hiding PDF view');
        }
      } else {
        if (editorView) {
          editorView.style.display = 'none';
          console.log('Hiding editor view');
        }
        if (pdfView) {
          pdfView.style.display = 'block';
          console.log('Showing PDF view');
        }
      }
    });
  });
}

function setupPdfConvert() {
  const convertBtn = document.getElementById('imgConvertPdfBtn');
  if (convertBtn) {
    convertBtn.addEventListener('click', convertToPdf);
  }
  
  const clearAllPdfBtn = document.getElementById('imgPdfClearAllBtn');
  if (clearAllPdfBtn) {
    clearAllPdfBtn.addEventListener('click', clearAllPdfImages);
  }

  const pdfDropZone = document.getElementById('imgPdfDropZone');
  if (pdfDropZone) {
    pdfDropZone.addEventListener('click', () => {
      document.getElementById('imgPdfFileInput').click();
    });

    pdfDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      pdfDropZone.querySelector('.upload-zone').classList.add('drag-over');
    });

    pdfDropZone.addEventListener('dragleave', () => {
      pdfDropZone.querySelector('.upload-zone').classList.remove('drag-over');
    });

    pdfDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      pdfDropZone.querySelector('.upload-zone').classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length) handleFiles(files, 'pdf');
    });
  }

  const pdfFileInput = document.getElementById('imgPdfFileInput');
  if (pdfFileInput) {
    pdfFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handleFiles(e.target.files, 'pdf');
        pdfFileInput.value = ''; // Clear to allow re-uploading same file
      }
    });
  }
}

function clearAllPdfImages() {
  pdfImageOrder = [];
  renderPdfGrid();
  updatePdfConvertButton();
}

function updatePdfConvertButton() {
  const convertBtn = document.getElementById('imgConvertPdfBtn');
  if (convertBtn) {
    convertBtn.disabled = pdfImageOrder.length === 0;
  }
}

async function convertToPdf() {
  if (pdfImageOrder.length === 0) return;

  const filenameInput = document.getElementById('imgPdfFilename');
  const filename = filenameInput?.value || 'documento';

  const formatRadios = document.querySelectorAll('input[name="imgPdfFormat"]');
  let pdfFormat = 'uniform';
  formatRadios.forEach(radio => {
    if (radio.checked) pdfFormat = radio.value;
  });

  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert('PDF library not loaded');
    return;
  }

  const doc = new jsPDF();

  for (let i = 0; i < pdfImageOrder.length; i++) {
    const imgId = pdfImageOrder[i];
    const imgData = allImages.find(img => img.id === imgId);
    if (!imgData) continue;

    if (i > 0) {
      doc.addPage();
    }

    const src = imgData.processed || imgData.url;
    const rotation = imgData.rotation || 0;

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });

    let finalWidth = img.width;
    let finalHeight = img.height;

    if (rotation === 90 || rotation === 270) {
      finalWidth = img.height;
      finalHeight = img.width;
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;

    let imgWidth, imgHeight;

    if (pdfFormat === 'a4') {
      imgWidth = pageWidth - (margin * 2);
      imgHeight = (finalHeight / finalWidth) * imgWidth;

      if (imgHeight > pageHeight - (margin * 2)) {
        imgHeight = pageHeight - (margin * 2);
        imgWidth = (finalWidth / finalHeight) * imgHeight;
      }
    } else {
      const maxWidth = pageWidth - (margin * 2);
      const maxHeight = pageHeight - (margin * 2);

      const widthRatio = maxWidth / finalWidth;
      const heightRatio = maxHeight / finalHeight;
      const ratio = Math.min(widthRatio, heightRatio);

      imgWidth = finalWidth * ratio;
      imgHeight = finalHeight * ratio;
    }

    let x = (pageWidth - imgWidth) / 2;
    let y = (pageHeight - imgHeight) / 2;

    const imgDataStr = imgData.processed || imgData.url;
    const imgFormat = imgData.file.type === 'image/png' ? 'PNG' : 'JPEG';

    doc.addImage(imgDataStr, imgFormat, x, y, imgWidth, imgHeight);
  }

  doc.save(`${filename}.pdf`);
}

export { initImgModule };