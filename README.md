# Strategic Notebook

A React + TypeScript strategic intelligence dashboard, seeded with the October 20, 2026 Strategic Morning Brief. Includes three geopolitical theaters, 13 forecasts, prior-probability comparisons, competing IR models, expert lenses, AGI/ASI research hypotheses, scenarios, search/filter, and CSV export.

> **Data provenance:** All forecast probabilities and narratives are editorial snapshots from the conversation, **not** verified real-time reporting. No live API is configured. Verify source claims before relying on them.

## Run locally

```bash
npm ci
npm run dev
```

## Publish to GitHub Pages

The public repository is [chopssin/strategic-notebook](https://github.com/chopssin/strategic-notebook).
The website is [Strategic Notebook](https://chopssin.github.io/strategic-notebook/).

GitHub Pages uses **GitHub Actions** as its publishing source. The included workflow installs the locked dependencies, checks TypeScript, builds the site, and deploys on every push to `main`. It can also be run manually from the Actions tab.

Before pushing changes, verify the production build with `npm run build` and inspect it with `npm run preview`.

The Vite `base` is `/strategic-notebook/`. Change it if you rename the repository.

## Updating data

Edit `src/data.ts` and commit the change. All forecast dates are ISO strings. Outcomes remain `open` until independently verified and marked `hit` or `miss`. Brier scoring is intentionally not fabricated for unresolved forecasts.
