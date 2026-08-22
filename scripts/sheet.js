export const MODULE_ID = "mk-sandbox-journal";
export const SHEET_CLASS_KEY = `${MODULE_ID}.MKSandboxJournalSheet`;
const FLAG_SCOPE = "world";
const FLAG_KEY = "mkSandbox";

const PAGE_ICONS = {
  "overview": "fas fa-book-open",
  "campaign-overview": "fas fa-book-open",
  "raw-source": "fas fa-code",
  "campaign-raw": "fas fa-code",
  "gm-notes": "fas fa-sticky-note",
  "repository-readme": "fab fa-readme",
  "sandbox-instructions": "fas fa-scroll",
  "import-problems": "fas fa-triangle-exclamation"
};

const TYPE_ICONS = {
  actor: "fas fa-user",
  faction: "fas fa-users",
  location: "fas fa-map-marker-alt",
  route: "fas fa-route",
  action: "fas fa-bolt",
  "event-bundle": "fas fa-calendar-alt",
  event: "fas fa-calendar-alt",
  report: "fas fa-file-lines",
  artifact: "fas fa-gem",
  plot: "fas fa-diagram-project",
  market: "fas fa-store",
  history: "fas fa-clock-rotate-left",
  "historical-event": "fas fa-clock-rotate-left",
  "gm-ruling": "fas fa-gavel",
  campaign: "fas fa-book-open",
  other: "fas fa-bookmark"
};

function readFlag(document) {
  return document?.getFlag?.(FLAG_SCOPE, FLAG_KEY) ?? {};
}

function humanize(value) {
  return String(value ?? "Record")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, c => c.toUpperCase());
}

function extractImportedMain(html) {
  const text = String(html ?? "");
  if (!text.includes("mk-sandbox-codex-layout")) return text;
  try {
    const parsed = new DOMParser().parseFromString(text, "text/html");
    const layout = parsed.querySelector(".mk-sandbox-codex-layout");
    const main = layout?.querySelector("main");
    return main?.innerHTML || text;
  } catch (_error) {
    return text;
  }
}

async function enrichPage(page, journal) {
  let content = "";
  if (page.type === "text") {
    content = extractImportedMain(page.text?.content ?? "");
    const editor = foundry.applications.ux.TextEditor;
    if (editor?.enrichHTML) {
      try {
        content = await editor.enrichHTML(content, {
          async: true,
          secrets: journal.isOwner,
          relativeTo: page
        });
      } catch (_error) {
        // Keep the stored HTML when enrichment is unavailable on a particular version.
      }
    }
  } else if (page.type === "image" && page.src) {
    content = `<figure class="mk-sheet-image-page"><img src="${page.src}" alt="${page.name}"></figure>`;
  } else {
    content = `<div class="mk-empty-page"><p>${humanize(page.type)} page. Open the page editor to view or edit this page type.</p></div>`;
  }

  const flag = readFlag(page);
  return {
    id: page.id,
    name: page.name,
    role: flag.pageRole ?? "page",
    icon: PAGE_ICONS[flag.pageRole] ?? "fas fa-file-lines",
    content
  };
}

async function buildContext(journal) {
  const flag = readFlag(journal);
  const pages = [...(journal.pages?.contents ?? journal.pages ?? [])]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)));
  const renderedPages = [];
  for (const page of pages) renderedPages.push(await enrichPage(page, journal));
  if (renderedPages.length) renderedPages[0].active = true;

  const sourceType = String(flag.sourceType ?? "other").toLowerCase();
  return {
    document: journal,
    title: journal.name,
    isOwner: journal.isOwner,
    isGM: game.user?.isGM,
    sourceId: flag.sourceId ?? journal.id,
    sourceType,
    sourceTypeLabel: humanize(sourceType),
    sourcePath: flag.sourcePath ?? "",
    revision: flag.revision ?? "",
    repository: flag.repository ?? "",
    ref: flag.ref ?? "",
    icon: TYPE_ICONS[sourceType] ?? TYPE_ICONS.other,
    pages: renderedPages,
    hasPages: renderedPages.length > 0
  };
}

function bindSheetInteractions(sheet, root) {
  if (!root) return;
  const navButtons = root.querySelectorAll("[data-mk-page-id]");
  const panels = root.querySelectorAll("[data-mk-page-panel]");
  const pageTitle = root.querySelector("[data-mk-active-page-title]");

  for (const button of navButtons) {
    button.addEventListener("click", event => {
      event.preventDefault();
      const id = button.dataset.mkPageId;
      for (const other of navButtons) other.classList.toggle("active", other === button);
      for (const panel of panels) panel.classList.toggle("active", panel.dataset.mkPagePanel === id);
      if (pageTitle) pageTitle.textContent = button.dataset.mkPageName || "";
    });
  }

  for (const button of root.querySelectorAll("[data-mk-edit-page]")) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      const id = button.dataset.mkEditPage;
      const page = sheet.document?.pages?.get?.(id);
      if (!page) return;
      try {
        return await page.render(true);
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not open page editor`, error);
        ui.notifications.warn("Could not open the native Journal page editor.");
      }
    });
  }
}

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MKSandboxJournalSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["mk-sandbox-journal-sheet", "sheet", "journal-sheet"],
    window: {
      frame: true,
      icon: "fas fa-book-open",
      minimizable: true,
      resizable: true
    },
    position: {
      width: 1040,
      height: 820
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/sheet.hbs`,
      scrollable: [".mk-sheet-main", ".mk-page-body", ".mk-sheet-sidebar"]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, await buildContext(this.document));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    bindSheetInteractions(this, this.element);
  }
}

export function registerMKSandboxSheet() {
  const JournalEntryDocument = CONFIG.JournalEntry.documentClass;
  const { DocumentSheetConfig } = foundry.applications.apps;
  try {
    DocumentSheetConfig.registerSheet(JournalEntryDocument, MODULE_ID, MKSandboxJournalSheet, {
      label: "MK Sandbox Journal",
      makeDefault: false,
      canBeDefault: true
    });
    console.log(`${MODULE_ID} | Registered ${SHEET_CLASS_KEY}.`);
    return MKSandboxJournalSheet;
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to register JournalEntry sheet.`, error);
    return null;
  }
}
