const btnYT = document.getElementById("downloadMusicBtn");
const responseStatus = document.getElementById("statusMusic");
const videoUrlInput = document.getElementById('ytInput');
const videoName = document.getElementById('nameSong')
const formatMP4 = document.getElementById('MP4Checkbox')
const formatMP3 = document.getElementById('MP3Checkbox')
const previewYT = document.getElementById("previewYT");
const apiUrlInput = "https://yt-dwn-f1c0.onrender.com"

let ytList = [];

btnYT.addEventListener("click", startProcess);


formatMP4.addEventListener('change', () => {
    if (formatMP4.checked) {
        formatMP3.checked = false;
    } else {
        formatMP3.checked = true;
    }
});

formatMP3.addEventListener('change', () => {
    if (formatMP3.checked) {
        formatMP4.checked = false;
    } else {
        formatMP4.checked = true;
    }
});


function showStatus(message, type = 'info') {
    responseStatus.textContent = message;
    responseStatus.className = `status-music ${type}`;
}


async function startProcess(event) {
    console.log("Iniciando proceso de descarga de música...");
    const LOCAL_API_URL = apiUrlInput;

    btnYT.disabled = true;
    btnYT.innerHTML = '<span class="animate-spin mr-2">⚙️</span> Procesando... (Puede tardar hasta 30s)';

    showStatus(`⏳ Paso 1/2: Solicitando descarga a ${LOCAL_API_URL}...`, 'loading');

    try {
        let inputName
        if (videoName) {
            inputName = videoName.value;
        }
        let format
        if (formatMP4.checked) {
            format = "mp4"
        } else if (formatMP3.checked) {
            format = "mp3"
        }
        const response = await fetch(`${LOCAL_API_URL}/api/url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                url: ytList,
                filename: inputName,
                type: format})
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
        const filename = downloadData.filename
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


function renderPreviews(url) {
    videoUrl = ytList.at(-1);
    const div = document.createElement("div");
    div.className = "preview-thumb-yt";
    let videoId;
    try {
        const urlObj = new URL(videoUrl);
        if (urlObj.hostname.includes("youtu.be")) {
            videoId = urlObj.pathname.slice(1); // youtu.be/VIDEOID
        } else {
            videoId = urlObj.searchParams.get("v"); // youtube.com/watch?v=VIDEOID
        }
    } catch {
        return;
    }
    const img = document.createElement("img");
    img.className = "img-yt"
    img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    img.alt = "Miniatura del video";
    const name = document.createElement("span");
    name.className = "name-yt";
    name.textContent = videoUrl;

    div.appendChild(img);
    div.appendChild(name);
    previewYT.appendChild(div);
}


videoUrlInput.addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        const videoUrl = videoUrlInput.value.trim();

        if (esYTURL(videoUrl)) {
            if (ytList.includes(videoUrl)) {
                showStatus('❌ La URL ya ha sido ingresada anteriormente.', 'error');
                return;
            }
            showStatus(`✅ URL ingresada correctamente.`, 'success');
        } else {
            showStatus('❌ Ingresa la URL de un video de YouTube.', 'error');
            return;
        }

        ytList.push(videoUrl);
        console.log("Lista de URLs de YouTube:", ytList);
        videoUrlInput.value = "";
        renderPreviews();
    }
});


function esYTURL(url) {
    try {
        const u = new URL(url);
        const dominiosYT = ["youtube.com", "www.youtube.com", "youtu.be", "www.youtu.be"];

        return dominiosYT.includes(u.hostname);
    } catch {
        return false;
    }
}