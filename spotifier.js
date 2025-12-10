const spotifyUrl = document.getElementById('spotifyUrl');
const spotifyResult = document.getElementById('spotifyResult');
const spotifyProgressContainer = document.getElementById('spotifyProgressContainer');
const spotifyProgress = document.getElementById('spotifyProgress');
const spotifyProgressText = document.getElementById('spotifyProgressText');
const spotifyFilesList = document.getElementById('spotifyFilesList');
const spotifyTab = document.getElementById('spotify');
const spotifyKey = document.getElementById('spotifyKey');

const API_ENDPOINTS = {
    PLAYLIST_INFO: '/api/playlist/info',
    PLAYLIST_DOWNLOAD: '/api/playlist/download',
    FILES_LIST: '/api/files',
    DELETE_FILE: '/api/delete/',
    CLEANUP: '/api/cleanup',
    DOWNLOAD_FILE: '/api/download/'
};

function showLoading(element, message = 'Cargando...') {
    element.innerHTML = `<div class="loading"><i class="fas fa-spinner fa-spin"></i> ${message}</div>`;
}

function showError(element, message) {
    element.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-circle"></i> ${message}</div>`;
}

function showSuccess(element, message) {
    element.innerHTML = `<div class="success-message"><i class="fas fa-check-circle"></i> ${message}</div>`;
}

function updateProgress(percentage) {
    if (spotifyProgress && spotifyProgressText) {
        spotifyProgress.style.width = `${percentage}%`;
        spotifyProgressText.textContent = `${percentage}%`;
    }
}

// Spotify functions
async function spotifyGetInfo() {
    const url = spotifyUrl.value.trim();
    if (!url) {
        alert('Ingresa una URL de Spotify');
        return;
    }
    
    showLoading(spotifyResult, 'Buscando información...');
    
    try {
        console.log(`${apiUrlInput}${API_ENDPOINTS.PLAYLIST_INFO}`);
        const response = await fetch(`${apiUrlInput}${API_ENDPOINTS.PLAYLIST_INFO}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url: url})
        });
        
        const data = await response.json();
        
        if (data.success) {
            spotifyResult.innerHTML = `
                <div class="playlist-info">
                    <div class="playlist-header">
                        ${data.image ? `<img src="${data.image}" alt="${data.name}" class="playlist-cover">` : ''}
                        <div>
                            <h3 class="playlist-title">${data.name}</h3>
                            <p class="playlist-owner"><i class="fas fa-user"></i> ${data.owner}</p>
                            <p class="playlist-stats"><i class="fas fa-music"></i> ${data.total_tracks} canciones</p>
                        </div>
                    </div>
                    
                    <div class="tracks-list">
                        <h4><i class="fas fa-list"></i> Canciones:</h4>
                        <ul>
                            ${data.tracks.slice(0, 10).map(track => `
                                <li>
                                    <i class="fas fa-play-circle"></i>
                                    <strong>${track.name}</strong> - ${track.artists.join(', ')}
                                </li>
                            `).join('')}
                        </ul>
                        ${data.tracks.length > 10 ? 
                            `<p class="more-tracks">... y ${data.tracks.length - 10} más</p>` : ''}
                    </div>
                </div>
            `;
        } else {
            showError(spotifyResult, `Error: ${data.error}`);
        }
    } catch (error) {
        showError(spotifyResult, `Error: ${error.message}`);
    }
}

async function spotifyDownload() {
    const url = spotifyUrl.value.trim();
    if (!url) {
        alert('Ingresa una URL de Spotify');
        return;
    }
    
    if (!confirm('¿Descargar toda la playlist? Esto puede tomar unos minutos.')) {
        return;
    }
    
    showLoading(spotifyResult, 'Iniciando descarga...');
    
    if (spotifyProgressContainer) {
        spotifyProgressContainer.style.display = 'block';
    }
    
    updateProgress(5);
    
    try {
        const response = await fetch(`${apiUrlInput}${API_ENDPOINTS.PLAYLIST_DOWNLOAD}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                url: url,
                spotifyKey: spotifyKey.value
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Simular progreso
            for (let i = 5; i <= 100; i += 5) {
                await new Promise(resolve => setTimeout(resolve, 100));
                updateProgress(i);
            }
            
            spotifyResult.innerHTML = `
                <div class="success-message">
                    <i class="fas fa-check-circle"></i> ${data.message}
                    <div class="stats">
                        <p><i class="fas fa-chart-bar"></i> <strong>Estadísticas:</strong></p>
                        <ul>
                            <li>Total: ${data.stats.total} canciones</li>
                            <li>Descargadas: ${data.stats.downloaded}</li>
                            <li>No encontradas: ${data.stats.not_found}</li>
                        </ul>
                    </div>
                    ${data.download_url ? `
                        <a href="${data.download_url}" download="${data.filename}" class="download-btn">
                            <i class="fas fa-file-archive"></i> Descargar ZIP (${data.filename})
                        </a>
                    ` : ''}
                </div>
            `;
            
            spotifyListFiles();
        } else {
            showError(spotifyResult, `Error: ${data.error}`);
        }
    } catch (error) {
        showError(spotifyResult, `Error: ${error.message}`);
    } finally {
        setTimeout(() => {
            if (spotifyProgressContainer) {
                spotifyProgressContainer.style.display = 'none';
            }
        }, 2000);
    }
}

async function spotifyListFiles() {
    if (!spotifyFilesList) return;
    
    showLoading(spotifyFilesList, 'Cargando archivos...');
    
    try {
        const response = await fetch(`${apiUrlInput}${API_ENDPOINTS.FILES_LIST}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                spotifyKey: spotifyKey.value
            })
        });
        const data = await response.json();
        
        if (data.success && data.files.length > 0) {
            const filesHtml = data.files.map(file => `
                <div class="file-item">
                    <div class="file-info">
                        <i class="fas fa-file-audio"></i>
                        <span class="file-name">${file.name}</span>
                        <span class="file-size">${file.size || ''}</span>
                    </div>
                    <div class="file-actions">
                        <a href="${apiUrlInput}${API_ENDPOINTS.DOWNLOAD_FILE}${file.name}" class="btn-download-small" download>
                            <i class="fas fa-download"></i> Descargar
                        </a>
                        <button class="btn-delete-small" onclick="spotifyDeleteFile('${file.name}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
            
            spotifyFilesList.innerHTML = filesHtml;
        } else {
            spotifyFilesList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-audio"></i>
                    <p>No hay archivos descargados</p>
                </div>
            `;
        }
    } catch (error) {
        spotifyFilesList.innerHTML = `<div class="error-message">Error al cargar archivos</div>`;
    }
}

async function spotifyDeleteFile(filename) {
    if (!confirm(`¿Eliminar ${filename}?`)) return;
    
    try {
        const response = await fetch(`${apiUrlInput}${API_ENDPOINTS.DELETE_FILE + filename}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            spotifyListFiles();
        }
    } catch (error) {
        alert('Error al eliminar archivo');
    }
}

async function spotifyCleanup() {
    if (!confirm('¿Eliminar TODOS los archivos descargados de Spotify?')) return;
    
    try {
        const response = await fetch(`${apiUrlInput}${API_ENDPOINTS.CLEANUP}`, {
            method: 'DELETE',
            body: JSON.stringify({
                spotifyKey: spotifyKey.value
            })
        });
        
        const data = await response.json();
        
        alert(data.message);
        spotifyListFiles();
    } catch (error) {
        alert('Error al limpiar archivos');
    }
}

// Inicialización
function initSpotify() {
    if (spotifyTab && spotifyTab.classList.contains('active')) {
        spotifyListFiles();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', initSpotify);

// Añadir event listeners para el input (opcional)
if (spotifyUrl) {
    spotifyUrl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            spotifyGetInfo();
        }
    });
}

// Exportar funciones al scope global
window.spotifyGetInfo = spotifyGetInfo;
window.spotifyDownload = spotifyDownload;
window.spotifyListFiles = spotifyListFiles;
window.spotifyDeleteFile = spotifyDeleteFile;
window.spotifyCleanup = spotifyCleanup;