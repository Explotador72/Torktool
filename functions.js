// Conversor IMG → PDF
const imgInput = document.getElementById("imgInput");
const btnPdf = document.getElementById("convertPdfBtn");
const previewPdf = document.getElementById("previewPdf");

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
  log.console(images.length === 0);
  btnPdf.disabled = images.length === 0;
});

// Convertir a PDF
btnPdf.addEventListener("click", async () => {
  if (images.length === 0) return;

  btnPdf.textContent = "Generando...";

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  for (let i = 0; i < images.length; i++) {
    const data = await fileToDataURL(images[i]);

    if (i > 0) pdf.addPage();  // nueva página para las imágenes siguientes

    pdf.addImage(data, "JPEG", 10, 10, 190, 0); // ancho auto-escalado
  }

  pdf.save("imagenes.pdf");
  btnPdf.textContent = "Convertir a PDF";
});

// Convierte un file → base64
function fileToDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
