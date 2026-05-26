# Install troubleshooting

This package intentionally does not include package-lock.json.
The previous archive included a lockfile generated inside a sandbox and could cause npm to reuse non-public registry URLs.

Recommended install:

```bash
node -v
npm -v
npm cache verify
npm install --no-audit --no-fund
npm run dev
```

If npm shows `Exit handler never called!`, it is usually an npm CLI/runtime issue rather than a TypeScript or Vite compile error.
Try:

```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --no-audit --no-fund
```

On Windows/Git Bash, if the error persists, use PowerShell in the same folder:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm cache clean --force
npm install --no-audit --no-fund
npm run dev
```

If npm itself remains broken, use Corepack + pnpm:

```bash
corepack enable
corepack prepare pnpm@9 --activate
pnpm install
pnpm dev
```
