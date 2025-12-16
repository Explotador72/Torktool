// Conversor IMG → PDF
const imgInput = document.getElementById("imgInput");
const btnPdf = document.getElementById("convertPdfBtn");
const previewPdf = document.getElementById("previewPdf");
const fileName = document.getElementById("nameInput");
const A4Checkbox = document.getElementById("A4Checkbox");
const uniformCheckbox = document.getElementById("UniformCheckbox");
const dropOverlay = document.getElementById("dropOverlay");
const pdfconvert = document.getElementById("imgpdf");


const MAX_WIDTH = 190; // mm
const MAX_HEIGHT = 277; // A4 tamaño aproximado

let currentLightboxIndex = 0;
let currentLightboxModal = null;

let images = [];
let isDraggingOver = false;
let internalDrag = false;


A4Checkbox.addEventListener('change', () => {
    if (A4Checkbox.checked) {
        uniformCheckbox.checked = false;
    } else {
        uniformCheckbox.checked = true;
    }
});

uniformCheckbox.addEventListener('change', () => {
    if (uniformCheckbox.checked) {
        A4Checkbox.checked = false;
    } else {
        A4Checkbox.checked = true;
    }
});

// Mostrar miniaturas
imgInput.addEventListener("change", () => {
  const newFiles = Array.from(imgInput.files);
  const newItems = newFiles.map(f => ({ file: f, id: cryptoRandomId(), rotationAngle: 0 }));
  images = images.concat(newItems);
  imgInput.value = "";
  renderPreviewsImg();
  btnPdf.disabled = images.length === 0;
});

// Drag & Drop - Mostrar overlay
document.addEventListener('dragenter', e => {
  if (!internalDrag) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      if (!isDraggingOver && pdfconvert.classList.contains('active')) {
        isDraggingOver = true;
        dropOverlay.classList.add('active');
      }
    }
  }});

// Drag & Drop - Ocultar overlay
document.addEventListener('dragleave', e => {
  if (!internalDrag) {
    e.preventDefault();
    if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      isDraggingOver = false;
      dropOverlay.classList.remove('active');
    }
}});

// Drag & Drop - Prevenir comportamiento por defecto
document.addEventListener('dragover', e => e.preventDefault());

// Drag & Drop - Soltar archivos
document.addEventListener('drop', e => {
  if (!internalDrag) {
    e.preventDefault();
    isDraggingOver = false;
    dropOverlay.classList.remove('active');
    if (e.dataTransfer.files.length > 0 && pdfconvert.classList.contains('active')) {
      handleImageFiles(e.dataTransfer.files);
    }
  }});

function renderPreviewsImg() {
  previewPdf.innerHTML = "";

  images.forEach((item, index) => {
    const file = item.file;
    const url = URL.createObjectURL(file);
    const div = document.createElement("div");
    div.className = "preview-thumb";
    div.draggable = true;

    const numberTag = document.createElement("span");
    numberTag.className = "index-number";
    numberTag.textContent = index + 1;

    const btnRotate = document.createElement('span');
    btnRotate.className = "rotate-btn";
    btnRotate.innerHTML = "↻";
    btnRotate.dataset.id = item.id;
    btnRotate.addEventListener("click", () => {
      if (!item.rotationAngle) item.rotationAngle = 0;
      item.rotationAngle = (item.rotationAngle + 90) % 360;
      renderPreviewsImg();
    });

    const btnClose = document.createElement("span");
    btnClose.className = "close-btn";
    btnClose.innerHTML = "✕";
    btnClose.dataset.id = item.id;
    btnClose.addEventListener("click", () => {
      const removeIndex = images.findIndex(x => x.id === btnClose.dataset.id);
      if (removeIndex > -1) {
        images.splice(removeIndex, 1);
        renderPreviewsImg();
        btnPdf.disabled = images.length === 0;
      }
    });

    const img = document.createElement("img");
    img.src = url;
    img.addEventListener("click", () => {
      createLightboxModal(index);
    });
    if (item.rotationAngle) {
      img.style.transform = `rotate(${item.rotationAngle}deg)`;
    }

    div.appendChild(numberTag);
    div.appendChild(btnClose);
    div.appendChild(btnRotate);
    div.appendChild(img);
    previewPdf.appendChild(div);

    // Drag & Drop para reordenar
    div.addEventListener("dragstart", e => {
      internalDrag = true
      e.dataTransfer.setData("text/plain", index);
      div.classList.add("dragging");
    });

    div.addEventListener("dragend", e => {
      div.classList.remove("dragging")
      internalDrag = false;
  });

    div.addEventListener("dragover", e => {
      e.preventDefault();
      div.classList.add("dragover");
    });

    div.addEventListener("dragleave", e => {
      div.classList.remove("dragover")
    });

    div.addEventListener("drop", e => {
      e.preventDefault();
      div.classList.remove("dragover");
      
      e.stopPropagation();
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
      const toIndex = index;

      if (fromIndex === toIndex) return;

      const movedItem = images.splice(fromIndex, 1)[0];
      images.splice(toIndex, 0, movedItem);
      renderPreviewsImg();
      internalDrag = false
    });

    internalDrag = false;
  });
}


function createLightboxModal(startIndex) {
    // Cerrar modal anterior si existe
    if (currentLightboxModal) {
        currentLightboxModal.remove();
    }
    
    currentLightboxIndex = startIndex;
    const currentItem = images[currentLightboxIndex];
    
    const modal = document.createElement("div");
    modal.className = "lightbox-modal";
    
    modal.innerHTML = `
        <div class="lightbox-content">
            <button class="lightbox-close">✕</button>
            <button class="lightbox-nav lightbox-prev" ${currentLightboxIndex === 0 ? 'disabled' : ''}>
                ‹
            </button>
            <button class="lightbox-nav lightbox-next" ${currentLightboxIndex === images.length - 1 ? 'disabled' : ''}>
                ›
            </button>
            <img src="" class="lightbox-img" alt="Vista previa ampliada">
        </div>
    `;
    
    document.body.appendChild(modal);
    currentLightboxModal = modal;
    
    const lightboxImg = modal.querySelector(".lightbox-img");
    const prevBtn = modal.querySelector(".lightbox-prev");
    const nextBtn = modal.querySelector(".lightbox-next");
    const closeBtn = modal.querySelector(".lightbox-close");
    const infoSpan = modal.querySelector(".lightbox-info span:last-child");
    
    // Cargar imagen actual
    lightboxImg.src = URL.createObjectURL(currentItem.file);
    if (currentItem.rotationAngle) {
        lightboxImg.style.transform = `rotate(${currentItem.rotationAngle}deg)`;
    }
    
    // Función para cambiar de imagen
    function changeImage(newIndex) {
        if (newIndex < 0 || newIndex >= images.length) return;
        
        currentLightboxIndex = newIndex;
        const newItem = images[currentLightboxIndex];
        
        // Actualizar imagen
        const newUrl = URL.createObjectURL(newItem.file);
        lightboxImg.src = newUrl;
        
        // Aplicar rotación si existe
        if (newItem.rotationAngle) {
            lightboxImg.style.transform = `rotate(${newItem.rotationAngle}deg)`;
        } else {
            lightboxImg.style.transform = 'none';
        }
                
        // Actualizar estado de botones
        prevBtn.disabled = currentLightboxIndex === 0;
        nextBtn.disabled = currentLightboxIndex === images.length - 1;
    }
    
    // Eventos de navegación
    prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentLightboxIndex > 0) {
            changeImage(currentLightboxIndex - 1);
        }
    });
    
    nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentLightboxIndex < images.length - 1) {
            changeImage(currentLightboxIndex + 1);
        }
    });
    
    // Navegación con teclado
    const handleKeyDown = (e) => {
        switch(e.key) {
            case "ArrowLeft":
                if (currentLightboxIndex > 0) {
                    changeImage(currentLightboxIndex - 1);
                }
                break;
            case "ArrowRight":
                if (currentLightboxIndex < images.length - 1) {
                    changeImage(currentLightboxIndex + 1);
                }
                break;
            case "Escape":
                closeLightbox();
                break;
        }
    };
    
    // Mostrar modal
    setTimeout(() => {
        modal.classList.add("active");
        document.addEventListener("keydown", handleKeyDown);
    }, 10);
    
    // Función para cerrar el lightbox
    function closeLightbox() {
        modal.classList.remove("active");
        document.removeEventListener("keydown", handleKeyDown);
        setTimeout(() => {
            if (modal.parentNode) {
                modal.remove();
            }
            currentLightboxModal = null;
        }, 300);
    }
    
    // Cerrar al hacer clic
    closeBtn.addEventListener("click", closeLightbox);
    
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            closeLightbox();
        }
    });
    
    return modal;
}


function handleImageFiles(fileList) {
  const validFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (!validFiles.length) return alert("Solo se aceptan imágenes");
  
  images.push(...validFiles.map(f => ({
    file: f,
    id: cryptoRandomId(),
    rotationAngle: 0
  })));
  
  renderPreviewsImg();
  btnPdf.disabled = !images.length;
  
  showNotification(`✅ ${validFiles.length} imagen(es) añadida(s)`);
}

function showNotification(text) {
  const notif = document.createElement('div');
  notif.textContent = text;
  notif.className = 'drop-notification';
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 2000);
}

function cryptoRandomId() {
  if (window.crypto && crypto.getRandomValues) {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return arr[0].toString(36) + arr[1].toString(36);
  }
  return Math.random().toString(36).slice(2, 9);
}

// Convertir a PDF
// Convertir a PDF
btnPdf.addEventListener("click", async () => {
  if (images.length === 0) return;
  btnPdf.textContent = "Generando...";
  const { jsPDF } = window.jspdf;
  let pdf = null;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    let data = await fileToDataURL(item.file);

    if (item.rotationAngle) {
      data = await rotateImageDataURL(data, item.rotationAngle);
    }

    const img = await loadImage(data);

    let w, h;
    const pxToMm = 0.264583;
    if (A4Checkbox.checked) {
      const aspectRatio = img.width / img.height;
      if (aspectRatio > 1) {
        w = MAX_WIDTH;
        h = MAX_WIDTH / aspectRatio;
      } else {
        h = MAX_HEIGHT;
        w = MAX_HEIGHT * aspectRatio;
      }
    } else if(uniformCheckbox.checked) {
      const UNIFORM_WIDTH = 150;
      const UNIFORM_HEIGHT = 200;
      const aspectRatio = img.width / img.height;
      if (aspectRatio > 1) {
        w = UNIFORM_WIDTH;
        h = UNIFORM_WIDTH / aspectRatio;
      } else {
        h = UNIFORM_HEIGHT;
        w = UNIFORM_HEIGHT * aspectRatio;
      }
    } else {
      w = img.width * pxToMm;
      h = img.height * pxToMm;
    }

    const orientation = w > h ? "landscape" : "portrait";

    if (i === 0) {
      pdf = new jsPDF({
        orientation,
        unit: "mm",
        format: [w, h],
      });
    } else {
      pdf.addPage([w, h], orientation);
    }

    pdf.addImage(data, "JPEG", 0, 0, w, h);
  }

  if (!fileName.value) fileName.value = "pdfconvert";
  pdf.save(`${fileName.value}.pdf`);
  btnPdf.textContent = "Convertir a PDF";
});

function rotateImageDataURL(dataURL, rotationAngle) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (rotationAngle % 180 === 0) {
        canvas.width = img.width;
        canvas.height = img.height;
      } else {
        canvas.width = img.height;
        canvas.height = img.width;
      }

      ctx.translate(canvas.width/2, canvas.height/2);
      ctx.rotate(rotationAngle * Math.PI / 180);
      ctx.drawImage(img, -img.width/2, -img.height/2);

      resolve(canvas.toDataURL('image/jpeg'));
    };
    img.src = dataURL;
  });
}


function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

function fileToDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}