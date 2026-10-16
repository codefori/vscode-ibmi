# OBJ_ATTR component PR review note (2026-10-05)

- Branch: feat/obj-attr-udtf-component
- Commit: fc043426
- PR URL: https://github.com/bobcozzi/vscode-ibmi/pull/new/feat/obj-attr-udtf-component
- Worktree: /Users/cozzi/Downloads/projects/vscode-ibmi-pr-mbr-attr

## Files changed
- src/extension.ts
- src/api/components/objAttr/index.ts
- src/api/components/objAttr/source.ts

## Quick review commands
- git show --stat fc043426
- git show fc043426 -- src/extension.ts src/api/components/mbrAttr/index.ts src/api/components/mbrAttr/source.ts
- git status -sb

## Change summary
- Added managed component class for OBJ_ATTR SQL UDTF deployment.
- Added embedded RPGLE source and SQL template with version token replacement.
- Registered the new component in extension activation so lifecycle check/update runs with component manager.
