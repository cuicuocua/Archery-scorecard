// Builds the standalone GitHub Pages bundle for ArcheryScorecard.jsx: a
// single self-contained index.html with Tailwind's compiled output and the
// React/recharts/lucide-react/@supabase bundle inlined. Run with `npm run
// build` from the repo root (the script resolves every path off __dirname,
// so the working directory doesn't matter); output goes to site/dist/.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });

execSync(
  `npx tailwindcss -i ${path.join(__dirname, 'input.css')} -o ${path.join(dist, 'tailwind-output.css')} --content "${path.join(__dirname, '..', 'ArcheryScorecard.jsx')}" --minify`,
  { stdio: 'inherit' }
);

// Two bundles from the same component file. entry.jsx is the whole app;
// share.jsx imports only SharedTournamentScreen, which lets esbuild drop
// everything the spectator page never renders — recharts and its d3 tail
// above all. Tailwind is compiled once for both, since it scans the one
// component file either way.
function bundle(entry, out) {
  execSync(
    `npx esbuild ${path.join(__dirname, entry)} --bundle --minify --format=iife --jsx=automatic --outfile=${path.join(dist, out)}`,
    { stdio: 'inherit' }
  );
  const code = fs.readFileSync(path.join(dist, out), 'utf8');
  fs.rmSync(path.join(dist, out));
  return code;
}

const js = bundle('entry.jsx', 'bundle.js');
const shareJs = bundle('share.jsx', 'share-bundle.js');

const css = fs.readFileSync(path.join(dist, 'tailwind-output.css'), 'utf8');

// Same target-face glyph used for the favicon, reused as the PWA icon too
// so the installed app matches the browser tab. SVG-only, no rasterized
// PNGs — installability and the icon itself work fine on Android/desktop
// this way, but iOS Safari's home-screen icon specifically ignores SVG web
// manifest icons, so an iPhone/iPad "Add to Home Screen" will fall back to
// a plain screenshot-based icon rather than this glyph. A real PNG would
// need a rasterizer dependency this project doesn't otherwise need.
const iconSvg = '<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2248%22 fill=%22%23ECE8DF%22/><circle cx=%2250%22 cy=%2250%22 r=%2238%22 fill=%22%233B3F46%22/><circle cx=%2250%22 cy=%2250%22 r=%2228%22 fill=%22%233373B0%22/><circle cx=%2250%22 cy=%2250%22 r=%2218%22 fill=%22%23D8434A%22/><circle cx=%2250%22 cy=%2250%22 r=%228%22 fill=%22%23E7B933%22/></svg>';

const manifest = {
  name: 'Arcieri Senesi — Scorecard',
  short_name: 'Scorecard',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#14161A',
  theme_color: '#14161A',
  icons: [{ src: `data:image/svg+xml,${iconSvg}`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
};
const manifestHref = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`;

// `installable` gates the PWA machinery: only the organizer's app is meant
// to be added to a home screen. Handing a spectator a manifest would offer
// them an install of a page that shows one tournament.
const page = (script, { installable }) => `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Arcieri Senesi — Scorecard</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14161A">
${installable ? `<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="${manifestHref}">` : ''}
<link rel="icon" href="data:image/svg+xml,${iconSvg}">
<style>${css}
html,body{margin:0;padding:0;background:#14161A;}</style>
</head>
<body>
<div id="root"></div>
<script>${script}</script>
</body>
</html>
`;

const html = page(js, { installable: true });
const shareHtml = page(shareJs, { installable: false });

fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, 'share.html'), shareHtml);
fs.rmSync(path.join(dist, 'tailwind-output.css'));

// Cache name gets a fresh version stamp on every build, so the service
// worker's `activate` handler always purges the previous deploy's cached
// shell instead of an old copy lingering forever (see site/sw.js).
const swSource = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')
  .replace('__CACHE_VERSION__', `shell-${Date.now()}`);
fs.writeFileSync(path.join(dist, 'sw.js'), swSource);

console.log('Built site/dist/index.html (' + (html.length / 1024).toFixed(0) + ' KB)');
console.log('Built site/dist/share.html  (' + (shareHtml.length / 1024).toFixed(0) + ' KB — public spectator page)');
