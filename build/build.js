const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'dist','production');
const languages = ['es', 'en'];

function copyRecursive(source, destination) {
  const stat = fs.statSync(source);
  if (source.endsWith(`${path.sep}assets${path.sep}js${path.sep}i18n-loader.js`)) {
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function ensureCleanDir(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function build() {
  ensureCleanDir(output);

  copyRecursive(path.join(root, 'assets'), path.join(output, 'assets'));
  copyRecursive(path.join(root, 'img'), path.join(output, 'img'));
  fs.copyFileSync(path.join(root, 'main.py'), path.join(output, 'main.py'));
  fs.copyFileSync(path.join(root, 'requirements.txt'), path.join(output, 'requirements.txt'));

  const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

  function renderHtml(source, dictionary, language) {
    const flat = flattenDictionary(dictionary);
    return source
      .replace(/<html lang="[^"]*">/, `<html lang="${language}">`)
      .replace(/^\s*<script src="assets\/js\/i18n-loader\.js"><\/script>\s*$/gm, '')
      .replace(/\{\{([\w.-]+)\}\}/g, (_, key) => {
        const normalizedKey = flat[key] !== undefined ? key : normalizeTemplateKey(key);
        return flat[normalizedKey] !== undefined ? String(flat[normalizedKey]) : `{{${key}}}`;
      });
  }

  languages.forEach((language) => {
    const translationPath = path.join(root, 'translations', language, 'common.json');
    const dictionary = JSON.parse(fs.readFileSync(translationPath, 'utf8'));
    const html = renderHtml(template, dictionary, language);

    if (language === 'en') {
      fs.writeFileSync(path.join(output, 'index.html'), html, 'utf8');
    } else {
      fs.mkdirSync(path.join(output, language), { recursive: true });
      fs.writeFileSync(path.join(output, language, `${language}.html`), html, 'utf8');
    }
  });

  console.log(`Production bundle generated at ${output}`);
}

build();
