// Builds the standalone GitHub Pages bundle for ArcheryScorecard.jsx: a
// single self-contained index.html with Tailwind's compiled output and the
// React/recharts/lucide-react/@supabase bundle inlined. Run with `npm run
// build` from this directory (site/); output goes to site/dist/.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });

execSync(
  `npx tailwindcss -i ${path.join(__dirname, 'input.css')} -o ${path.join(dist, 'tailwind-output.css')} --content "${path.join(__dirname, '..', 'ArcheryScorecard.jsx')}" --minify`,
  { stdio: 'inherit' }
);

execSync(
  `npx esbuild ${path.join(__dirname, 'entry.jsx')} --bundle --minify --format=iife --jsx=automatic --outfile=${path.join(dist, 'bundle.js')}`,
  { stdio: 'inherit' }
);

const css = fs.readFileSync(path.join(dist, 'tailwind-output.css'), 'utf8');
const js = fs.readFileSync(path.join(dist, 'bundle.js'), 'utf8');

const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Arcieri Senesi — Scorecard</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2248%22 fill=%22%23ECE8DF%22/><circle cx=%2250%22 cy=%2250%22 r=%2238%22 fill=%22%233B3F46%22/><circle cx=%2250%22 cy=%2250%22 r=%2228%22 fill=%22%233373B0%22/><circle cx=%2250%22 cy=%2250%22 r=%2218%22 fill=%22%23D8434A%22/><circle cx=%2250%22 cy=%2250%22 r=%228%22 fill=%22%23E7B933%22/></svg>">
<style>${css}
html,body{margin:0;padding:0;background:#14161A;}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;

fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.rmSync(path.join(dist, 'tailwind-output.css'));
fs.rmSync(path.join(dist, 'bundle.js'));

console.log('Built site/dist/index.html (' + (html.length / 1024).toFixed(0) + ' KB)');
