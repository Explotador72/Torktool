
import { t, tc, apiFetch, getApiUrl, showGlobalProgress, hideGlobalProgress } from './utils.js';

const mediaUrlInput = document.getElementById('mediaUrl');
const processMediaBtn = document.getElementById('processMediaBtn');
const mediaResult = document.getElementById('mediaResult');
const mediaFilesList = document.getElementById('mediaFilesList');

export async function initMediaModule() {
  await fetchMediaFiles();

  if (!mediaUrlInput || !processMediaBtn || !mediaResult || !mediaFilesList) return;

  processMediaBtn.addEventListener('click', async () => {
    const url = mediaUrlInput.value.trim();
    if (!url) {
      alert(t('media.invalid_url'));
      return;
    }

    const type = detectMediaType(url);
    if (type === 'unknown') {
      alert(t('media.unsupported_url'));
      return;
    }

    processMediaBtn.disabled = true;
    mediaResult.innerHTML = `<div class="loading-shimmer">${t('media.loading')}</div>`;

    try {
      if (type.startsWith('spotify')) {
        await handleSpotify(url, type);
      } else {
        await handleYouTube(url);
      }
    } catch (error) {
      mediaResult.innerHTML = `<div class="error-card"><i class="fas fa-exclamation-triangle"></i> ${t('common.error')}: ${error.message}</div>`;
    } finally {
      processMediaBtn.disabled = false;
    }
  });

  refreshMediaFiles();
}

function normalizeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') return String(value.name || value.display_name || value.title || fallback);
  return fallback;
}

async function fetchMediaFiles() {
  const response = await apiFetch('/api/files');
  return response.json();
}

async function openDownloadsFolder(filename = '') {
  const response = await apiFetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || t('common.error'));
  }
}

function watchDownloadJob(jobId, handlers = {}) {
  const source = new EventSource(`${getApiUrl()}/api/download/events/${jobId}`);

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handlers.onUpdate?.(data);

      if (data.status === 'finished') {
        handlers.onFinish?.(data);
        source.close();
      } else if (data.status === 'error' || data.status === 'not_found') {
        handlers.onError?.(new Error(data.error || t('common.error')));
        source.close();
      }
    } catch (error) {
      handlers.onError?.(error);
      source.close();
    }
  };

  source.onerror = () => {
    handlers.onError?.(new Error(t('common.error')));
    source.close();
  };

  return source;
}

function detectMediaType(url) {
  if (url.includes('spotify.com')) {
    if (url.includes('/playlist/')) return 'spotify-playlist';
    if (url.includes('/track/')) return 'spotify-track';
    return 'spotify-unknown';
  }
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    if (url.includes('list=')) return 'youtube-playlist';
    return 'youtube-video';
  }
  return 'unknown';
}

function renderMediaCard(info) {
  const actionLabel = info.downloadSupported === false ? t('media.spotify_playlist_unavailable') : t('common.open_folder');
  mediaResult.innerHTML = `
    <div class="media-card">
      <img src="${info.image}" class="media-cover" alt="${info.title}">
      <div class="media-info">
        <span class="badge">${info.badge}</span>
        <h3>${info.title}</h3>
        <div class="media-meta">
          <span><i class="fas fa-user"></i> ${info.author}</span>
          <span><i class="fas fa-music"></i> ${info.count}</span>
        </div>
        <button class="btn-primary" id="startDownloadBtn" type="button" ${info.downloadSupported === false ? 'disabled' : ''}>
          <i class="fas fa-folder-open"></i>
          <span>${actionLabel}</span>
        </button>
      </div>
    </div>
  `;

  const startDownloadBtn = document.getElementById('startDownloadBtn');
  if (info.downloadSupported !== false) {
    startDownloadBtn?.addEventListener('click', info.onDownload);
  }
}

async function handleSpotify(url, type) {
  const response = await apiFetch('/api/playlist/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await response.json();
  if (!data.success) throw new Error(data.error);

  renderMediaCard({
    title: normalizeText(data.name, t('media.spotify_playlist')),
    author: normalizeText(data.owner, 'Spotify'),
    count: tc('media.songs_one', 'media.songs_other', data.total_tracks),
    image: data.image || 'img/torken.png',
    badge: type === 'spotify-track' ? t('media.spotify_track') : t('media.spotify_playlist'),
    downloadSupported: data.download_supported !== false,
    onDownload: () => startSpotifyDownload(url),
  });
}

async function handleYouTube(url) {
  renderMediaCard({
    title: t('media.youtube_video'),
    author: t('media.youtube_author'),
    count: tc('media.files_one', 'media.files_other', 1),
    image: 'https://www.youtube.com/s/desktop/28e5dc31/img/favicon_144x144.png',
    badge: t('media.youtube_media'),
    onDownload: () => startYouTubeDownload([url]),
  });
}

async function startSpotifyDownload(url) {
  showGlobalProgress(t('media.spotify_start'), 0);
  try {
    const response = await apiFetch('/api/playlist/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.error || t('common.error'));

    const jobId = data.job_id;
    if (!jobId) throw new Error(t('common.error'));

    watchDownloadJob(jobId, {
      onUpdate: (status) => {
        if (status.status === 'downloading' || status.status === 'finished') {
          const label = status.status === 'finished' ? t('media.ready_to_download') : t('media.spotify_unpacking');
          showGlobalProgress(`${label} (${status.current || 0}/${status.total || 0})`, status.percent ?? 0);
        }
      },
      onFinish: async (status) => {
      showGlobalProgress(t('media.ready_to_download'), 100);
      await refreshMediaFiles();
      if (status?.filename) {
        try {
          await openDownloadsFolder(status.filename);
        } catch (error) {
          console.error('Error opening folder:', error);
        }
      }
      setTimeout(() => hideGlobalProgress(), 1500);
    },
      onError: (error) => {
        alert(`${t('common.error')}: ${error.message}`);
        hideGlobalProgress();
      },
    });
  } catch (error) {
    alert(`${t('common.error')}: ${error.message}`);
    hideGlobalProgress();
  }
}

async function startYouTubeDownload(urls) {
  const format = document.querySelector('input[name="format"]:checked')?.value || 'mp3';
  showGlobalProgress(t('media.youtube_processing'), 20);
  try {
    const response = await apiFetch('/api/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, filename: `torktool_yt_${Date.now()}`, type: format }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || t('common.error'));

    const jobId = data.job_id;
    if (!jobId) throw new Error(t('common.error'));

    watchDownloadJob(jobId, {
      onUpdate: (status) => {
        if (status.status === 'downloading' || status.status === 'finished') {
          showGlobalProgress(`${t('media.youtube_processing')} (${status.percent ?? 0}%)`, status.percent ?? 0);
        }
      },
      onFinish: async (status) => {
        showGlobalProgress(t('media.ready_to_download'), 100);
        if (status.filename) {
          try {
            await openDownloadsFolder(status.filename);
          } catch (error) {
            console.error('Error opening folder:', error);
          }
        }
        await refreshMediaFiles();
        setTimeout(() => hideGlobalProgress(), 2000);
      },
      onError: (error) => {
        alert(`${t('common.error')}: ${error.message}`);
        hideGlobalProgress();
      },
    });
  } catch (error) {
    alert(`${t('common.error')}: ${error.message}`);
    hideGlobalProgress();
  }
}

export async function refreshMediaFiles() {
  try {
    const data = await fetchMediaFiles();
    if (data.success && data.files.length > 0) {
      mediaFilesList.innerHTML = data.files.map((file) => `
        <div class="file-card">
          <div class="file-icon"><i class="fas fa-file-zipper"></i></div>
          <div class="file-details">
            <p title="${file.name}">${file.name}</p>
            <span>${file.size}</span>
          </div>
          <button class="btn-icon btn-open-folder" type="button" data-filename="${file.name}" title="${t('common.open_folder')}">
            <i class="fas fa-folder-open"></i>
          </button>
        </div>
      `).join('');
      mediaFilesList.querySelectorAll('.btn-open-folder').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const filename = btn.dataset.filename;
          try {
            await openDownloadsFolder(filename);
          } catch (error) {
            alert(`${t('common.error')}: ${error.message}`);
          }
        });
      });
    } else {
      mediaFilesList.innerHTML = `<div class="empty-state"><i class="fas fa-cloud-arrow-down"></i><p>${t('media.empty_recent')}</p></div>`;
    }
  } catch (error) {
  console.error('Error loading media files:', error);

  mediaFilesList.innerHTML = `
    <div class="empty-state error">
      <i class="fas fa-cloud-arrow-down"></i>
      <p>${t('media.empty_recent') || 'Error loading files'}</p>
    </div>
  `;
  }
}
