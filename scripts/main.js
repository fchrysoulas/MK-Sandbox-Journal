import { MODULE_ID, SHEET_CLASS_KEY, registerMKSandboxSheet } from "./sheet.js";
import { runImport } from "./importer.js";

const DEFAULT_FONT_FAMILY = '"Signika", sans-serif';

function applyFontFamily(value = DEFAULT_FONT_FAMILY) {
  const fontFamily = String(value ?? "").trim() || DEFAULT_FONT_FAMILY;
  document.documentElement.style.setProperty("--mk-sandbox-font-family", fontFamily);
}

function registerSettings() {
  const defs = {
    owner: { name: "GitHub owner", hint: "Default repository owner used by the importer.", type: String, default: "fchrysoulas" },
    repo: { name: "GitHub repository", hint: "Default repository name used by the importer.", type: String, default: "MK-Sandbox" },
    ref: { name: "GitHub branch / ref", hint: "Default branch, tag, or ref used by the importer.", type: String, default: "main" },
    rootFolder: { name: "Journal root folder", hint: "Root Journal folder created or reused by the importer.", type: String, default: "Darkest Sun Sandbox" },
    visibility: {
      name: "Default imported journal access",
      hint: "Default ownership assigned to imported journals.",
      type: String,
      default: "gm",
      choices: { gm: "GM only", observer: "Players: Observer" }
    },
    updateExisting: { name: "Update existing imported pages", hint: "Update Overview and Raw Source while preserving GM Notes and custom pages.", type: Boolean, default: true },
    fontFamily: {
      name: "MK_SANDBOX.Settings.FontFamily.Name",
      hint: "MK_SANDBOX.Settings.FontFamily.Hint",
      type: String,
      default: DEFAULT_FONT_FAMILY,
      onChange: applyFontFamily
    }
  };

  for (const [key, cfg] of Object.entries(defs)) {
    game.settings.register(MODULE_ID, key, {
      scope: "world",
      config: true,
      restricted: true,
      ...cfg
    });
  }
}

function getRoot(html) {
  if (html instanceof HTMLElement) return html;
  return null;
}

function injectImportButton(app, html) {
  if (!game.user?.isGM) return;
  const root = getRoot(html) ?? app?.element ?? null;
  if (!root || root.querySelector(".mk-sandbox-import-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mk-sandbox-import-button";
  button.innerHTML = '<i class="fas fa-cloud-arrow-down"></i><span>MK Sandbox</span>';
  button.title = "Import or synchronize MK-Sandbox journals from GitHub";
  button.addEventListener("click", event => {
    event.preventDefault();
    runImport().catch(error => {
      console.error(`${MODULE_ID} | Import failed`, error);
      ui.notifications.error(`MK Sandbox import failed: ${error?.message ?? error}`);
    });
  });

  const candidates = [
    root.querySelector(".directory-header .header-actions"),
    root.querySelector(".directory-header .action-buttons"),
    root.querySelector(".directory-header"),
    root.querySelector("header.directory-header")
  ].filter(Boolean);

  const host = candidates[0];
  if (host) host.appendChild(button);
}

async function applySheetToExistingImports() {
  if (!game.user?.isGM) return;
  const updates = [];
  for (const journal of game.journal ?? []) {
    const flag = journal.getFlag?.("world", "mkSandbox");
    if (!flag?.sourceId && !flag?.sourceType) continue;
    if (journal.getFlag?.("core", "sheetClass") === SHEET_CLASS_KEY) continue;
    updates.push({ _id: journal.id, "flags.core.sheetClass": SHEET_CLASS_KEY });
  }
  if (!updates.length) return;
  try {
    await CONFIG.JournalEntry.documentClass.updateDocuments(updates);
    console.log(`${MODULE_ID} | Applied custom sheet to ${updates.length} existing imported journal(s).`);
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not automatically migrate all imported journals to the custom sheet.`, error);
  }
}

Hooks.once("init", () => {
  registerSettings();
  applyFontFamily(game.settings.get(MODULE_ID, "fontFamily"));
  registerMKSandboxSheet();
  console.log(`${MODULE_ID} | Initialized.`);
});

Hooks.once("ready", async () => {
  game.mkSandboxJournal = {
    moduleId: MODULE_ID,
    version: game.modules.get(MODULE_ID)?.version ?? "1.0.1",
    sheetClass: SHEET_CLASS_KEY,
    import: runImport
  };
  await applySheetToExistingImports();
});

Hooks.on("renderJournalDirectory", injectImportButton);
