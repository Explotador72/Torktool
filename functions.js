// Conversor IMG → PDF
const imgInput = document.getElementById("imgInput");
const btnPdf = document.getElementById("convertPdfBtn");
const previewPdf = document.getElementById("previewPdf");
const fileName = document.getElementById("nameInput");


let images = [];

// Mostrar miniaturas
imgInput.addEventListener("change", () => {
  images = Array.from(imgInput.files);
  previewPdf.innerHTML = "";

  images.forEach(file => {
    const url = URL.createObjectURL(file);
    const div = document.createElement("div");
    div.className = "preview-thumb";

    const img = document.createElement("img");
    img.src = url;

    div.appendChild(img);
    previewPdf.appendChild(div);
  });
  btnPdf.disabled = images.length === 0;
});

// Convertir a PDF
btnPdf.addEventListener("click", async () => {

  if (images.length === 0) return;
  btnPdf.textContent = "Generando...";
  const { jsPDF } = window.jspdf;
  let pdf = null;

  for (let i = 0; i < images.length; i++) {

    const data = await fileToDataURL(images[i]);
    const img = await loadImage(data);

    const imgW = img.width;
    const imgH = img.height;
    const pxToMm = 0.264583; 
    const w = imgW * pxToMm;
    const h = imgH * pxToMm;

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
  if (!fileName) {fileName="pdfconvert"; console.log("donee")}
  pdf.save(`${fileName}.pdf`);
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
