/**
 * Shared Utilities for TorkTool
 */

export const t = (key, params) => window.i18n?.t(key, params) ?? key;
export const tc = (oneKey, otherKey, count, params = {}) => t(count === 1 ? oneKey : otherKey, { ...params, count });

const DEFAULT_LOCAL_AGENT_URL = 'http://localhost:7777';
const LOCAL_AGENT_PORT = 7777;
const REMOTE_AGENT_URL = 'https://torktool.roftcore.work';
const LOCAL_AGENT_CANDIDATES = [
  `http://127.0.0.1:${LOCAL_AGENT_PORT}`,
  DEFAULT_LOCAL_AGENT_URL,
];

let resolvedApiUrl = null;
let resolveApiUrlPromise = null;

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

function getStoredApiUrl() {
  const storedUrl = window.localStorage.getItem('torktool.localAgentUrl');
  if (!storedUrl) return null;

  try {
    const parsed = new URL(storedUrl);
    const currentHostIsPrivate = isPrivateHost(window.location?.hostname);
    const storedHostIsPrivate = isPrivateHost(parsed.hostname);

    if (!currentHostIsPrivate && storedHostIsPrivate) {
      return storedUrl;
    }

    if (currentHostIsPrivate && storedHostIsPrivate) {
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
        return `${window.location.protocol}//${window.location.hostname}:${LOCAL_AGENT_PORT}`;
      }
    }

    return storedUrl;
  } catch {
    return storedUrl;
  }
}

function isStoredPrivateUrl(url) {
  try {
    return isPrivateHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function probeApiUrl(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/status`, {
      method: 'GET',
      headers: { 'X-Client-Type': 'TorkTool-Web' },
      cache: 'no-store',
    });

    if (!response.ok) return false;

    const data = await response.json().catch(() => null);
    return data?.status === 'online';
  } catch {
    return false;
  }
}

export function getApiUrl() {
  if (resolvedApiUrl) return resolvedApiUrl;
  const storedUrl = getStoredApiUrl();
  if (storedUrl) return storedUrl;
  return getDefaultApiUrl() || DEFAULT_LOCAL_AGENT_URL;
}

export async function resolveApiUrl(forceRefresh = false) {
  if (!forceRefresh && resolvedApiUrl) return resolvedApiUrl;
  if (!forceRefresh && resolveApiUrlPromise) return resolveApiUrlPromise;

  resolveApiUrlPromise = (async () => {
    const currentHostIsPrivate = isPrivateHost(window.location?.hostname);
    const storedUrl = getStoredApiUrl();

    if (currentHostIsPrivate) {
      resolvedApiUrl = getDefaultApiUrl() || DEFAULT_LOCAL_AGENT_URL;
      window.localStorage.setItem('torktool.localAgentUrl', resolvedApiUrl);
      return resolvedApiUrl;
    }

    const candidates = [...new Set([
      storedUrl,
      ...LOCAL_AGENT_CANDIDATES,
    ].filter(Boolean))];

    for (const candidate of candidates) {
      if (await probeApiUrl(candidate)) {
        resolvedApiUrl = candidate;
        window.localStorage.setItem('torktool.localAgentUrl', candidate);
        return resolvedApiUrl;
      }
    }

    resolvedApiUrl = REMOTE_AGENT_URL;
    if (storedUrl && isStoredPrivateUrl(storedUrl)) {
      window.localStorage.removeItem('torktool.localAgentUrl');
    }
    return resolvedApiUrl;
  })();

  try {
    return await resolveApiUrlPromise;
  } finally {
    resolveApiUrlPromise = null;
  }
}

export async function apiFetch(endpoint, options = {}) {
    try {
        const baseUrl = await resolveApiUrl();
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
