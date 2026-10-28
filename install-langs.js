// Installs Python 3 and GCC (C++) inside the Piston container. Run once after `docker compose up -d`.
const { PISTON_URL } = require('./config');

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

(async () => {
  const pkgs = await (await fetch(PISTON_URL + '/api/v2/packages')).json();

  for (const lang of ['python', 'gcc']) {
    let options = pkgs.filter(p => p.language === lang);
    if (lang === 'python') options = options.filter(p => p.language_version.startsWith('3.'));
    if (!options.length) { console.log(`No package found for ${lang}`); continue; }
    if (options.some(p => p.installed)) { console.log(`${lang} already installed`); continue; }

    const best = options.sort((a, b) => compareVersions(b.language_version, a.language_version))[0];
    console.log(`Installing ${lang} ${best.language_version} (can take a few minutes)...`);
    const r = await fetch(PISTON_URL + '/api/v2/packages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang, version: best.language_version })
    });
    const d = await r.json().catch(() => ({}));
    console.log(r.ok ? `Installed ${lang} ${best.language_version}` : `Failed: ${d.message || r.status}`);
  }

  const runtimes = await (await fetch(PISTON_URL + '/api/v2/runtimes')).json();
  console.log('Ready runtimes:', runtimes.map(r => `${r.language} ${r.version}`).join(', '));
})().catch(err => {
  console.error(`Could not reach Piston at ${PISTON_URL}: ${err.message}`);
  console.error('Is Docker Desktop running? Then run: docker compose up -d');
  process.exit(1);
});