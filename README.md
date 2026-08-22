# MK Sandbox Journal

MK Sandbox Journal brings a structured MK-Sandbox campaign repository into Foundry VTT as a browsable, synchronized journal library. A GM can import campaign records from GitHub, organize them automatically by type, review their source metadata, and maintain private notes alongside the imported material.

Imported records remain standard Foundry `JournalEntry` and `JournalEntryPage` documents. The module adds a dedicated sheet for navigating those records without introducing a custom document format or requiring another module.

## Features

- Imports and synchronizes an MK-Sandbox repository from GitHub.
- Reads `manifest.json`, `world-state.json`, indexed records, and supported files in Events, Reports, Artifacts, and Plots.
- Organizes Campaign, Actor, Faction, Location, Route, Artifact, Plot, Action, Event, Report, History, Market, and uncategorized records into dedicated Journal folders.
- Uses stable `flags.world.mkSandbox.sourceId` values to update the correct Foundry journal.
- Preserves GM Notes and manually created pages when imported content is refreshed.
- Shows live import progress.
- Presents imported records through the **MK Sandbox Journal** sheet with page navigation and source metadata.
- Provides a GM-only **MK Sandbox** import button in the Journal sidebar.
- Exposes `game.mkSandboxJournal.import()` for macros and console use.
- Keeps the GitHub token in memory only for the active import.

## Installation

In Foundry's **Add-on Modules** setup screen, choose **Install Module** and paste this manifest URL:

```text
https://github.com/fchrysoulas/MK-Sandbox-Journal/releases/latest/download/module.json
```

Alternatively, create Foundry's `Data/modules/mk-sandbox-journal/` directory, extract the contents of `mk-sandbox-journal.zip` into it, and restart Foundry. The extracted `module.json` must be directly inside that directory.

## Usage

1. Enable **MK Sandbox Journal** in the world.
2. Open the **Journal** sidebar.
3. As GM, click **MK Sandbox** in the Journal directory header.
4. Enter the repository details and an optional GitHub token.
5. Choose the Journal root folder, visibility, and update preference.
6. Run the import.

The module remembers only the non-secret owner, repository, ref, root folder, visibility, and update defaults.

Run the importer again whenever the repository changes. With **Update imported pages** enabled, Overview and Raw Source pages are refreshed while GM Notes and manually created pages are preserved.

## Journal structure

Each source record is stored using this structure:

```text
JournalEntry
|-- Overview
|-- Raw Source
|-- GM Notes
`-- any manually created pages

flags.world.mkSandbox
```

The custom sheet is selected through Foundry's normal core sheet assignment:

```text
flags.core.sheetClass = mk-sandbox-journal.MKSandboxJournalSheet
```

## Custom sheet

The custom sheet provides:

- record type, icon, and identity;
- Journal page navigation;
- source ID, path, and revision metadata;
- a full-width content area;
- an **Edit Page** button for opening Foundry's native page editor.

## GitHub access

Public repositories do not require a token. For a private repository, use a fine-grained Personal Access Token restricted to that repository with **Contents: Read-only** permission.

The token is never stored in Foundry settings, journal flags, chat, or console output. Do not save it in a journal or share it with other users.

## Compatibility

MK Sandbox Journal is system-independent and supports Foundry VTT v13 and v14. Foundry v12 is not supported.

## Support and community

If you find the module useful, you can [support Mikrokouneli on Ko-fi](https://ko-fi.com/mikrokouneli).

- [Twitch](https://www.twitch.tv/mikrokouneli)
- [YouTube](https://www.youtube.com/@mikrokouneli)

## License

MK Sandbox Journal is available under the [MIT License](LICENSE).
