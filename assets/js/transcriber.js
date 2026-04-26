/**
 * Audio to Text Module
 */
import { t, tc, apiFetch, showGlobalProgress, hideGlobalProgress } from './utils.js';

const audioInput = document.getElementById('audioInput');
const transcriptBtn = document.getElementById('transcriptBtn');
const transcriptOutput = document.getElementById('transcriptOutput');
const audioDropZone = document.getElementById('audioDropZone');
const audioBrowseBtn = document.getElementById('audioBrowseBtn');

export function initTranscriberModule() {
  if (!audioInput || !transcriptBtn || !transcriptOutput || !audioDropZone) return;

  audioBrowseBtn?.addEventListener('click', () => audioInput.click());

  audioInput.addEventListener('change', () => {
    const fileCount = audioInput.files.length;
    transcriptBtn.disabled = fileCount === 0;
    audioDropZone.querySelector('p').textContent = tc('transcriber.selected_one', 'transcriber.selected_other', fileCount);
    audioDropZone.classList.toggle('has-files', fileCount > 0);
  });

  transcriptBtn.addEventListener('click', startTranscription);

  setTranscriptButtonState(false);
}

function setTranscriptButtonState(isLoading) {
  transcriptBtn.disabled = isLoading || audioInput.files.length === 0;
  transcriptBtn.innerHTML = isLoading
    ? `<i class="fas fa-spinner fa-spin"></i><span>${t('transcriber.transcribing')}</span>`
    : `<i class="fas fa-wand-magic-sparkles"></i><span>${t('transcriber.start')}</span>`;
}

async function startTranscription() {
  if (audioInput.files.length === 0) return;

  const file = audioInput.files[0];
  const formData = new FormData();
  formData.append('file', file);

  setTranscriptButtonState(true);
  transcriptOutput.innerHTML = `<p class="loading-text">${t('transcriber.analyzing')}</p>`;
  showGlobalProgress(t('progress.audio_processing'), 30);

  try {
    const response = await apiFetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await response.json();

    if (!data.success) throw new Error(data.error);

    showGlobalProgress(t('progress.audio_extracting'), 100);
    transcriptOutput.innerHTML = `
      <div class="transcript-result">
        <div class="result-header">
          <i class="fas fa-quote-left"></i>
          <span>${t('transcriber.title')}</span>
          <button class="btn-copy" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText)">
            <i class="fas fa-copy"></i>
          </button>
        </div>
        <div class="result-text">${data.text}</div>
      </div>
    `;
  } catch (error) {
    transcriptOutput.innerHTML = `<div class="error-card"><i class="fas fa-exclamation-triangle"></i><span>${t('common.error')}: ${error.message}</span></div>`;
  } finally {
    setTimeout(hideGlobalProgress, 1000);
    setTranscriptButtonState(false);
  }
}
