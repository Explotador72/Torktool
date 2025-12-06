// Conversor IMG → PDF
const imgInput = document.getElementById("imgInput");
const btnPdf = document.getElementById("convertPdfBtn");
const previewPdf = document.getElementById("previewPdf");
const fileName = document.getElementById("nameInput");
const sizeCheckbox = document.getElementById("sizeCheckbox");

const MAX_WIDTH = 190; // mm
const MAX_HEIGHT = 277; // A4 tamaño aproximado

let images = [];

// Mostrar miniaturas
imgInput.addEventListener("change", () => {
  const newFiles = Array.from(imgInput.files); // archivos recién seleccionados
  const newItems = newFiles.map (f => ({ file: f, id: cryptoRandomId() }));
  images = images.concat(newItems);

  imgInput.value = "";
  renderPreviews();
  btnPdf.disabled = images.length === 0;
});


function renderPreviews() {
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

    const btnClose = document.createElement("span");
    btnClose.className = "close-btn";
    btnClose.innerHTML = "✕";
    btnClose.dataset.id = item.id;
    btnClose.addEventListener("click", () => {
      const removeIndex = images.findIndex(x => x.id === btnClose.dataset.id);
      if (removeIndex > -1) {
        console.log("removing", removeIndex);
        images.splice(removeIndex, 1);
        renderPreviews(); // re-render para actualizar números/handlers
        btnPdf.disabled = images.length === 0;
      }
    });

    const img = document.createElement("img");
    img.src = url;

    div.appendChild(numberTag);
    div.appendChild(btnClose);
    div.appendChild(img);
    previewPdf.appendChild(div);

    div.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", index); // guardamos el índice de la imagen
      div.classList.add("dragging");
    });

    div.addEventListener("dragend", e => {
      div.classList.remove("dragging");
    });

    div.addEventListener("dragover", e => {
      e.preventDefault(); // necesario para permitir drop
      div.classList.add("dragover");
    });

    div.addEventListener("dragleave", e => {
      div.classList.remove("dragover");
    });

    div.addEventListener("drop", e => {
      e.preventDefault();
      div.classList.remove("dragover");

      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
      const toIndex = index;

      if (fromIndex === toIndex) return;

      // intercambiar posiciones en images
      const movedItem = images.splice(fromIndex, 1)[0];
      images.splice(toIndex, 0, movedItem);

      renderPreviews(); // re-render para actualizar miniaturas y números
    });
  });
}

function cryptoRandomId() {
  // si crypto existe:
  if (window.crypto && crypto.getRandomValues) {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return arr[0].toString(36) + arr[1].toString(36);
  }
  // fallback sencillo
  return Math.random().toString(36).slice(2, 9);
}



// Convertir a PDF
btnPdf.addEventListener("click", async () => {

  if (images.length === 0) return;
  btnPdf.textContent = "Generando...";
  const { jsPDF } = window.jspdf;
  let pdf = null;

  for (let i = 0; i < images.length; i++) {

    const data = await fileToDataURL(images[i].file);
    const img = await loadImage(data);

    let w, h;
    const pxToMm = 0.264583; 
    if (sizeCheckbox.checked) {
      const aspectRatio = img.width / img.height;
      if (aspectRatio > 1) {
        w = MAX_WIDTH;
        h = MAX_WIDTH / aspectRatio;
      } else {
        h = MAX_HEIGHT;
        w = MAX_HEIGHT * aspectRatio;
      }
    } else {
      w = img.width * pxToMm
      h = img.height * pxToMm}

    // primera página → crear PDF del tamaño exacto
    if (i === 0) {
      pdf = new jsPDF({
        orientation: w > h ? "landscape" : "portrait",
        unit: "mm",
        format: [w, h], // <= página del tamaño de la imagen
      });
    } else {
      pdf.addPage([w, h], w > h ? "landscape" : "portrait");
    }

    // imagen ocupa exactamente toda la hoja
    pdf.addImage(data, "JPEG", 0, 0, w, h);
  }
  if (!fileName.value) {fileName.value="pdfconvert"; console.log("donee")}
  pdf.save(`${fileName.value}.pdf`);
  btnPdf.textContent = "Convertir a PDF";
});


function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

// Convierte un file → base64
function fileToDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
