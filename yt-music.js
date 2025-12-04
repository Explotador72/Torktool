const btnYT = document.getElementById("downloadMusicBtn");
const responseStatus = document.getElementById("statusMusic");
const videoUrlInput = document.getElementById('ytInput');
const videoName = document.getElementById('nameSong')

const apiUrlInput = "https://yt-dwn-f1c0.onrender.com"


btnYT.addEventListener("click", startProcess);


function showStatus(message, type = 'info') {
    responseStatus.textContent = message;
    responseStatus.className = `status-music ${type}`;
}


async function startProcess(event) {
    console.log("Iniciando proceso de descarga de música...");
    const LOCAL_API_URL = apiUrlInput
    const videoUrl = videoUrlInput.value.trim();

    if (!videoUrl) {
        showStatus('❌ Ingresa la URL de un video de YouTube.', 'error');
        return;
    }

    btnYT.disabled = true;
    btnYT.innerHTML = '<span class="animate-spin mr-2">⚙️</span> Procesando... (Puede tardar hasta 30s)';

    showStatus(`⏳ Paso 1/2: Solicitando descarga a ${LOCAL_API_URL}...`, 'loading');

    try {
        const response = await fetch(`${LOCAL_API_URL}/api/url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: videoUrl })
        });

        if (!response.ok) {
            const errorText = await response.text();
            showStatus(`❌ Error HTTP (${response.status}). Ver consola para detalles.`, 'error');
            console.error("Respuesta HTTP fallida:", response.status, errorText);
            return;
        }

        const responseText = await response.text();

        let downloadData;
        downloadData = JSON.parse(responseText);

        let filename = downloadData.filename
        if (videoName) {
            filename = videoName.value;
        }
        console.log(filename)
        const downloadUrlRelative = downloadData.download_url;
        const fileUrl = `${LOCAL_API_URL}${downloadUrlRelative}`;

        showStatus(`✅ Paso 1/2 Completado. Video "${downloadData.title}" descargado en el servidor. <br> ⏳ Paso 2/2: Iniciando descarga del archivo...`, 'loading');
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = fileUrl;
    
        a.download = filename;

        document.body.appendChild(a);
        a.click(); 
        document.body.removeChild(a);

        showStatus(`🎉 Éxito! El archivo se está descargando en tu navegador. Revisa tu carpeta de descargas.`, 'success');
    } catch (error) {
        console.error("Error durante la descarga:", error);
        showStatus(`❌ Ocurrió un error: ${error.message}`, 'error');
    } finally {
        btnYT.disabled = false;
        btnYT.textContent = 'Descargar Música';
    }
}