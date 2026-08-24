# Changelog

## 1.1.0

- Resolve each import ref to an immutable Git commit before gathering records.
- Use raw GitHub downloads for public repositories so large imports do not exhaust the unauthenticated REST API request limit.
- Exclude all `system/` sources from journal imports and from the campaign manifest page.
- Exclude repository instruction and index files from supplemental record discovery.
- Retire sources removed from the current import set while preserving GM Notes and manually created pages.
- Remove importer-owned pages from previously imported `system/` and repository-metadata sources.
- Add a dedicated Clocks journal category for authoritative clock records.

## 1.0.1

- Removed the Edit Page button from the custom journal sheet.
- Added a configurable module-wide font-family setting with Signika as the default.
- Applied the configured font consistently to journal content, headings, window titles, importer controls, and progress UI.
- Preserved Foundry's icon font for window-header controls.

## 1.0.0

- Converted the MK-Sandbox GitHub importer from a standalone macro into a Foundry module.
- Added a custom MK Sandbox JournalEntry sheet.
- Added the v13-v14 ApplicationV2 sheet implementation.
- Set Foundry v13 as the minimum supported generation and removed legacy ApplicationV1 compatibility code.
- Added the MIT License and included it in release archives.
- Added Ko-fi, Twitch, and YouTube links to the project documentation and metadata.
- Added Journal sidebar import button.
- Added module settings for non-secret import defaults.
- Added automatic sheet assignment for existing imported journals.
- Preserved progress display, stable source binding, recursive Events/Reports/Artifacts/Plots discovery, folder classification, and GM Notes preservation from importer v1.4.0.
