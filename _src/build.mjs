// Builds the public static site from the posts exported out of the Compositor artifact.
//   node _src/build.mjs      (run from anywhere; writes the site into the repository root)
// Inputs, all inside _src/:
//   data/posts.json            post records and site settings
//   pages/<id>.html            the stored page of each post, byte for byte
//   files/<assetid>.<ext>      pictures and other files the pages refer to as /_blob/<assetid>
//   compositor/index.src.html  the Compositor source: the home page styles and code are taken from it
//   static/                    fonts and files copied to the site as they are
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(ROOT, 'compositor/index.src.html');
const ASSETS = path.join(ROOT, 'static');
const FONTS_CSS = path.join(ROOT, 'compositor/fonts.css');
const OUT = process.env.OUT || path.dirname(ROOT);

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/posts.json'), 'utf8'));
const site = data.site;
const app = fs.readFileSync(SRC, 'utf8');
const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

function cut(from, to, keepEnd) {
  const a = app.indexOf(from); if (a < 0) throw new Error('not found in Compositor source: ' + from);
  const b = app.indexOf(to, a + from.length); if (b < 0) throw new Error('not found in Compositor source: ' + to);
  return app.slice(a, keepEnd ? b + to.length : b);
}

/* ── plain posts are set by the very code Compositor uses ── */
const plainCode = [
  "const esc = t => String(t).replace(/[&<>\"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'})[c]);",
  cut('function parseEmbed(t) {', '\nconst embedName'),
  cut('function embedHtml(em, text) {', '\n/* A ready page set inside a post'),
  cut('const SERIF_FACES = ', '\nasync function savePlain'),
  'out = plainPage;'
].join('\n');
const sandbox = {out: null}; vm.runInNewContext(plainCode, sandbox);
const plainPage = sandbox.out;

/* ── a post page for the open web ── */
const published = data.posts.filter(p => p.status === 'published')
  .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
const dayOf = iso => new Date(iso).toISOString().slice(0, 10);

function nativeEmbeds(html) {
  let tweets = false;
  html = html.replace(/<div class="cmp-embed" data-p="(youtube|x)" data-live="([^"]*)">([\s\S]*?)<\/a><\/div>/g, (all, kind, live, inner) => {
    if (kind === 'youtube') {
      const id = (live.match(/embed\/([\w-]+)/) || [])[1]; if (!id) return all;
      return '<div class="cmp-embed"><iframe src="https://www.youtube-nocookie.com/embed/' + id + '?rel=0" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen style="aspect-ratio:16/9;border-radius:12px"></iframe></div>';
    }
    const href = (inner.match(/href="([^"]+)"/) || [])[1]; if (!href) return all;
    tweets = true;
    return '<div class="cmp-embed"><blockquote class="twitter-tweet" data-dnt="true" data-align="center">' + inner + '</a></blockquote></div>';
  });
  html = html.replace(/<script data-compositor-embed>[\s\S]*?<\/script>/g, '');
  if (tweets) html = html.replace(/<\/body>/i, '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></body>');
  return html;
}

const missing = [];
function blobs(html, id) {
  return html.replace(/\/_blob\/([0-9a-f]{32})/g, (all, bid) => {
    const dir = path.join(ROOT, 'files'), hit = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => f.startsWith(bid)) : null;
    if (!hit) { missing.push(id + ': ' + bid); return all; }
    fs.mkdirSync(path.join(OUT, 'files'), {recursive: true}); fs.copyFileSync(path.join(dir, hit), path.join(OUT, 'files', hit));
    return '../../files/' + hit;
  });
}

function topBar(p) {
  const ink = p.theme.ink, paper = p.theme.paper;
  const mark = '<svg viewBox="0 0 120 120" width="18" height="18" aria-hidden="true" style="display:block;flex:none"><rect width="120" height="120" rx="8" fill="' + ink + '"/><text x="60" y="99" font-family="Georgia, serif" font-weight="900" font-size="114" text-anchor="middle" fill="' + paper + '" transform="translate(120,0) scale(-1,1)">C</text><circle cx="60" cy="121" r="9" fill="' + paper + '"/></svg>';
  const base = 'font:500 13px/1 system-ui,-apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.02em;color:' + ink + ';text-decoration:none;text-transform:none;text-indent:0;text-shadow:none';
  return '<compositor-bar style="display:flex;align-items:center;justify-content:space-between;gap:16px;box-sizing:border-box;width:100%;grid-column:1/-1;flex:none;margin:0;padding:12px 20px;background:' + paper + ';border-bottom:1px solid ' + ink + '26;' + base + '">' +
    '<a href="../../" style="display:inline-flex;align-items:center;gap:9px;' + base + '">' + mark + '<span>Compositor</span></a>' +
    '<time datetime="' + esc(p.publishedAt) + '" style="' + base + ';opacity:.7;font-variant-numeric:tabular-nums">' + dayOf(p.publishedAt) + '</time></compositor-bar>';
}

function postPage(p) {
  let html;
  if (p.kind === 'plain' && p.source) {
    html = plainPage(p.title, p.source);
    if (p.sha256 && crypto.createHash('sha256').update(html).digest('hex') !== p.sha256) console.warn('! ' + p.id + ': the plain page differs from the one stored in Compositor');
  } else html = fs.readFileSync(path.join(ROOT, 'pages', p.id + '.html'), 'utf8');
  html = html.replace(/url\(fonts\//g, 'url(../../fonts/').replace(/(src|href)="(?!https?:|\/|#|\.\.|data:|mailto:)([\w.-]+\.(?:jpe?g|png|gif|webp|svg|mp4|webm|m4a|pdf))"/g, '$1="../../$2"');
  html = blobs(nativeEmbeds(html), p.id);
  const url = site.url + '/p/' + p.id + '/';
  const head = '<link rel="canonical" href="' + url + '"><link rel="alternate" type="application/rss+xml" title="' + esc(site.title) + '" href="../../feed.xml">' +
    '<meta property="og:type" content="article"><meta property="og:site_name" content="' + esc(site.title) + '"><meta property="og:title" content="' + esc(p.title) + '"><meta property="og:description" content="' + esc(p.summary || '') + '"><meta property="og:url" content="' + url + '">';
  html = html.replace(/<\/head>/i, head + '</head>');
  if (!/<body[^>]*>/i.test(html)) throw new Error(p.id + ': no <body>');
  return html.replace(/<body[^>]*>/i, m => m + topBar(p));
}

/* ── the home page: Compositor's own styles and code, fed with a fixed list of posts ── */
function homePage() {
  const css = cut('<style>', '</style>').slice(7).replace('/*FONTS*/', fs.readFileSync(FONTS_CSS, 'utf8').trim());
  const list = published.map(p => ({id: p.id, title: p.title, summary: p.summary, status: 'published', publishedAt: p.publishedAt, createdAt: p.createdAt}));
  let render = cut('function wantFont(f) {', '\n/* ───────────── compose');
  const swap = (a, b) => { if (render.indexOf(a) < 0) throw new Error('home code changed: ' + a); render = render.replace(a, b); };
  swap("href: '#p-' + p.id", "href: 'p/' + p.id + '/'");
  swap("el('p', {class: 'foot', text: 'Pages composed by Claude'})", "el('p', {class: 'foot'}, 'Pages composed by Claude · ', el('a', {href: 'feed.xml', text: 'RSS'}))");
  const js = [
    "const $ = s => document.querySelector(s);",
    cut('const el = (tag, attrs, ...kids) => {', '\nconst rid'),
    cut('const dateOf = ', '\nconst ago'),
    cut('const MARK = () => {', '\nconst sayErr'),
    'const me = {isOwner: false, canEdit: false}, cap = {}, visible = p => p && p.status === "published";',
    'const store = ' + JSON.stringify({posts: list, site: {theme: site.theme}, loaded: true}).replace(/</g, '\\u003c') + ';',
    cut('const HOME_THEMES = [', '\nfunction wantFont(f) {'),
    render,
    'renderHome();'
  ].join('\n');
  new Function(js.replace('renderHome();', ''));   // syntax check
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + esc(site.title) + '</title>\n' +
    '<meta name="description" content="' + esc(site.tagline) + '">\n<link rel="canonical" href="' + site.url + '/">\n<link rel="alternate" type="application/rss+xml" title="' + esc(site.title) + '" href="feed.xml">\n' +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(site.title) + '"><meta property="og:description" content="' + esc(site.tagline) + '"><meta property="og:url" content="' + site.url + '/">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<style>' + css + '</style>\n</head>\n<body>\n<div id="app"></div>\n' +
    '<noscript><ol>' + published.map(p => '<li><a href="p/' + p.id + '/">' + esc(p.title) + '</a></li>').join('') + '</ol></noscript>\n<script>\n' + js + '\n</script>\n</body>\n</html>\n';
}

function feed() {
  const x = t => String(t).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n<title>' + x(site.title) + '</title>\n<link>' + site.url + '/</link>\n' +
    '<description>' + x(site.tagline) + '</description>\n<atom:link href="' + site.url + '/feed.xml" rel="self" type="application/rss+xml"/>\n' +
    (published[0] ? '<lastBuildDate>' + new Date(published[0].publishedAt).toUTCString() + '</lastBuildDate>\n' : '') +
    published.map(p => { const u = site.url + '/p/' + p.id + '/';
      return '<item>\n<title>' + x(p.title) + '</title>\n<link>' + u + '</link>\n<guid isPermaLink="true">' + u + '</guid>\n<pubDate>' + new Date(p.publishedAt).toUTCString() + '</pubDate>\n<description>' + x(p.summary || '') + '</description>\n</item>'; }).join('\n') +
    '\n</channel>\n</rss>\n';
}

/* ── write ── */
for (const d of ['p', 'files', 'fonts']) fs.rmSync(path.join(OUT, d), {recursive: true, force: true});
fs.mkdirSync(path.join(OUT, 'fonts'), {recursive: true});
for (const f of fs.readdirSync(path.join(ASSETS, 'fonts'))) fs.copyFileSync(path.join(ASSETS, 'fonts', f), path.join(OUT, 'fonts', f));
for (const f of fs.readdirSync(ASSETS)) if (/\.(jpe?g|png|gif|webp|svg)$/i.test(f)) fs.copyFileSync(path.join(ASSETS, f), path.join(OUT, f));
for (const p of published) { const d = path.join(OUT, 'p', p.id); fs.mkdirSync(d, {recursive: true}); fs.writeFileSync(path.join(d, 'index.html'), postPage(p)); }
fs.writeFileSync(path.join(OUT, 'index.html'), homePage());
fs.writeFileSync(path.join(OUT, 'feed.xml'), feed());
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, '404.html'), '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · ' + esc(site.title) + '</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEEDE6;color:#15181D;font:19px/1.5 Georgia,serif;text-align:center}a{color:inherit}</style></head><body><p>This page does not exist.<br><a href="' + site.url + '/">All posts</a></p></body></html>');
console.log(published.length + ' posts → ' + OUT);
if (missing.length) console.warn('! files not exported yet:\n  ' + missing.join('\n  '));
