const audioInput = document.getElementById("audioInput")
const transcriptBtn = document.getElementById("transcriptBtn")
const transcriptOutput = document.getElementById("transcriptOutput"); 



audioInput.addEventListener("change", () => {
  const newFiles = Array.from(audioInput.files); // archivos recién seleccionados
  const newItems = newFiles.map(f => ({ file: f, id: cryptoRandomId() }));
  transcriptBtn.disabled = newItems.length === 0;
});




transcriptBtn.addEventListener("click", async () => {
    const file = audioInput.files[0];

    if (!file) {
        alert("Selecciona un archivo de audio primero.");
        return;
    }

    const formData = new FormData();
    formData.append("audio", file);

    transcriptBtn.disabled = true;
    transcriptBtn.textContent = "Transcribiendo...";

    try {
        const formData = new FormData();
        formData.append("audio", audioInput.files[0]);

        const response = await fetch(`${apiUrlInput}/api/transcript`, {
            method: "POST",
            body: formData
        });

        const data = await response.json();
        console.log(data)
        transcriptOutput.textContent = data.text;
    } catch (err) {
        console.error("Error:", err);
        alert("Error al transcribir el audio.");
    } finally {
        transcriptBtn.disabled = false;
        transcriptBtn.textContent = "Transcribir Audio";
    }
});
