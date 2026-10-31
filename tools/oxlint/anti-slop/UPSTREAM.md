# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), copied from the `install-anti-slop` skill's
bundled `assets/anti-slop` by its `scripts/install.mjs` on 2026-10-28.

- Source commit: unknown. The skill was installed from GitHub without recording a commit; its lock entry records only
  the skill folder hash `97962dc9fad565ca7695bf57805d9d0138ce1def` (`skills/install-anti-slop`, installed
  2026-10-28T06:11:39Z). Compare against that folder to recover the pristine snapshot.
- Installed paths: `tools/oxlint/anti-slop/` (generic plugin `index.ts`, opt-in Effect plugin `effect/index.ts`, and
  `vendor/eslint-stylistic/` with its own `LICENSE` and `UPSTREAM.md`).
- Registered in the root `vite.config.ts` (`lint.jsPlugins`, `lint.rules`, `lint.ignorePatterns`, `fmt.ignorePatterns`).
- Runtime dependency: `@oxlint/plugins` pinned to `1.89.0`, the `oxlint` version bundled by `vite-plus` 1.4.0.

## Local deviations

- None to the copied files.
- The Effect plugin is copied but not registered: the repository has no direct `effect` dependency.
