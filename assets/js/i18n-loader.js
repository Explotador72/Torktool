/**
 * Internationalization Loader (ES Module)
 */

const DEFAULT_LANGUAGE = 'es';
const FALLBACK_LANGUAGE = 'en';
const STORAGE_KEY = 'torktool.language';
const BASE_PATH = (window.TORKTOOL_TRANSLATIONS_PATH || 'translations').replace(/\/$/, '');

let currentLanguage = DEFAULT_LANGUAGE;
let currentDictionary = {};
let flatDictionary = {};

function interpolate(value, params = {}) {
  return String(value).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (params[key] === undefined || params[key] === null) {
      return '';
    }
    return String(params[key]);
  });
}

function flattenDictionary(source, prefix = '', target = {}) {
  Object.entries(source || {}).forEach(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenDictionary(value, nextKey, target);
    } else {
      target[nextKey] = value;
    }
  });
  return target;
}

function normalizeTemplateKey(key) {
  const separatorIndex = key.indexOf('-');
  if (separatorIndex === -1) {
    return key;
  }
  return `${key.slice(0, separatorIndex)}.${key.slice(separatorIndex + 1).replace(/-/g, '_')}`;
}

export function t(key, params = {}) {
  const normalizedKey = flatDictionary[key] !== undefined ? key : normalizeTemplateKey(key);
  const rawValue = flatDictionary[normalizedKey];
  if (rawValue === undefined || rawValue === null) {
    return key;
  }
  if (typeof rawValue === 'string') {
    return interpolate(rawValue, params);
  }
  return String(rawValue);
}

export function applyTranslations(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => {
    const original = node.nodeValue;
    if (!original || !original.includes('{{')) {
      return;
    }

    node.nodeValue = original.replace(/\{\{([\w.-]+)\}\}/g, (_, key) => t(key));
  });

  root.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (!attribute.value.includes('{{')) {
        return;
      }

      element.setAttribute(attribute.name, attribute.value.replace(/\{\{([\w.-]+)\}\}/g, (_, key) => t(key)));
    });
  });
}

async function loadDictionary(language) {
  const response = await fetch(`${BASE_PATH}/${language}/common.json`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Missing translation bundle for ${language}`);
  }
  return response.json();
}

export async function setLanguage(language) {
  const normalized = (language || DEFAULT_LANGUAGE).toLowerCase().slice(0, 2);

  try {
    currentDictionary = await loadDictionary(normalized);
    currentLanguage = normalized;
  } catch (primaryError) {
    if (normalized !== DEFAULT_LANGUAGE) {
      try {
        currentDictionary = await loadDictionary(DEFAULT_LANGUAGE);
        currentLanguage = DEFAULT_LANGUAGE;
      } catch (fallbackError) {
        currentDictionary = await loadDictionary(FALLBACK_LANGUAGE);
        currentLanguage = FALLBACK_LANGUAGE;
      }
    } else {
      currentDictionary = await loadDictionary(FALLBACK_LANGUAGE);
      currentLanguage = FALLBACK_LANGUAGE;
    }
  }

  document.documentElement.lang = currentLanguage;
  localStorage.setItem(STORAGE_KEY, currentLanguage);
  flatDictionary = flattenDictionary(currentDictionary);

  applyTranslations();
  
  window.dispatchEvent(new CustomEvent('torktool:i18n-ready', { detail: { language: currentLanguage } }));

  return currentLanguage;
}

const preferredLanguage = localStorage.getItem(STORAGE_KEY) || navigator.language || DEFAULT_LANGUAGE;

export const i18n = {
  get language() { return currentLanguage; },
  t,
  setLanguage,
  applyTranslations,
  ready: setLanguage(preferredLanguage),
};

// Keep compatibility with window for global calls if needed
window.i18n = i18n;
