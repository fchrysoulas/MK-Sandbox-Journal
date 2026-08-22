# AGENTS.md

## Project overview

MK Sandbox Journal is a system-independent Foundry VTT module for generations 13 and 14. It imports records from an MK-Sandbox GitHub repository into ordinary `JournalEntry` and `JournalEntryPage` documents and supplies a custom journal sheet. Campaign Codex is not a dependency.

## Repository map

- `module.json`: package identity, compatibility, entry points, and release URLs.
- `scripts/main.js`: module initialization, settings, sheet registration, and Journal sidebar integration.
- `scripts/importer.js`: GitHub access, source discovery, normalization, folder/journal creation, and synchronization.
- `scripts/sheet.js`: ApplicationV2 journal sheet implementation.
- `templates/sheet.hbs`: custom JournalEntry sheet markup.
- `styles/mk-sandbox.css`: module and sheet styling.
- `lang/en.json`: English localization strings.
- `LICENSE`: MIT license for the module.
- `PUBLISHING.md`: release and Foundry package-listing runbook.
- `.github/FUNDING.yml`: Ko-fi sponsorship link shown by GitHub.
- `.github/workflows/release.yml`: tagged GitHub Release automation.

## Development rules

- Keep the module ID `mk-sandbox-journal` stable. It is part of settings keys, sheet class IDs, install paths, and release URLs.
- Preserve support for Foundry v13 and v14 unless a requested change explicitly alters the compatibility policy.
- Use the `DocumentSheetV2`/`HandlebarsApplicationMixin` application path. Do not reintroduce ApplicationV1 or Foundry v12 compatibility branches.
- Use feature detection around Foundry APIs that differ by generation. Do not assume an API exists merely because it exists in the newest generation.
- Imported content must remain standard Foundry journals and pages. Do not introduce Campaign Codex flags, document types, or a hard dependency.
- Preserve stable `flags.world.mkSandbox.sourceId` bindings, GM Notes, and manually created pages during updates.
- Never persist, log, place in chat, or write to journal flags a GitHub token. The token must remain in memory only for the active import.
- Keep user-facing text in `lang/en.json` when it belongs in the Foundry UI. Reuse the `MK_SANDBOX` localization namespace.
- Avoid adding build dependencies unless they provide a concrete maintenance benefit; the runtime is intentionally plain browser JavaScript.

## Validation

There is no automated Foundry integration test suite. Before handing off a change, run the available static checks from the repository root:

```powershell
Get-Content -Raw module.json | ConvertFrom-Json | Out-Null
Get-ChildItem scripts -Filter *.js | ForEach-Object { node --check $_.FullName }
```

For importer or sheet changes, also test in a backup world on the affected Foundry generations when a local Foundry installation is available. Check both a first import and an update of existing journals, including preservation of GM Notes and custom pages.

## Release discipline

- Use semantic versions without a leading `v` in `module.json`; Git tags use `vX.Y.Z`.
- Keep `module.json`'s `version` and version-pinned `download` URL synchronized.
- Add user-visible changes to `CHANGELOG.md` before tagging.
- Do not publish a tag until syntax checks pass and the working tree contains the intended release files.
- The release ZIP must contain `module.json` at its root, not inside an extra parent directory.
- Follow `PUBLISHING.md` for GitHub Release and official Foundry package-listing values.

## Change scope

Keep edits focused and preserve unrelated work in the working tree. When changing import behavior, document any migration or data-shape impact in the changelog. When changing compatibility metadata, ensure the claim reflects a version that was actually tested or intentionally supported by the compatibility shims.
