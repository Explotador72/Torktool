/**
 * Shared Utilities for TorkTool
 */

export const t = (key, params) => window.i18n?.t(key, params) ?? key;
export const tc = (oneKey, otherKey, count, params = {}) => t(count === 1 ? oneKey : otherKey, { ...params, count });

const DEFAULT_LOCAL_AGENT_URL = 'http://localhost:7777';
const LOCAL_AGENT_PORT = 7777;
const REMOTE_AGENT_URL = 'https://torktool.roftcore.work';

function isPrivateHost(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;

  const octets = ipv4Match.slice(1).map(Number);
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) return false;

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function getDefaultApiUrl() {
  if (window.location?.hostname && isPrivateHost(window.location.hostname)) {
    return `${window.location.protocol}//${window.location.hostname}:${LOCAL_AGENT_PORT}`;
  }

  return REMOTE_AGENT_URL;
}

export function getApiUrl() {
  const storedUrl = window.localStorage.getItem('torktool.localAgentUrl');
  if (storedUrl) {
    try {
      const parsed = new URL(storedUrl);
      if (isPrivateHost(window.location?.hostname) && isPrivateHost(parsed.hostname)) {
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
          return `${window.location.protocol}//${window.location.hostname}:${LOCAL_AGENT_PORT}`;
        }
      }
      return storedUrl;
    } catch {
      return storedUrl;
    }
  }

  return getDefaultApiUrl() || DEFAULT_LOCAL_AGENT_URL;
}

export async function apiFetch(endpoint, options = {}) {
    try {
        const baseUrl = getApiUrl();
        const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
        
        const headers = {
            ...options.headers,
            'X-Client-Type': 'TorkTool-Web',
        };

        if (!endpoint.includes('/api/download/')) {
            options.headers = headers;
        }

        const response = await fetch(url, options);
        return response; 
    } catch (error) {
        console.warn(`Server unreachable: ${endpoint}`);
        return new Response(JSON.stringify({ error: 'Server unreachable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export function showGlobalProgress(label, percent) {
  const toast = document.getElementById('globalProgress');
  const labelEl = document.getElementById('progressLabel');
  const percentEl = document.getElementById('progressPercent');
  const barEl = document.getElementById('progressBar');

  if (toast && labelEl && percentEl && barEl) {
    labelEl.textContent = label;
    percentEl.textContent = `${percent}%`;
    barEl.style.width = `${percent}%`;
    toast.style.display = 'block';
  }
}

export function hideGlobalProgress() {
  const toast = document.getElementById('globalProgress');
  if (toast) toast.style.display = 'none';
}
