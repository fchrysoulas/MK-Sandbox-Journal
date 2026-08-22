# Publishing MK Sandbox Journal

This module is distributed through GitHub Releases. Foundry checks the stable manifest URL for updates, while every released manifest points to its own version-pinned ZIP archive.

## Release metadata

Use these values when submitting or updating the module in Foundry's package administration:

| Field | Value |
| --- | --- |
| Package type | Add-on Module |
| Package ID | `mk-sandbox-journal` |
| Package title | `MK Sandbox Journal` |
| Project URL | `https://github.com/fchrysoulas/MK-Sandbox-Journal` |
| Support URL | `https://ko-fi.com/mikrokouneli` |
| License | MIT |
| Latest manifest URL | `https://github.com/fchrysoulas/MK-Sandbox-Journal/releases/latest/download/module.json` |
| Version 1.0.1 manifest URL | `https://github.com/fchrysoulas/MK-Sandbox-Journal/releases/download/v1.0.1/module.json` |
| Release notes URL | `https://github.com/fchrysoulas/MK-Sandbox-Journal/releases/tag/v1.0.1` |
| Minimum Foundry version | `13` |
| Verified Foundry version | `14` |
| Suggested categories | Content Importers; Journals and Notes; External Integrations |

The version-specific manifest URL belongs in a Foundry package-version record. The stable latest URL belongs in `module.json` and is also the direct-install URL shared with users.

## Publish a release

1. Update `version` in `module.json`.
2. Update `download` in `module.json` to use the same `vX.Y.Z` tag.
3. Add the release notes to `CHANGELOG.md`.
4. Validate the JavaScript and JSON locally.
5. Commit and push the changes.
6. Create and push the matching tag:

   ```powershell
   git tag v1.0.1
   git push origin v1.0.1
   ```

The `release.yml` workflow rejects a tag that does not exactly match the manifest version. On success it creates a GitHub Release containing:

- `module.json` at the release root;
- `mk-sandbox-journal.zip`, with `module.json` and all runtime files at the ZIP root.

After the workflow finishes, verify that both URLs return successfully and install the release in a backup Foundry world using the latest manifest URL.

## Official package listing

For the first public listing, sign in to the Foundry website and use the [Package Submission Form](https://foundryvtt.com/packages/submit). The listing is manually reviewed. After approval, add a package version whose version, manifest URL, and compatibility values match the released `module.json`.

For later releases, add the new version-specific manifest URL to Foundry package administration after the GitHub Release is available. Do not use the stable `/latest/` URL for an individual historical package-version record.

## Licensing check

The module code is published under the MIT License. Before publishing, also confirm that all distributed text, icons, and other assets may be distributed under the applicable terms.
