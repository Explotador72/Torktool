/**
 * Image Processing Module - Client-side image editing
 */

let images = [];
let activeImageId = null;

const SUPPORTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic', 'image/bmp', 'image/avif'];

function initImgModule() {
  setupDropZone();
  setupFileInput();
  setupOptionsPanel();
  setupPreviewActions();
  setupMiniDropZones();
}

function generateId() {
  return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function setupDropZone() {
  const dropZone = document.getElementById('imgDropZone');
  if (!dropZone) return;

  dropZone.addEventListener('click', () => {
    document.getElementById('imgFileInput').click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) handleFiles(files);
  });
}

function setupFileInput() {
  const fileInput = document.getElementById('imgFileInput');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFiles(e.target.files);
  });
}

function setupMiniDropZones() {
  const miniDropZone = document.getElementById('imgMiniDropZone');
  const compactDropZone = document.getElementById('imgCompactDropZone');

  [miniDropZone, compactDropZone].forEach(zone => {
    if (!zone) return;

    zone.addEventListener('click', () => {
      document.getElementById('imgFileInput').click();
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length) handleFiles(files);
    });
  });
}

async function handleFiles(files) {
  const validFiles = Array.from(files).filter(file => {
    if (file.type === 'image/heic') return true;
    if (SUPPORTED_FORMATS.includes(file.type)) return true;
    return false;
  });

  if (validFiles.length === 0) return;

  for (const file of validFiles) {
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
      images.push(imageData);
    }
  }

  updateEditorState();
  renderGallery();

  if (!activeImageId && images.length > 0) {
    selectImage(images[0].id);
  }

  updateImageCount();
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

  if (images.length > 0) {
    initialState.style.display = 'none';
    editorLayout.style.display = 'grid';
  } else {
    initialState.style.display = 'flex';
    editorLayout.style.display = 'none';
  }
}

function renderGallery() {
  const galleryList = document.getElementById('imgGalleryList');
  if (!galleryList) return;

  galleryList.innerHTML = '';

  images.forEach((imgData, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-thumb';
    thumb.dataset.id = imgData.id;

    if (imgData.id === activeImageId) {
      thumb.classList.add('active');
    }

    const img = document.createElement('img');
    img.src = imgData.processed || imgData.url;
    img.alt = imgData.name;

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

    thumb.addEventListener('click', () => selectImage(imgData.id));

    galleryList.appendChild(thumb);
  });
}

function selectImage(id) {
  activeImageId = id;
  renderGallery();
  renderPreview();
  updateOptionsPanel();
}

function renderPreview() {
  const previewImg = document.getElementById('imgPreview');
  const previewContainer = document.getElementById('imgPreviewContainer');
  const downloadBtn = document.getElementById('imgDownloadBtn');

  const activeImg = images.find(img => img.id === activeImageId);

  if (!activeImg) {
    if (previewImg) previewImg.src = '';
    if (previewContainer) previewContainer.classList.add('empty');
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }

  const src = activeImg.processed || activeImg.url;
  if (previewImg) {
    previewImg.src = src;
    previewImg.onload = () => {
      if (previewContainer) previewContainer.classList.remove('empty');
      if (downloadBtn) downloadBtn.disabled = false;
    };
  }

  const originalSizeEl = document.getElementById('imgOriginalSizeValue');
  if (originalSizeEl && activeImg.file) {
    const sizeKB = Math.round(activeImg.file.size / 1024);
    originalSizeEl.textContent = `${sizeKB} KB`;
  }

  updateSizeEstimate();
}

function updateImageCount() {
  const countBadge = document.getElementById('imgCountBadge');
  if (countBadge) countBadge.textContent = images.length;
}

function removeImage(id) {
  const index = images.findIndex(img => img.id === id);
  if (index === -1) return;

  if (images[index].url) URL.revokeObjectURL(images[index].url);
  if (images[index].processed) URL.revokeObjectURL(images[index].processed);

  images.splice(index, 1);

  if (activeImageId === id) {
    activeImageId = images.length > 0 ? images[0].id : null;
  }

  updateEditorState();
  renderGallery();
  renderPreview();
  updateImageCount();

  if (images.length === 0) {
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
  const qualitySlider = document.getElementById('imgQualitySlider');
  const qualityValue = document.getElementById('imgQualityValue');
  const targetSizeInput = document.getElementById('imgTargetSizeInput');
  const removeBgBtn = document.getElementById('imgRemoveBgBtn');
  const watermarkBtn = document.getElementById('imgWatermarkBtn');

  if (formatSelect) {
    formatSelect.addEventListener('change', applyFormatConversion);
  }

  if (widthInput) {
    widthInput.addEventListener('input', () => handleDimensionChange('width'));
  }

  if (heightInput) {
    heightInput.addEventListener('input', () => handleDimensionChange('height'));
  }

  if (aspectCheck) {
    aspectCheck.addEventListener('change', () => {
      if (aspectLock) {
        aspectLock.className = aspectCheck.checked ? 'fas fa-lock' : 'fas fa-lock-open';
      }
    });
  }

  if (applyResizeBtn) {
    applyResizeBtn.addEventListener('click', applyResizeToActive);
  }

  if (qualitySlider && qualityValue) {
    qualitySlider.addEventListener('input', () => {
      qualityValue.textContent = qualitySlider.value + '%';
      updateSizeEstimate();
    });
  }

  if (targetSizeInput) {
    targetSizeInput.addEventListener('input', adjustQualityForTargetSize);
  }

  if (removeBgBtn) {
    removeBgBtn.addEventListener('click', removeBackground);
  }

  if (watermarkBtn) {
    watermarkBtn.addEventListener('click', showWatermarkSelector);
  }
}

function updateOptionsPanel() {
  const activeImg = images.find(img => img.id === activeImageId);
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
  const activeImg = images.find(img => img.id === activeImageId);
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

async function applyFormatConversion() {
  const activeImg = images.find(img => img.id === activeImageId);
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
  const converted = await convertImageFormat(currentSrc, targetFormat);

  if (converted) {
    if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
    activeImg.processed = converted;
    renderPreview();
    renderGallery();
  }
}

function convertImageFormat(src, format) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const mimeType = `image/${format}`;
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          resolve(url);
        } else {
          resolve(null);
        }
      }, mimeType, 0.92);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function applyResizeToActive() {
  const activeImg = images.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const widthInput = document.getElementById('imgWidthInput');
  const heightInput = document.getElementById('imgHeightInput');

  const newWidth = parseInt(widthInput?.value);
  const newHeight = parseInt(heightInput?.value);

  if (!newWidth || !newHeight || newWidth < 1 || newHeight < 1) return;

  const resized = await resizeImage(activeImg.processed || activeImg.url, newWidth, newHeight);

  if (resized) {
    if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
    activeImg.processed = resized;
    activeImg.width = newWidth;
    activeImg.height = newHeight;
    renderPreview();
    renderGallery();
    updateOptionsPanel();
  }
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
  const activeImg = images.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const qualitySlider = document.getElementById('imgQualitySlider');
  const quality = parseInt(qualitySlider?.value || 90) / 100;

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
          const originalSize = activeImg.file.size / 1024;
          qualityValue.textContent = `${Math.round(quality * 100)}% (~${estimatedKB} KB)`;
        }
      }
    }, 'image/jpeg', quality);
  };
  img.src = activeImg.processed || activeImg.url;
}

function adjustQualityForTargetSize() {
  const targetSizeInput = document.getElementById('imgTargetSizeInput');
  const targetKB = parseInt(targetSizeInput?.value);

  if (!targetKB || targetKB < 1) return;

  const activeImg = images.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = activeImg.width;
    canvas.height = activeImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    let quality = 0.9;
    let blob;

    const attemptCompress = () => {
      canvas.toBlob((b) => {
        blob = b;
        const currentKB = b.size / 1024;

        if (currentKB > targetKB && quality > 0.1) {
          quality -= 0.1;
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
  const activeImg = images.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const progressContainer = document.getElementById('imgBgProgress');
  const progressBar = document.getElementById('imgBgProgressBar');
  const progressText = document.getElementById('imgBgProgressText');
  const removeBgBtn = document.getElementById('imgRemoveBgBtn');

  if (progressContainer) progressContainer.style.display = 'block';
  if (removeBgBtn) removeBgBtn.disabled = true;

  try {
    const src = activeImg.processed || activeImg.url;

    const removeBackground = window.removeBackground;
    if (!removeBackground) {
      console.error('Background removal library not loaded');
      return;
    }

    const blob = await removeBackground(src, {
      progress: (key, current, total) => {
        const percent = Math.round((current / total) * 100);
        if (progressBar) progressBar.style.width = percent + '%';
        if (progressText) progressText.textContent = percent + '%';
      }
    });

    if (blob) {
      if (activeImg.processed) URL.revokeObjectURL(activeImg.processed);
      activeImg.processed = URL.createObjectURL(blob);
      renderPreview();
      renderGallery();
    }
  } catch (err) {
    console.error('Background removal failed:', err);
  } finally {
    if (progressContainer) progressContainer.style.display = 'none';
    if (removeBgBtn) removeBgBtn.disabled = false;
  }
}

function showWatermarkSelector() {
  const activeImg = images.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const previewContainer = document.getElementById('imgPreviewContainer');
  if (!previewContainer) return;

  const existingOverlay = document.getElementById('watermarkOverlay');
  if (existingOverlay) existingOverlay.remove();

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
  cancelBtn.addEventListener('click', () => overlay.remove());

  overlay.appendChild(info);
  overlay.appendChild(applyBtn);
  overlay.appendChild(cancelBtn);

  previewContainer.style.position = 'relative';
  previewContainer.appendChild(overlay);

  let isDrawing = false;
  let startX, startY, rect;

  const previewImg = document.getElementById('imgPreview');
  if (!previewImg) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'watermark-canvas';
  canvas.width = previewImg.offsetWidth;
  canvas.height = previewImg.offsetHeight;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.cursor = 'crosshair';

  const ctx = canvas.getContext('2d');

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
    ctx.strokeStyle = '#6d28d9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
    ctx.setLineDash([]);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    const rect = canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
  });

  previewContainer.appendChild(canvas);
}

function applyWatermarkRemoval() {
  const activeImg = images.find(img => img.id === activeImageId);
  if (!activeImg) return;

  const canvas = document.querySelector('.watermark-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
  let foundRect = false;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const alpha = imageData.data[(y * canvas.width + x) * 4 + 3];
      if (alpha > 0) {
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

    const scaleX = img.width / canvas.offsetWidth;
    const scaleY = img.height / canvas.offsetHeight;

    const selMinX = Math.floor(minX * scaleX);
    const selMinY = Math.floor(minY * scaleY);
    const selWidth = Math.floor((maxX - minX) * scaleX);
    const selHeight = Math.floor((maxY - minY) * scaleY);

    const regionData = pCtx.getImageData(selMinX, selMinY, selWidth, selHeight);

    for (let y = 0; y < selHeight; y++) {
      for (let x = 0; x < selWidth; x++) {
        const idx = (y * selWidth + x) * 4;

        let leftPixel, rightPixel, topPixel, bottomPixel;

        if (x > 0) {
          leftPixel = {
            r: regionData.data[idx - 4],
            g: regionData.data[idx - 3],
            b: regionData.data[idx - 2]
          };
        }
        if (x < selWidth - 1) {
          rightPixel = {
            r: regionData.data[idx + 4],
            g: regionData.data[idx + 5],
            b: regionData.data[idx + 6]
          };
        }
        if (y > 0) {
          topPixel = {
            r: regionData.data[idx - selWidth * 4],
            g: regionData.data[idx - selWidth * 4 + 1],
            b: regionData.data[idx - selWidth * 4 + 2]
          };
        }
        if (y < selHeight - 1) {
          bottomPixel = {
            r: regionData.data[idx + selWidth * 4],
            g: regionData.data[idx + selWidth * 4 + 1],
            b: regionData.data[idx + selWidth * 4 + 2]
          };
        }

        const neighbors = [leftPixel, rightPixel, topPixel, bottomPixel].filter(p => p);
        if (neighbors.length > 0) {
          const avgR = neighbors.reduce((s, p) => s + p.r, 0) / neighbors.length;
          const avgG = neighbors.reduce((s, p) => s + p.g, 0) / neighbors.length;
          const avgB = neighbors.reduce((s, p) => s + p.b, 0) / neighbors.length;

          regionData.data[idx] = avgR;
          regionData.data[idx + 1] = avgG;
          regionData.data[idx + 2] = avgB;
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
  const activeImg = images.find(img => img.id === activeImageId);
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
  if (images.length === 0) return;

  images.forEach((imgData, index) => {
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
  images.forEach(img => {
    if (img.url) URL.revokeObjectURL(img.url);
    if (img.processed) URL.revokeObjectURL(img.processed);
  });

  images = [];
  activeImageId = null;

  updateEditorState();
  renderGallery();
  renderPreview();
  updateImageCount();
  updateOptionsPanel();
}

export { initImgModule };