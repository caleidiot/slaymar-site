# slaymar.com

Slaymar FC's site. Thursday futsal at Unley (Life Be In It SA).

- `scripts/scrape.mjs` pulls the ladder, season fixture and squad from GameDay plus the latest YouTube uploads, and writes `data/site.json`.
- It finds the right competition automatically: it scans every Thursday comp on the association's comp list and picks the one where Slaymar FC has the latest game, so regrading into a division needs no changes.
- `.github/workflows/update.yml` runs the scraper every 3 hours and on every push, commits data changes, and deploys to GitHub Pages.
- Settings live in `config.json`.

Local test against saved pages: `npm ci && npm test`.
