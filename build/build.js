const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
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
  fs.writeFileSync(path.join(output, "CNAME"), "torktool.roftcore.work");
  copyRecursive(path.join(root, 'assets'), path.join(output, 'assets'));
  copyRecursive(path.join(root, 'img'), path.join(output, 'img'));
  copyRecursive(path.join(root, 'translations'), path.join(output, 'translations'));
  fs.copyFileSync(path.join(root, 'main.py'), path.join(output, 'main.py'));
  fs.copyFileSync(path.join(root, 'requirements.txt'), path.join(output, 'requirements.txt'));
  fs.copyFileSync(path.join(root, 'robots.txt'), path.join(output, 'robots.txt'));

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

  function generateHreflangLinks(currentLanguage) {
    let hreflang = '';
    languages.forEach(lang => {
      const url = lang === 'en' ? 'https://torktool.roftcore.work/' : `https://torktool.roftcore.work/${lang}/`;
      hreflang += `<link rel="alternate" hreflang="${lang}" href="${url}" />\n    `;
    });
    return hreflang.trim();
  }

  function generateSitemap() {
    const urls = [
      { loc: 'https://torktool.roftcore.work/', lang: 'en', priority: '1.0' },
      { loc: 'https://torktool.roftcore.work/es/', lang: 'es', priority: '0.8' }
    ];

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map(url => `
  <url>
    <loc>${url.loc}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join('')}
</urlset>`;

    fs.writeFileSync(path.join(output, 'sitemap.xml'), sitemap, 'utf8');
  }

  function renderHtml(source, dictionary, language) {
    const flat = flattenDictionary(dictionary);
    let html = source
      .replace(/<html lang="[^"]*">/, `<html lang="${language}">`)
      .replace(/\{\{([\w.-]+)\}\}/g, (_, key) => {
        const normalizedKey = flat[key] !== undefined ? key : normalizeTemplateKey(key);
        return flat[normalizedKey] !== undefined ? String(flat[normalizedKey]) : `{{${key}}}`;
      });

    // Add hreflang and og:image
    const hreflangLinks = generateHreflangLinks(language);
    html = html.replace('</head>', `
    ${hreflangLinks}
    <script>
      window.i18n = {
        t: (key) => {
          const dict = ${JSON.stringify(flat)};
          return dict[key] || key;
        },
        ready: Promise.resolve()
      };
    </script>
  </head>`);

    return html;
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

  // Generate sitemap
  generateSitemap();

  console.log(`Production bundle generated at ${output}`);
}

build();
