/**
 * MK Sandbox — GitHub Journal Importer
 * Foundry Virtual Tabletop v13–v14
 *
 * Run as a GM from a Script Macro. The macro reads manifest.json from the
 * configured GitHub repository, downloads every indexed element plus repository reports, events, artifacts, and plots, and creates
 * or updates a structured Journal folder tree. The presentation mimics the Campaign Codex visual language,
 * but every imported record remains a standard Foundry JournalEntry with ordinary
 * text JournalEntryPages. The macro never writes flags.campaign-codex and does not
 * require the Campaign Codex module.
 *
 * The GitHub token is used only in memory for this run. It is not stored in
 * Foundry settings, flags, chat, or console output.
 */
import { MODULE_ID, SHEET_CLASS_KEY } from "./sheet.js";

export async function runImport() {
  "use strict";

  const IMPORTER_VERSION = "1.0.1";
  const FLAG_SCOPE = "world";
  const FLAG_KEY = "mkSandbox";
  const GITHUB_MAX_ATTEMPTS = 5;
  const GITHUB_REQUEST_TIMEOUT_MS = 45000;
  const GITHUB_REQUEST_CONCURRENCY = 2;
  const GITHUB_BASE_RETRY_MS = 1200;
  const GITHUB_THROTTLE_MS = 180;
  const setting = (key, fallback) => {
    try {
      const value = game.settings.get(MODULE_ID, key);
      return value === undefined || value === null || value === "" ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  };

  const DEFAULTS = {
    owner: setting("owner", "fchrysoulas"),
    repo: setting("repo", "MK-Sandbox"),
    ref: setting("ref", "main"),
    rootFolder: setting("rootFolder", "Darkest Sun Sandbox"),
    updateExisting: Boolean(setting("updateExisting", true)),
    visibility: setting("visibility", "gm")
  };

  const FOUNDRY_GENERATION = Number(
    game.release?.generation ?? String(game.version ?? "").split(".")[0]
  );
  const JournalEntryDocument = CONFIG.JournalEntry.documentClass;
  const FolderDocument = CONFIG.Folder.documentClass;
  const journalClass = JournalEntryDocument?.implementation ?? JournalEntryDocument;
  const folderClass = FolderDocument?.implementation ?? FolderDocument;

  if (!game.user?.isGM) {
    ui.notifications.error("Only a GM can import the MK Sandbox journals.");
    return;
  }

  if (Number.isFinite(FOUNDRY_GENERATION) && (FOUNDRY_GENERATION < 13 || FOUNDRY_GENERATION > 14)) {
    ui.notifications.warn(
      `MK Sandbox Importer ${IMPORTER_VERSION} is tested for Foundry v13-v14; detected v${FOUNDRY_GENERATION}. The import will continue.`
    );
  }

  if (!journalClass || !folderClass) {
    ui.notifications.error("Foundry JournalEntry or Folder document classes could not be resolved.");
    return;
  }

  const { DialogV2 } = foundry.applications.api;

  const escapeHTML = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const humanize = (key) => String(key ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

  const normalizePath = (path) => String(path ?? "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  const fileExtension = (path) => {
    const match = String(path ?? "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] ?? "";
  };

  const stableIdFromPath = (type, path) => {
    const directoryNames = {
      report: "reports",
      event: "events",
      artifact: "artifacts",
      plot: "plots"
    };
    const directoryName = directoryNames[type] ?? "";
    const prefixPattern = directoryName ? new RegExp(`^${directoryName}/`, "i") : /^$/;
    const withoutPrefix = String(path ?? "").replace(prefixPattern, "");
    const withoutExtension = withoutPrefix.replace(/\.[^.]+$/, "");
    const slug = withoutExtension
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "record";
    return `${type}-${slug}`;
  };

  const documentTitleFromText = (text, path) => {
    const heading = String(text ?? "").match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
    if (heading) return heading;
    const filename = String(path ?? "record")
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "record";
    return humanize(filename);
  };

  const makeFlag = (data) => ({
    [FLAG_SCOPE]: {
      [FLAG_KEY]: data
    }
  });

  const makeJournalFlags = (data) => ({
    ...makeFlag(data),
    core: { sheetClass: SHEET_CLASS_KEY }
  });

  const readFlag = (document) => document?.getFlag?.(FLAG_SCOPE, FLAG_KEY) ?? null;

  const formatDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
  };

  /**
   * Create a small, Foundry-version-independent progress panel.
   * It uses only browser DOM APIs, so it works across Foundry v13 and v14.
   */
  function createImportProgress() {
    const id = "mk-sandbox-import-progress";
    document.getElementById(id)?.remove();

    const root = document.createElement("section");
    root.id = id;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.style.cssText = [
      "position:fixed",
      "right:1.25rem",
      "bottom:1.25rem",
      "z-index:100000",
      "width:min(380px,calc(100vw - 2.5rem))",
      "padding:1rem",
      "border:1px solid #9d7044",
      "border-radius:.65rem",
      "background:linear-gradient(145deg,rgba(29,21,17,.99),rgba(66,38,25,.99))",
      "box-shadow:0 .55rem 1.6rem rgba(0,0,0,.55)",
      "color:#f3e3c4",
      "font-family:var(--mk-sandbox-font-family,'Signika',sans-serif)"
    ].join(";");

    root.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;">
        <div>
          <div style="font-weight:800;letter-spacing:.04em;color:#fff3d4;">MK Sandbox Import</div>
          <div data-role="stage" style="margin-top:.18rem;font-size:.88rem;color:#e6c997;">Preparing…</div>
        </div>
        <button data-role="close" type="button" hidden
          style="border:1px solid #9d7044;border-radius:.35rem;background:rgba(255,255,255,.08);color:#f3e3c4;padding:.2rem .48rem;cursor:pointer;">
          Close
        </button>
      </div>
      <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
        data-role="track" style="height:.78rem;margin-top:.85rem;border:1px solid #9d7044;border-radius:999px;overflow:hidden;background:rgba(0,0,0,.4);">
        <div data-role="bar" style="width:0%;height:100%;background:linear-gradient(90deg,#7f4b2b,#d89b49);transition:width .18s ease;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;gap:.75rem;margin-top:.52rem;font-size:.8rem;">
        <span data-role="detail" style="color:#d8c09b;overflow-wrap:anywhere;">Starting importer</span>
        <strong data-role="percent" style="color:#fff3d4;white-space:nowrap;">0%</strong>
      </div>`;

    document.body.appendChild(root);

    const stage = root.querySelector('[data-role="stage"]');
    const detail = root.querySelector('[data-role="detail"]');
    const percentText = root.querySelector('[data-role="percent"]');
    const track = root.querySelector('[data-role="track"]');
    const bar = root.querySelector('[data-role="bar"]');
    const close = root.querySelector('[data-role="close"]');
    close.addEventListener("click", () => root.remove());

    let current = 0;
    const set = (percent, stageText, detailText = "") => {
      current = Math.max(current, Math.min(100, Math.round(Number(percent) || 0)));
      bar.style.width = `${current}%`;
      track.setAttribute("aria-valuenow", String(current));
      percentText.textContent = `${current}%`;
      if (stageText) stage.textContent = stageText;
      detail.textContent = detailText || " ";
    };

    return {
      update(percent, stageText, detailText = "") {
        set(percent, stageText, detailText);
      },
      complete(message, withWarnings = false) {
        set(100, withWarnings ? "Import completed with warnings" : "Import complete", message);
        bar.style.background = withWarnings
          ? "linear-gradient(90deg,#8a5a16,#d5a13a)"
          : "linear-gradient(90deg,#2f6f45,#54a86b)";
        close.hidden = false;
      },
      fail(message) {
        stage.textContent = "Import failed";
        detail.textContent = message || "Unknown error";
        bar.style.background = "linear-gradient(90deg,#7e2626,#c65345)";
        close.hidden = false;
      },
      close() {
        root.remove();
      }
    };
  }

  const CODEX_STYLE = {
    accent: "#b9a987",
    accent80: "#c9bb9d",
    accent30: "rgba(185,169,135,.30)",
    accent10: "rgba(185,169,135,.12)",
    sidebar: "#2a2a2a",
    sidebarText: "#ffffff",
    main: "#f8f9fa",
    mainText: "#2a2a2a",
    card: "#ffffff",
    border: "#e2ddd3",
    shadow: "0 2px 8px rgba(0,0,0,.10)",
    page: "width:100%;margin:0;background:#f8f9fa;color:#2a2a2a;font-family:var(--mk-sandbox-font-family,'Signika',sans-serif);line-height:1.5;",
    panel: "margin:.7rem 0;padding:.9rem 1rem;border:1px solid #e2ddd3;border-radius:.55rem;background:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,.08);color:#2a2a2a;",
    section: "margin:0;font-family:var(--mk-sandbox-font-family,'Signika',sans-serif);font-size:1.35rem;line-height:1.2;letter-spacing:.08em;text-transform:uppercase;color:#2a2a2a;border:0;font-weight:700;",
    table: "width:100%;border-collapse:collapse;margin:.35rem 0;background:transparent;",
    th: "width:31%;padding:.5rem .58rem;text-align:left;vertical-align:top;border-bottom:1px solid #e2ddd3;color:#665b49;font-weight:700;",
    td: "padding:.5rem .58rem;vertical-align:top;border-bottom:1px solid #e2ddd3;color:#2a2a2a;",
    cardBox: "margin:.55rem 0;padding:.82rem .92rem;border:1px solid #e2ddd3;border-radius:.55rem;background:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,.07);color:#2a2a2a;",
    card: "margin:.55rem 0;padding:.82rem .92rem;border:1px solid #e2ddd3;border-radius:.55rem;background:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,.07);color:#2a2a2a;",
    footer: "margin-top:1rem;padding-top:.75rem;border-top:1px solid #e2ddd3;font-size:.78rem;color:#6a6256;"
  };

  const RECORD_VISUALS = {
    actor: { label: "NPC / Actor", icon: "fas fa-user" },
    faction: { label: "Faction", icon: "fas fa-users" },
    location: { label: "Location", icon: "fas fa-map-marker-alt" },
    route: { label: "Route", icon: "fas fa-route" },
    action: { label: "Action", icon: "fas fa-bolt" },
    "event-bundle": { label: "Event Timeline", icon: "fas fa-calendar-alt" },
    event: { label: "Event", icon: "fas fa-calendar-alt" },
    report: { label: "Report", icon: "fas fa-file-alt" },
    artifact: { label: "Artifact", icon: "fas fa-gem" },
    plot: { label: "Plot", icon: "fas fa-project-diagram" },
    market: { label: "Market", icon: "fas fa-store" },
    history: { label: "History", icon: "fas fa-history" },
    "historical-event": { label: "History", icon: "fas fa-history" },
    "gm-ruling": { label: "GM Ruling", icon: "fas fa-gavel" },
    campaign: { label: "Campaign", icon: "fas fa-book-open" },
    source: { label: "Source Record", icon: "fas fa-code" },
    notes: { label: "GM Notes", icon: "fas fa-sticky-note" },
    repository: { label: "Repository Document", icon: "fas fa-file-alt" },
    other: { label: "Record", icon: "fas fa-bookmark" }
  };

  const visualFor = (type) => RECORD_VISUALS[String(type ?? "other").toLowerCase()] ?? RECORD_VISUALS.other;

  const safeImageSource = (value) => {
    const src = String(value ?? "").trim();
    if (!src) return "";
    return /^(https?:\/\/|data:image\/|icons\/|systems\/|modules\/|worlds\/)/i.test(src) ? src : "";
  };

  const slugify = (value) => String(value ?? "section")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";

  function renderSidebarTags(values) {
    const clean = [...new Set((values ?? []).flat().filter((value) => value !== null && value !== undefined && value !== "").map(String))];
    if (!clean.length) return "";
    return `<div style="display:flex;flex-wrap:wrap;gap:.3rem;padding:.55rem .15rem 0;">${clean.map((value) =>
      `<span style="display:inline-block;padding:.14rem .42rem;border:1px solid rgba(185,169,135,.36);border-radius:999px;background:rgba(185,169,135,.08);color:#d8c9a8;font-size:.68rem;line-height:1.25;">${escapeHTML(humanize(value))}</span>`
    ).join("")}</div>`;
  }

  function renderPills(values) {
    const clean = [...new Set((values ?? []).flat().filter((value) => value !== null && value !== undefined && value !== "").map(String))];
    if (!clean.length) return "";
    return `<div style="display:flex;flex-wrap:wrap;gap:.35rem;margin:.45rem 0;">${clean.map((value) =>
      `<span style="display:inline-block;padding:.17rem .48rem;border:1px solid #d7cdb9;border-radius:999px;background:#f5f1e9;color:#5f5544;font-size:.72rem;line-height:1.25;">${escapeHTML(humanize(value))}</span>`
    ).join("")}</div>`;
  }

  function sectionTitle(title, icon = "fas fa-circle") {
    return `<div style="display:flex;align-items:center;gap:.65rem;margin:0 0 .7rem;padding-bottom:.55rem;border-bottom:1px solid #e2ddd3;">
      <i class="${icon}" style="color:#9f8f70;font-size:1.05rem;width:1.2rem;text-align:center;"></i>
      <h2 style="${CODEX_STYLE.section}">${escapeHTML(title)}</h2>
    </div>`;
  }

  function renderCodexShell({
    title,
    type = "other",
    subtitle = "",
    tags = [],
    sections = [],
    image = "",
    footer = "",
    sourceId = ""
  }) {
    const visual = visualFor(type);
    const safeImage = safeImageSource(image);
    const usableSections = (sections ?? []).filter((section) => section && section.content !== undefined && section.content !== null && section.content !== "");
    const firstKey = usableSections[0]?.key ?? "overview";
    const portrait = safeImage
      ? `<div style="width:100%;max-height:230px;border-radius:12px;overflow:hidden;margin:0 auto 1rem;display:flex;justify-content:center;background:#161616;">
          <img src="${escapeHTML(safeImage)}" alt="${escapeHTML(title)}" style="display:block;max-width:100%;width:100%;max-height:230px;object-fit:cover;object-position:50% 15%;" />
        </div>`
      : `<div style="width:100%;height:154px;border:1px solid rgba(185,169,135,.25);border-radius:12px;margin:0 auto 1rem;background:linear-gradient(145deg,#363636,#1d1d1d);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 32px rgba(0,0,0,.28);">
          <i class="${visual.icon}" style="font-size:3.3rem;color:#b9a987;opacity:.9;"></i>
        </div>`;
    const nav = usableSections.map((section, index) => {
      const key = slugify(section.key ?? section.label ?? `section-${index + 1}`);
      const active = key === slugify(firstKey);
      const stat = section.stat !== undefined && section.stat !== null && section.stat !== ""
        ? `<span style="margin-left:auto;min-width:1.45rem;padding:.06rem .32rem;border-radius:999px;background:${active ? "#b9a987" : "#fff"};color:#2a2a2a;font-size:.62rem;font-weight:700;text-align:center;">${escapeHTML(section.stat)}</span>`
        : "";
      return `<a href="#mkcc-${key}" style="display:flex;align-items:center;gap:.55rem;padding:.48rem .7rem;margin:.1rem 0;border-left:3px solid ${active ? "#b9a987" : "transparent"};border-radius:0 .35rem .35rem 0;background:${active ? "rgba(185,169,135,.12)" : "transparent"};color:${active ? "#b9a987" : "#ffffff"};text-decoration:none;font-size:.75rem;font-weight:${active ? "700" : "500"};">
        <i class="${section.icon ?? "fas fa-circle"}" style="width:1rem;text-align:center;color:#b9a987;"></i>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(section.label ?? humanize(key))}</span>${stat}
      </a>`;
    }).join("");
    const main = usableSections.map((section, index) => {
      const key = slugify(section.key ?? section.label ?? `section-${index + 1}`);
      return `<section id="mkcc-${key}" style="scroll-margin-top:1rem;margin:0 0 1.6rem;">
        ${sectionTitle(section.label ?? humanize(key), section.icon ?? "fas fa-circle")}
        ${section.content}
      </section>`;
    }).join("");
    return `<article class="mk-sandbox-codex-layout" style="${CODEX_STYLE.page}">
      <div style="display:flex;flex-wrap:wrap;width:100%;min-height:520px;border:1px solid #d7d1c5;border-radius:.65rem;background:#f8f9fa;box-shadow:0 8px 32px rgba(0,0,0,.15);overflow:hidden;">
        <aside style="flex:0 0 248px;min-width:210px;max-width:100%;background:rgba(42,42,42,.98);color:#ffffff;display:flex;flex-direction:column;">
          <div style="padding:1.15rem 1.15rem .5rem;text-align:center;">${portrait}
            <h1 style="margin:0 0 .3rem;font-family:var(--mk-sandbox-font-family,'Signika',sans-serif);font-size:1.55rem;line-height:1.08;letter-spacing:.09em;text-transform:uppercase;color:#ffffff;border:0;overflow-wrap:anywhere;">${escapeHTML(title)}</h1>
            <div style="display:flex;justify-content:center;align-items:center;gap:.42rem;margin:.2rem 0 .75rem;color:#c9bb9d;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;">
              <i class="${visual.icon}" style="color:#b9a987;"></i><span>${escapeHTML(visual.label)}</span>
            </div>
            ${subtitle ? `<div style="color:#d6d2ca;font-size:.76rem;line-height:1.4;overflow-wrap:anywhere;">${subtitle}</div>` : ""}
          </div>
          <nav style="padding:.3rem 0 .7rem;">${nav}</nav>
          <div style="margin-top:auto;padding:.65rem 1rem 1rem;border-top:1px solid rgba(185,169,135,.16);">
            ${sourceId ? `<div style="font-size:.64rem;color:#98938b;overflow-wrap:anywhere;margin-bottom:.35rem;">${escapeHTML(sourceId)}</div>` : ""}
            ${renderSidebarTags(tags)}
          </div>
        </aside>
        <main style="flex:1 1 430px;min-width:0;padding:1.55rem 1.7rem 1.4rem;background:#f8f9fa;color:#2a2a2a;">${main || `<div style="${CODEX_STYLE.panel}"><p><em>No displayable content.</em></p></div>`}
          ${footer ? `<footer style="${CODEX_STYLE.footer}">${footer}</footer>` : ""}
        </main>
      </div>
    </article>`;
  }

  function codexPage({ eyebrow = "Darkest Sun Sandbox", title, subtitle = "", tags = [], body = "", footer = "", type = "other", icon = "fas fa-book-open" }) {
    return renderCodexShell({
      title,
      type,
      subtitle: `${escapeHTML(eyebrow)}${subtitle ? `<br>${subtitle}` : ""}`,
      tags,
      sections: [{ key: "overview", label: "Overview", icon, content: body }],
      footer
    });
  }

  const getOwnership = (visibility) => {
    const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    return {
      default: visibility === "observer" ? levels.OBSERVER : levels.NONE
    };
  };

  const settingsFormHTML = `
    <div style="display:grid;grid-template-columns:9rem 1fr;gap:.55rem .75rem;align-items:center;">
      <label for="mk-owner">Owner</label>
      <input id="mk-owner" name="owner" type="text" value="${escapeHTML(DEFAULTS.owner)}" required>

      <label for="mk-repo">Repository</label>
      <input id="mk-repo" name="repo" type="text" value="${escapeHTML(DEFAULTS.repo)}" required>

      <label for="mk-ref">Branch / ref</label>
      <input id="mk-ref" name="ref" type="text" value="${escapeHTML(DEFAULTS.ref)}" required>

      <label for="mk-token">GitHub token</label>
      <input id="mk-token" name="token" type="password" autocomplete="off"
        placeholder="Required while the repository is private">

      <label for="mk-root">Root folder</label>
      <input id="mk-root" name="rootFolder" type="text" value="${escapeHTML(DEFAULTS.rootFolder)}" required>

      <label for="mk-visibility">Default access</label>
      <select id="mk-visibility" name="visibility">
        <option value="gm" ${DEFAULTS.visibility === "gm" ? "selected" : ""}>GM only</option>
        <option value="observer" ${DEFAULTS.visibility === "observer" ? "selected" : ""}>All players: Observer</option>
      </select>

      <label for="mk-update">Existing entries</label>
      <label style="display:flex;align-items:center;gap:.5rem;">
        <input id="mk-update" name="updateExisting" type="checkbox" ${DEFAULTS.updateExisting ? "checked" : ""}>
        Update imported pages; preserve custom pages
      </label>
    </div>
    <p class="hint" style="margin-top:.75rem;">
      The token is kept only in memory for this run and is never saved.
      A fine-grained token needs read-only access to repository contents.
    </p>
    <p class="hint">
      Imported records remain standard Foundry journals. This module supplies the Codex-style JournalEntry sheet and import workflow; Campaign Codex is not required.
    </p>`;

  const readSettingsForm = (form) => ({
    owner: form.elements.owner.value.trim(),
    repo: form.elements.repo.value.trim(),
    ref: form.elements.ref.value.trim(),
    token: form.elements.token.value.trim(),
    rootFolder: form.elements.rootFolder.value.trim(),
    visibility: form.elements.visibility.value,
    updateExisting: form.elements.updateExisting.checked
  });

  async function promptSettings() {
    return DialogV2.prompt({
      classes: ["mk-sandbox-import-dialog"],
      window: { title: "Import MK Sandbox from GitHub" },
      content: settingsFormHTML,
      ok: {
        label: "Import Journals",
        callback: (_event, button) => readSettingsForm(button.form)
      },
      rejectClose: false,
      modal: true
    });
  }

  let settings;
  try {
    settings = await promptSettings();
  } catch (_error) {
    return;
  }


  if (!settings?.owner || !settings?.repo || !settings?.ref || !settings?.rootFolder) {
    ui.notifications.error("Owner, repository, ref, and root folder are required.");
    return;
  }

  // Persist only non-secret import preferences. The GitHub token is never stored.
  for (const [key, value] of Object.entries({
    owner: settings.owner,
    repo: settings.repo,
    ref: settings.ref,
    rootFolder: settings.rootFolder,
    visibility: settings.visibility,
    updateExisting: settings.updateExisting
  })) {
    try { await game.settings.set(MODULE_ID, key, value); } catch (_error) {}
  }

  const progress = createImportProgress();
  progress.update(2, "Connecting to GitHub", `${settings.owner}/${settings.repo} · ${settings.ref} · Foundry v${Number.isFinite(FOUNDRY_GENERATION) ? FOUNDRY_GENERATION : "?"}`);

  try {
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function githubContentPayload(path) {
    const url = `${apiBase}/contents/${normalizePath(path)}?ref=${encodeURIComponent(settings.ref)}`;
    let lastError = null;

    for (let attempt = 1; attempt <= GITHUB_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
      let response = null;

      try {
        response = await fetch(url, {
          headers,
          signal: controller.signal,
          mode: "cors",
          credentials: "omit",
          cache: "no-store"
        });
      } catch (error) {
        lastError = error;
        if (attempt < GITHUB_MAX_ATTEMPTS) {
          const delay = GITHUB_BASE_RETRY_MS * (2 ** (attempt - 1)) + Math.floor(Math.random() * 450);
          progress.update(0, "GitHub connection retry", `${path} · attempt ${attempt + 1}/${GITHUB_MAX_ATTEMPTS}`);
          await sleep(delay);
          continue;
        }
        const reason = error?.name === "AbortError"
          ? `request timed out after ${Math.round(GITHUB_REQUEST_TIMEOUT_MS / 1000)} seconds`
          : (error?.message ?? String(error));
        throw new Error(
          `Unable to fetch ${path} after ${GITHUB_MAX_ATTEMPTS} attempts (${reason}). ` +
          "This is commonly caused by temporary GitHub throttling or a browser/network CORS failure."
        );
      } finally {
        clearTimeout(timeout);
      }

      if (response.ok) {
        const payload = await response.json();
        await sleep(GITHUB_THROTTLE_MS);
        return payload;
      }

      let detail = "";
      try {
        const body = await response.json();
        detail = body?.message ? ` — ${body.message}` : "";
      } catch (_error) {
        // Ignore non-JSON error bodies.
      }

      const retryable = [403, 408, 425, 429, 500, 502, 503, 504].includes(response.status);
      if (retryable && attempt < GITHUB_MAX_ATTEMPTS) {
        const retryAfterHeader = Number(response.headers.get("retry-after"));
        const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : GITHUB_BASE_RETRY_MS * (2 ** (attempt - 1)) + Math.floor(Math.random() * 450);
        lastError = new Error(`HTTP ${response.status}${detail}`);
        progress.update(0, "GitHub request retry", `${path} · HTTP ${response.status} · attempt ${attempt + 1}/${GITHUB_MAX_ATTEMPTS}`);
        await sleep(retryAfter);
        continue;
      }

      if (response.status === 404 && !settings.token) {
        throw new Error(`GitHub returned 404 for ${path}. The repository may be private; provide a read-only token.`);
      }
      if (response.status === 403) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        throw new Error(`GitHub denied access to ${path}${detail}${remaining === "0" ? " — API rate limit exhausted." : ""}`);
      }
      throw new Error(`GitHub request failed for ${path}: HTTP ${response.status}${detail}`);
    }

    throw lastError ?? new Error(`Unable to fetch ${path}.`);
  }

  async function githubFile(path) {
    const payload = await githubContentPayload(path);
    if (Array.isArray(payload)) throw new Error(`${path} is a directory, not a file.`);
    if (payload.encoding !== "base64" || !payload.content) {
      throw new Error(`GitHub did not return decodable file content for ${path}.`);
    }

    const binary = atob(payload.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function githubDirectory(path) {
    const payload = await githubContentPayload(path);
    if (!Array.isArray(payload)) throw new Error(`${path} is a file, not a directory.`);
    return payload;
  }

  async function discoverDirectoryFiles(directoryPath, type) {
    const acceptedExtensions = new Set(["json", "md", "markdown", "txt"]);
    const found = [];
    const pending = [String(directoryPath ?? "").replace(/\/+$/, "")];

    while (pending.length) {
      const current = pending.shift();
      const entries = await githubDirectory(current);
      for (const entry of entries) {
        if (entry.type === "dir") {
          pending.push(entry.path);
          continue;
        }
        if (entry.type !== "file" || !acceptedExtensions.has(fileExtension(entry.path))) continue;
        found.push({
          id: stableIdFromPath(type, entry.path),
          type,
          path: entry.path,
          revision: null,
          schemaVersion: null,
          indexed: false,
          discovered: true
        });
      }
    }

    return found;
  }

  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    });
    await Promise.all(runners);
    return results;
  }

  const categoryConfig = {
    campaign: { name: "Campaign", order: 0 },
    actor: { name: "Actors", order: 10 },
    faction: { name: "Factions", order: 20 },
    location: { name: "Locations", order: 30 },
    route: { name: "Routes", order: 40 },
    artifact: { name: "Artifacts", order: 50 },
    plot: { name: "Plots", order: 60 },
    action: { name: "Actions", order: 70 },
    event: { name: "Events", order: 80 },
    report: { name: "Reports", order: 90 },
    "historical-event": { name: "History", order: 100 },
    market: { name: "Markets", order: 110 },
    other: { name: "Other", order: 999 }
  };

  const CATEGORY_BY_DIRECTORY = {
    actors: "actor",
    factions: "faction",
    locations: "location",
    routes: "route",
    artifacts: "artifact",
    plots: "plot",
    actions: "action",
    events: "event",
    reports: "report",
    history: "historical-event",
    markets: "market"
  };

  const TYPE_CATEGORY_ALIASES = {
    "event-bundle": "event",
    event: "event",
    report: "report",
    artifact: "artifact",
    plot: "plot",
    "gm-ruling": "historical-event",
    history: "historical-event",
    "historical-event": "historical-event",
    market: "market"
  };

  function categoryKey(type, sourcePath = "") {
    const directory = String(sourcePath ?? "")
      .split("/")
      .filter(Boolean)[0]
      ?.toLowerCase();
    const directoryCategory = CATEGORY_BY_DIRECTORY[directory];
    if (directoryCategory && categoryConfig[directoryCategory]) return directoryCategory;

    const normalizedType = String(type ?? "").trim().toLowerCase();
    const aliasedType = TYPE_CATEGORY_ALIASES[normalizedType] ?? normalizedType;
    return categoryConfig[aliasedType] ? aliasedType : "other";
  }

  async function ensureFolder({ name, key, parent = null, sort = 0 }) {
    let folder = game.folders.find((candidate) => {
      const flag = readFlag(candidate);
      return candidate.type === "JournalEntry" && flag?.folderKey === key;
    });

    const data = {
      name,
      type: "JournalEntry",
      folder: parent?.id ?? null,
      sorting: "a",
      sort,
      flags: makeFlag({
        importerVersion: IMPORTER_VERSION,
        folderKey: key,
        repository: `${settings.owner}/${settings.repo}`,
        ref: settings.ref
      })
    };

    if (!folder) folder = await folderClass.create(data);
    else await folder.update(data);
    return folder;
  }

  function entityDisplayName(record, fallbackId) {
    return record?.name || humanize(String(fallbackId).replace(/^(actor|faction|location|route|action|history|historical-event|event-bundle|event|report|artifact|plot|market|gm-ruling)-/, ""));
  }

  function documentLink(sourceId, linkIndex, label = null) {
    const target = linkIndex.get(sourceId);
    if (!target) return escapeHTML(label ?? sourceId);
    return `@UUID[${target.uuid}]{${escapeHTML(label ?? target.name)}}`;
  }

  function renderScalar(value, linkIndex) {
    if (value === null || value === undefined || value === "") return "<em>None</em>";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return escapeHTML(value);
    if (typeof value === "string") {
      if (linkIndex.has(value)) return documentLink(value, linkIndex);
      return escapeHTML(value).replaceAll("\n", "<br>");
    }
    return escapeHTML(JSON.stringify(value));
  }

  function renderProgress(progressValue, target) {
    const current = Number(progressValue ?? 0);
    const maximum = Math.max(Number(target ?? 0), 1);
    const percent = Math.max(0, Math.min(100, Math.round((current / maximum) * 100)));
    return `<div style="display:grid;grid-template-columns:1fr auto;gap:.65rem;align-items:center;margin:.55rem 0 .15rem;">
      <div style="height:.62rem;border:1px solid #cfc4af;border-radius:999px;overflow:hidden;background:#ede9e1;">
        <div style="width:${percent}%;height:100%;background:linear-gradient(90deg,#7a6d55,#b9a987);"></div>
      </div>
      <strong style="font-size:.75rem;color:#685d4b;">${escapeHTML(current)} / ${escapeHTML(target ?? "—")}</strong>
    </div>`;
  }

  function renderObjectTable(object, linkIndex) {
    const rows = Object.entries(object ?? {}).map(([key, value]) => `<tr>
      <th style="${CODEX_STYLE.th}">${escapeHTML(humanize(key))}</th>
      <td style="${CODEX_STYLE.td}">${renderNestedValue(value, linkIndex, 1)}</td>
    </tr>`).join("");
    return rows ? `<div style="${CODEX_STYLE.panel}"><table style="${CODEX_STYLE.table}">${rows}</table></div>` : "<p><em>None</em></p>";
  }

  function renderNestedValue(value, linkIndex, depth = 0) {
    if (value === null || value === undefined || typeof value !== "object") return renderScalar(value, linkIndex);
    if (depth > 4) return `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:.65rem;border-radius:.4rem;background:#f0ede7;color:#2a2a2a;">${escapeHTML(JSON.stringify(value, null, 2))}</pre>`;
    if (Array.isArray(value)) {
      if (!value.length) return "<em>None</em>";
      if (value.every((item) => item === null || typeof item !== "object")) {
        return `<ul style="margin:.25rem 0 .25rem 1.1rem;padding:0;">${value.map((item) => `<li style="margin:.18rem 0;">${renderScalar(item, linkIndex)}</li>`).join("")}</ul>`;
      }
      return value.map((item) => `<section style="${CODEX_STYLE.card}">${renderNestedValue(item, linkIndex, depth + 1)}</section>`).join("");
    }
    return renderObjectTableDepth(value, linkIndex, depth + 1);
  }

  function renderObjectTableDepth(object, linkIndex, depth) {
    const rows = Object.entries(object ?? {}).map(([key, value]) => `<tr>
      <th style="${CODEX_STYLE.th}">${escapeHTML(humanize(key))}</th>
      <td style="${CODEX_STYLE.td}">${renderNestedValue(value, linkIndex, depth)}</td>
    </tr>`).join("");
    return rows ? `<table style="${CODEX_STYLE.table}">${rows}</table>` : "<p><em>None</em></p>";
  }

  function renderNarrative(value, linkIndex) {
    if (value === null || value === undefined || value === "") return "";
    if (Array.isArray(value)) return `<div style="${CODEX_STYLE.panel}">${renderNestedValue(value, linkIndex)}</div>`;
    if (typeof value === "object") return renderObjectTable(value, linkIndex);
    return `<div style="${CODEX_STYLE.panel}"><p style="margin:.05rem 0;white-space:normal;">${renderScalar(value, linkIndex)}</p></div>`;
  }

  function renderGoals(goals, linkIndex) {
    if (!Array.isArray(goals) || !goals.length) return `<div style="${CODEX_STYLE.panel}"><em>No recorded goals.</em></div>`;
    return goals.map((goal, index) => `<section style="${CODEX_STYLE.card}">
      <div style="display:flex;gap:.7rem;align-items:flex-start;">
        <span style="flex:0 0 1.65rem;height:1.65rem;border-radius:50%;background:#2a2a2a;color:#b9a987;display:inline-flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;">${index + 1}</span>
        <div style="flex:1;min-width:0;">
          <h3 style="margin:0 0 .4rem;color:#3a342d;font-size:1.02rem;line-height:1.32;border:0;">${escapeHTML(goal.description ?? humanize(goal.id ?? "Goal"))}</h3>
          <div style="display:flex;flex-wrap:wrap;gap:.35rem;font-size:.72rem;color:#675d50;">
            ${goal.status ? `<span><strong>Status:</strong> ${renderScalar(goal.status, linkIndex)}</span>` : ""}
            ${goal.priority !== undefined ? `<span>· <strong>Priority:</strong> ${renderScalar(goal.priority, linkIndex)}</span>` : ""}
            ${goal.secret !== undefined ? `<span>· <strong>Secret:</strong> ${renderScalar(goal.secret, linkIndex)}</span>` : ""}
            ${goal.deadlineDay !== undefined && goal.deadlineDay !== null ? `<span>· <strong>Deadline:</strong> Day ${renderScalar(goal.deadlineDay, linkIndex)}</span>` : ""}
          </div>
          ${goal.target !== undefined ? renderProgress(goal.progress, goal.target) : ""}
        </div>
      </div>
    </section>`).join("");
  }

  function renderClocks(clocks, linkIndex) {
    const entries = Object.entries(clocks ?? {});
    if (!entries.length) return `<div style="${CODEX_STYLE.panel}"><em>No active clocks.</em></div>`;
    return entries.map(([id, clock]) => `<section style="${CODEX_STYLE.card}">
      <div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.25rem;">
        <i class="fas fa-clock" style="color:#9f8f70;"></i>
        <h3 style="margin:0;color:#3a342d;font-size:1rem;line-height:1.3;border:0;">${escapeHTML(clock.name ?? humanize(id))}</h3>
      </div>
      ${clock.trigger ? `<p style="margin:.35rem 0;"><strong>Trigger:</strong> ${renderScalar(clock.trigger, linkIndex)}</p>` : ""}
      ${renderProgress(clock.progress, clock.segments)}
      <p style="margin:.35rem 0 0;font-size:.76rem;color:#675d50;"><strong>Status:</strong> ${renderScalar(clock.status, linkIndex)}${clock.visibility !== undefined ? ` · <strong>Visibility:</strong> ${renderScalar(clock.visibility, linkIndex)}` : ""}</p>
    </section>`).join("");
  }

  function renderPhases(phases, linkIndex) {
    if (!Array.isArray(phases) || !phases.length) return `<div style="${CODEX_STYLE.panel}"><em>No plot phases.</em></div>`;
    return [...phases].sort((a, b) => Number(a.order ?? 999) - Number(b.order ?? 999)).map((phase, index) => `<section style="${CODEX_STYLE.card}">
      <div style="display:flex;gap:.8rem;align-items:flex-start;">
        <span style="flex:0 0 2rem;height:2rem;border-radius:50%;background:#2a2a2a;color:#b9a987;display:inline-flex;align-items:center;justify-content:center;font-weight:800;">${escapeHTML(phase.order ?? index + 1)}</span>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;">
            <h3 style="margin:0;color:#342f29;font-size:1.05rem;border:0;">${escapeHTML(phase.name ?? `Phase ${index + 1}`)}</h3>
            ${phase.defaultStatus ? `<span style="padding:.12rem .4rem;border-radius:999px;background:#f0ece4;color:#655b4c;font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;">${escapeHTML(humanize(phase.defaultStatus))}</span>` : ""}
          </div>
          ${phase.summary ? `<p style="margin:.42rem 0 0;">${renderScalar(phase.summary, linkIndex)}</p>` : ""}
          ${Object.keys(phase).some((key) => !["order","name","summary","defaultStatus"].includes(key)) ? `<div style="margin-top:.45rem;">${renderObjectTableDepth(Object.fromEntries(Object.entries(phase).filter(([key]) => !["order","name","summary","defaultStatus"].includes(key))), linkIndex, 1)}</div>` : ""}
        </div>
      </div>
    </section>`).join("");
  }

  function renderEventTimeline(events, linkIndex) {
    if (!Array.isArray(events) || !events.length) return `<div style="${CODEX_STYLE.panel}"><em>No events recorded.</em></div>`;
    const watchOrder = { dawn: 0, day: 1, dusk: 2, night: 3 };
    const sorted = [...events].sort((a, b) => {
      const wa = watchOrder[String(a.watch ?? "").toLowerCase()] ?? 9;
      const wb = watchOrder[String(b.watch ?? "").toLowerCase()] ?? 9;
      return wa - wb || Number(a.sequence ?? 0) - Number(b.sequence ?? 0);
    });
    return sorted.map((event) => {
      const links = {
        targetId: event.targetId,
        locationIds: event.locationIds,
        participantIds: event.participantIds
      };
      return `<section style="${CODEX_STYLE.card}">
        <div style="display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin-bottom:.45rem;">
          <span style="padding:.16rem .46rem;border-radius:999px;background:#2a2a2a;color:#b9a987;font-size:.68rem;font-weight:800;text-transform:uppercase;">${escapeHTML(event.watch ?? "Event")}</span>
          ${event.timelineId ? `<span style="font-size:.7rem;color:#736a5d;">${escapeHTML(humanize(event.timelineId))}</span>` : ""}
          ${event.status ? `<span style="margin-left:auto;font-size:.68rem;color:#736a5d;text-transform:uppercase;">${escapeHTML(humanize(event.status))}</span>` : ""}
        </div>
        <h3 style="margin:0 0 .4rem;color:#342f29;font-size:1rem;line-height:1.3;border:0;">${escapeHTML(humanize(event.result ?? event.id ?? "Event"))}</h3>
        ${event.summary ? `<p style="margin:.2rem 0 .55rem;">${renderScalar(event.summary, linkIndex)}</p>` : ""}
        <div style="margin:.4rem 0;">${renderObjectTableDepth(Object.fromEntries(Object.entries(links).filter(([, value]) => value !== undefined && value !== null && (!Array.isArray(value) || value.length))), linkIndex, 1)}</div>
        ${Array.isArray(event.confirmedConsequences) && event.confirmedConsequences.length ? `<details style="margin:.5rem 0;"><summary style="cursor:pointer;color:#655b4c;font-weight:700;">Confirmed consequences (${event.confirmedConsequences.length})</summary>${renderNestedValue(event.confirmedConsequences, linkIndex)}</details>` : ""}
        ${Array.isArray(event.unresolvedDetails) && event.unresolvedDetails.length ? `<details style="margin:.5rem 0;"><summary style="cursor:pointer;color:#655b4c;font-weight:700;">Unresolved details (${event.unresolvedDetails.length})</summary>${renderNestedValue(event.unresolvedDetails, linkIndex)}</details>` : ""}
      </section>`;
    }).join("");
  }

  function renderSourceRefs(refs, linkIndex) {
    if (!Array.isArray(refs) || !refs.length) return `<div style="${CODEX_STYLE.panel}"><em>No source references recorded.</em></div>`;
    return refs.map((ref) => {
      const title = ref.title ?? "Source";
      const details = [ref.section, ref.printedPages ? `pp. ${ref.printedPages}` : null, ref.date, ref.sourceType]
        .filter(Boolean).map((part) => renderScalar(part, linkIndex)).join(" · ");
      return `<div style="${CODEX_STYLE.card}"><div style="display:flex;gap:.55rem;align-items:flex-start;"><i class="fas fa-book" style="margin-top:.15rem;color:#9f8f70;"></i><div><strong>${escapeHTML(title)}</strong>${details ? `<div style="margin-top:.18rem;font-size:.76rem;color:#6e665b;">${details}</div>` : ""}${ref.eventId ? `<div style="margin-top:.18rem;font-size:.72rem;"><code>${escapeHTML(ref.eventId)}</code></div>` : ""}</div></div></div>`;
    }).join("");
  }

  function renderRelationships(relationships, linkIndex) {
    const entries = Object.entries(relationships ?? {});
    if (!entries.length) return `<div style="${CODEX_STYLE.panel}"><em>No recorded relationships.</em></div>`;
    return `<div style="${CODEX_STYLE.panel}"><table style="${CODEX_STYLE.table}"><thead><tr><th style="${CODEX_STYLE.th}">Entity</th><th style="${CODEX_STYLE.th}">Value</th></tr></thead><tbody>${entries.map(([id, value]) => `<tr><td style="${CODEX_STYLE.td}">${documentLink(id, linkIndex)}</td><td style="${CODEX_STYLE.td}">${renderNestedValue(value, linkIndex)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function recordImage(record) {
    for (const key of ["image", "img", "portrait", "portraitPath", "tokenImage", "imagePath"]) {
      const src = safeImageSource(record?.[key]);
      if (src) return src;
    }
    return "";
  }

  function connectionFields(record) {
    const blocked = new Set(["id", "sourceInputId", "sourceEventIds", "sourceRefs", "imagePath"]);
    return Object.entries(record ?? {}).filter(([key, value]) => {
      if (blocked.has(key)) return false;
      if (!/(Id|Ids)$/.test(key)) return false;
      if (value === null || value === undefined) return false;
      if (Array.isArray(value) && !value.length) return false;
      return true;
    });
  }

  function renderConnections(record, linkIndex) {
    const fields = connectionFields(record);
    const relationshipHTML = record.relationships && Object.keys(record.relationships).length ? renderRelationships(record.relationships, linkIndex) : "";
    if (!fields.length && !relationshipHTML) return `<div style="${CODEX_STYLE.panel}"><em>No linked records.</em></div>`;
    const rows = fields.map(([key, value]) => `<tr><th style="${CODEX_STYLE.th}">${escapeHTML(humanize(key))}</th><td style="${CODEX_STYLE.td}">${renderNestedValue(value, linkIndex)}</td></tr>`).join("");
    return `${rows ? `<div style="${CODEX_STYLE.panel}"><table style="${CODEX_STYLE.table}">${rows}</table></div>` : ""}${relationshipHTML}`;
  }

  function makeRecordSections(record, sourceMeta, linkIndex) {
    const type = String(record.type ?? sourceMeta.type ?? "other").toLowerCase();
    const consumed = new Set([
      "id", "type", "schemaVersion", "revision", "createdAt", "updatedAt", "updatedBy", "name",
      "sourceFormat", "tags", "image", "img", "portrait", "portraitPath", "tokenImage", "imagePath"
    ]);
    const sections = [];
    const add = (key, label, icon, content, stat = null) => {
      if (!content) return;
      sections.push({ key, label, icon, content, stat });
    };
    const take = (keys) => {
      const obj = {};
      for (const key of keys) {
        if (record[key] !== undefined) {
          obj[key] = record[key];
          consumed.add(key);
        }
      }
      return obj;
    };
    const nonEmptyObject = (obj) => Object.values(obj).some((value) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length));
    const profileKeys = [
      "actorType", "factionType", "role", "titles", "aliases", "status", "canonStatus", "alignment", "ancestry", "gender",
      "presenceStatus", "region", "terrain", "control", "population", "danger", "day", "watch", "season", "originId", "destinationId",
      "directional", "baseTravelTurns", "waterCostPerTurn", "locationId", "factionId", "routeId", "currentArea", "mapSiteId"
    ];
    const narrativeKeys = ["summary", "description", "currentSituation", "activityNote", "timePrecision"];
    const profile = take(profileKeys);
    const narrativeParts = [];
    for (const key of narrativeKeys) {
      if (record[key] !== undefined) {
        consumed.add(key);
        narrativeParts.push(`<div style="margin:0 0 .7rem;">${key === "summary" || key === "description" ? "" : `<div style=\"font-size:.68rem;font-weight:800;color:#7b705e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem;\">${escapeHTML(humanize(key))}</div>`}${renderNarrative(record[key], linkIndex)}</div>`);
      }
    }
    const overview = `${narrativeParts.join("")}${nonEmptyObject(profile) ? renderObjectTable(profile, linkIndex) : ""}` || `<div style="${CODEX_STYLE.panel}"><em>No overview text recorded.</em></div>`;
    add("overview", "Overview", visualFor(type).icon, overview);

    const conn = connectionFields(record);
    if (conn.length || (record.relationships && Object.keys(record.relationships).length)) {
      conn.forEach(([key]) => consumed.add(key));
      consumed.add("relationships");
    }

    if (Array.isArray(record.goals) && record.goals.length) {
      consumed.add("goals");
      add("goals", "Goals", "fas fa-bullseye", renderGoals(record.goals, linkIndex), record.goals.length);
    }
    if (Array.isArray(record.phases) && record.phases.length) {
      consumed.add("phases");
      add("phases", "Phases", "fas fa-stream", renderPhases(record.phases, linkIndex), record.phases.length);
    }
    if (Array.isArray(record.events) && record.events.length) {
      consumed.add("events");
      add("events", "Timeline", "fas fa-calendar-alt", renderEventTimeline(record.events, linkIndex), record.events.length);
    }
    if (conn.length || (record.relationships && Object.keys(record.relationships).length)) {
      add("connections", type === "route" ? "Connections" : "Linked Records", "fas fa-link", renderConnections(record, linkIndex), conn.length || null);
    }

    const typeGroups = {
      actor: [
        ["capabilities", "Traits & Resources", "fas fa-shield-alt", ["stats", "traits", "resources", "needs", "equipment", "psionicStatus", "currentAction", "cooldowns", "simulation"]],
        ["knowledge", "Knowledge & Hooks", "fas fa-lightbulb", ["knowledge", "potentialHooks", "unresolvedDetails"]]
      ],
      faction: [
        ["operations", "Assets & Operations", "fas fa-cubes", ["resources", "assets", "operations", "territory", "holdings", "forces", "trade", "plans", "unresolvedDetails"]]
      ],
      location: [
        ["features", "Features & Threats", "fas fa-map", ["features", "areas", "sites", "hazards", "threats", "encounters", "rumors", "secrets", "unresolvedDetails"]]
      ],
      route: [
        ["travel", "Travel & Conditions", "fas fa-route", ["distance", "distanceMiles", "travel", "travelTime", "terrain", "conditions", "hazards", "encounters", "notes", "unresolvedDetails"]]
      ],
      plot: [
        ["foundations", "Foundations & Hooks", "fas fa-project-diagram", ["confirmedFoundations", "workingAssumptions", "activationHooks", "possibleZarronOffers"]],
        ["gm-attention", "GM Attention", "fas fa-eye", ["gmAttentionRequired", "unresolvedDetails"]]
      ],
      artifact: [
        ["properties", "Properties & History", "fas fa-gem", ["properties", "effects", "powers", "history", "origin", "currentState", "unresolvedDetails"]]
      ],
      market: [
        ["trade", "Inventory & Trade", "fas fa-store", ["inventory", "goods", "prices", "supply", "demand", "services", "trade", "unresolvedDetails"]]
      ],
      report: [
        ["report", "Report", "fas fa-file-alt", ["findings", "analysis", "conclusions", "recommendations", "observations", "results", "body", "content", "unresolvedDetails"]]
      ],
      action: [
        ["action", "Action", "fas fa-bolt", ["requirements", "procedure", "effects", "outcomes", "cost", "duration", "risks", "unresolvedDetails"]]
      ],
      history: [
        ["history", "Historical Record", "fas fa-history", ["events", "decision", "ruling", "consequences", "changes", "unresolvedDetails"]]
      ],
      "historical-event": [
        ["history", "Historical Record", "fas fa-history", ["events", "decision", "ruling", "consequences", "changes", "unresolvedDetails"]]
      ],
      "gm-ruling": [
        ["ruling", "GM Ruling", "fas fa-gavel", ["ruling", "decision", "reason", "consequences", "changes", "unresolvedDetails"]]
      ],
      "event-bundle": [
        ["event-details", "Event Metadata", "fas fa-info-circle", ["sourceInputId", "mutationDisposition", "mutationReason", "unresolvedDetails"]]
      ]
    };
    for (const [key, label, icon, keys] of typeGroups[type] ?? []) {
      const obj = take(keys);
      if (nonEmptyObject(obj)) add(key, label, icon, renderObjectTable(obj, linkIndex));
    }

    const clocks = record.clocks ?? record.localClocks;
    if (clocks && Object.keys(clocks).length) {
      consumed.add(record.clocks ? "clocks" : "localClocks");
      add("clocks", "Clocks", "fas fa-clock", renderClocks(clocks, linkIndex), Object.keys(clocks).length);
    }

    const sourceBits = [];
    if (Array.isArray(record.sourceRefs) && record.sourceRefs.length) {
      consumed.add("sourceRefs");
      sourceBits.push(renderSourceRefs(record.sourceRefs, linkIndex));
    }
    if (Array.isArray(record.sourceEventIds) && record.sourceEventIds.length) {
      consumed.add("sourceEventIds");
      sourceBits.push(`<div style="${CODEX_STYLE.panel}"><div style="font-size:.68rem;font-weight:800;color:#7b705e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35rem;">Source Event IDs</div>${renderNestedValue(record.sourceEventIds, linkIndex)}</div>`);
    }
    if (sourceBits.length) add("sources", "Sources", "fas fa-book", sourceBits.join(""), (record.sourceRefs?.length ?? 0) + (record.sourceEventIds?.length ?? 0));

    const remaining = Object.entries(record)
      .filter(([key]) => !consumed.has(key))
      .filter(([, value]) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length))
      .sort(([a], [b]) => a.localeCompare(b));
    if (remaining.length) add("details", "Additional Details", "fas fa-list", renderObjectTable(Object.fromEntries(remaining), linkIndex), remaining.length);
    return sections;
  }

  function renderEntityOverview(record, sourceMeta, linkIndex) {
    const sourcePath = sourceMeta.path;
    const type = record.type ?? sourceMeta.type ?? "other";
    const typeLabel = visualFor(type).label;
    const subtitle = `<strong>${escapeHTML(typeLabel)}</strong><br><code style="color:#cfc8bb;">${escapeHTML(record.id ?? sourceMeta.id)}</code><br><span style="color:#9e998f;">Revision ${escapeHTML(record.revision ?? sourceMeta.revision ?? "—")}</span>`;
    const tags = [type, record.status, record.canonStatus, ...(Array.isArray(record.tags) ? record.tags : [])];
    const footer = `Imported from <code>${escapeHTML(sourcePath)}</code> at ${escapeHTML(formatDate(new Date().toISOString()))}. Last source update: ${escapeHTML(formatDate(record.updatedAt))}. Campaign Codex is not required.`;
    return renderCodexShell({
      title: record.name ?? sourceMeta.id,
      type,
      subtitle,
      tags,
      sections: makeRecordSections(record, sourceMeta, linkIndex),
      image: recordImage(record),
      footer,
      sourceId: record.id ?? sourceMeta.id
    });
  }

  function renderRawJSON(record) {
    const content = `<div style="${CODEX_STYLE.panel}">
      <p style="margin-top:0;">This ordinary JournalEntryPage mirrors the authoritative JSON source and is replaced when the importer updates this entry.</p>
      <details><summary style="cursor:pointer;font-weight:700;color:#665b49;">Show complete JSON</summary>
      <pre style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:.65rem;padding:.8rem;border-radius:.45rem;background:#302936;color:#f2ece2;"><code>${escapeHTML(JSON.stringify(record, null, 2))}</code></pre></details>
    </div>`;
    return renderCodexShell({
      title: record.name ?? "Raw Source Data",
      type: "source",
      subtitle: `Raw JSON<br><code style="color:#cfc8bb;">${escapeHTML(record.id ?? "record")}</code>`,
      tags: [record.type, "raw-source"],
      sections: [{ key: "raw-source", label: "Raw Source", icon: "fas fa-code", content }],
      sourceId: record.id ?? ""
    });
  }

  function renderMarkdownSource(title, text, sourcePath) {
    const content = `<div style="${CODEX_STYLE.panel}"><p>Imported from <code>${escapeHTML(sourcePath)}</code>.</p>
      <pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:.8rem;border-radius:.45rem;background:#302936;color:#f2ece2;">${escapeHTML(text)}</pre></div>`;
    return renderCodexShell({
      title,
      type: "repository",
      subtitle: `<code style="color:#cfc8bb;">${escapeHTML(sourcePath)}</code>`,
      tags: ["repository", "journal-page"],
      sections: [{ key: "document", label: "Document", icon: "fas fa-file-alt", content }],
      sourceId: sourcePath
    });
  }

  function renderTextRecordOverview(record, sourceMeta, sourceText) {
    const type = record.type ?? sourceMeta.type ?? "other";
    const content = `<div style="${CODEX_STYLE.panel}"><p><strong>Source:</strong> <code>${escapeHTML(sourceMeta.path)}</code></p>
      <pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:.85rem;border-radius:.45rem;background:#ffffff;color:#2a2a2a;border:1px solid #e2ddd3;">${escapeHTML(sourceText)}</pre></div>`;
    return renderCodexShell({
      title: record.name ?? sourceMeta.id,
      type,
      subtitle: `<code style="color:#cfc8bb;">${escapeHTML(record.id ?? sourceMeta.id)}</code>`,
      tags: [type, record.sourceFormat ?? fileExtension(sourceMeta.path)],
      sections: [{ key: "overview", label: "Overview", icon: visualFor(type).icon, content }],
      footer: `Imported from <code>${escapeHTML(sourceMeta.path)}</code> at ${escapeHTML(formatDate(new Date().toISOString()))}.`,
      sourceId: record.id ?? sourceMeta.id
    });
  }

  function renderRawSource(record, sourceMeta, sourceText) {
    if (fileExtension(sourceMeta.path) === "json") return renderRawJSON(record);
    return renderMarkdownSource("Raw Source", sourceText, sourceMeta.path);
  }

  function makePage(name, role, content, sort) {
    return {
      name,
      type: "text",
      text: {
        content,
        format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1
      },
      sort,
      flags: makeFlag({ pageRole: role, importerVersion: IMPORTER_VERSION })
    };
  }

  async function upsertImportedPage(journal, data) {
    const role = data.flags?.[FLAG_SCOPE]?.[FLAG_KEY]?.pageRole;
    const existing = journal.pages.find((page) => readFlag(page)?.pageRole === role)
      ?? journal.pages.find((page) => page.name === data.name && readFlag(page)?.importerVersion);
    if (existing) {
      await journal.updateEmbeddedDocuments("JournalEntryPage", [{ _id: existing.id, ...data }]);
      return journal.pages.get(existing.id) ?? existing;
    }
    const created = await journal.createEmbeddedDocuments("JournalEntryPage", [data]);
    return created[0];
  }

  async function ensureNotesPage(journal) {
    const existing = journal.pages.find((page) => readFlag(page)?.pageRole === "gm-notes")
      ?? journal.pages.find((page) => page.name === "GM Notes");
    if (existing) return;
    await journal.createEmbeddedDocuments("JournalEntryPage", [makePage(
      "GM Notes",
      "gm-notes",
      renderCodexShell({
        title: journal.name ?? "GM Notes",
        type: "notes",
        subtitle: "Private notes preserved across imports",
        tags: ["gm-only", "manual"],
        sections: [{ key: "notes", label: "GM Notes", icon: "fas fa-sticky-note", content: `<div style="${CODEX_STYLE.panel}"><p><em>This page is never overwritten by the GitHub importer.</em></p></div>` }],
        sourceId: readFlag(journal)?.sourceId ?? ""
      }),
      9000
    )]);
  }

  function buildCampaignOverview(manifest, worldState, linkIndex, importStats) {
    const grouped = new Map();
    for (const [sourceId, target] of linkIndex.entries()) {
      if (sourceId === "__campaign__") continue;
      const category = categoryKey(target.sourceType ?? "other", target.sourcePath ?? "");
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push({ sourceId, ...target });
    }
    const categoryBlocks = [...grouped.entries()]
      .sort(([a], [b]) => (categoryConfig[a]?.order ?? 999) - (categoryConfig[b]?.order ?? 999))
      .map(([category, entries]) => `<div style="${CODEX_STYLE.card}">
        <h3 style="margin:0 0 .45rem;color:#3a342d;border:0;font-size:.95rem;text-transform:uppercase;letter-spacing:.06em;">${escapeHTML(categoryConfig[category]?.name ?? humanize(category))}</h3>
        <div style="columns:2;column-gap:1.6rem;">${entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => `<div style="break-inside:avoid;margin:.22rem 0;">${documentLink(entry.sourceId, linkIndex, entry.name)}</div>`).join("")}</div>
      </div>`).join("");
    const summaryRows = {
      repository: `${settings.owner}/${settings.repo}`,
      ref: settings.ref,
      importer: IMPORTER_VERSION,
      importedElements: importStats.success,
      skippedFailed: importStats.failed,
      importedAt: formatDate(new Date().toISOString())
    };
    const campaignInfo = `<div style="${CODEX_STYLE.panel}">
      <p><strong>Campaign:</strong> ${escapeHTML(manifest.campaignId ?? "—")}</p>
      <p><strong>Current date:</strong> ${escapeHTML(worldState.calendar?.display ?? `Day ${worldState.day ?? "—"}`)}</p>
      <p><strong>Watch:</strong> ${escapeHTML(worldState.watch ?? "—")} · <strong>Season:</strong> ${escapeHTML(worldState.season ?? "—")}</p>
      <p><strong>Simulation:</strong> ${worldState.simulation?.paused ? "Paused" : "Active"} · Detail ${escapeHTML(worldState.simulation?.detailLevel ?? "—")}</p>
    </div>`;
    return renderCodexShell({
      title: manifest.name ?? "Darkest Sun Sandbox",
      type: "campaign",
      subtitle: "MK-Sandbox campaign journal<br>Campaign Codex-style presentation",
      tags: [worldState.watch, worldState.season, worldState.simulation?.paused ? "paused" : "active"],
      sections: [
        { key: "overview", label: "Overview", icon: "fas fa-book-open", content: campaignInfo },
        { key: "import-summary", label: "Import Summary", icon: "fas fa-download", content: renderObjectTable(summaryRows, new Map()) },
        { key: "journal-index", label: "Journal Index", icon: "fas fa-sitemap", content: categoryBlocks, stat: linkIndex.size - 1 }
      ],
      footer: "All imported records are ordinary Foundry JournalEntries. No Campaign Codex module, flags, or sheet class is required.",
      sourceId: manifest.campaignId ?? "__campaign__"
    });
  }

  function campaignRawPage(manifest, worldState) {
    const manifestHTML = `<div style="${CODEX_STYLE.panel}"><details><summary style="cursor:pointer;font-weight:700;color:#665b49;">Show manifest.json</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#302936;color:#f2ece2;padding:.75rem;border-radius:.45rem;"><code>${escapeHTML(JSON.stringify(manifest, null, 2))}</code></pre></details></div>`;
    const worldHTML = `<div style="${CODEX_STYLE.panel}"><details open><summary style="cursor:pointer;font-weight:700;color:#665b49;">Show world-state.json</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#302936;color:#f2ece2;padding:.75rem;border-radius:.45rem;"><code>${escapeHTML(JSON.stringify(worldState, null, 2))}</code></pre></details></div>`;
    return renderCodexShell({
      title: "Campaign Sources",
      type: "source",
      subtitle: "Manifest and world-state records",
      tags: ["manifest", "world-state"],
      sections: [
        { key: "manifest", label: "Manifest", icon: "fas fa-list", content: manifestHTML },
        { key: "world-state", label: "World State", icon: "fas fa-globe", content: worldHTML }
      ],
      sourceId: manifest.campaignId ?? "__campaign__"
    });
  }

  ui.notifications.info("MK Sandbox import started. Reading GitHub manifest…");
  progress.update(5, "Reading repository index", "manifest.json and world-state.json");

  let manifest;
  let worldState;
  let readmeText = "";
  let agentsText = "";
  try {
    const [manifestText, worldStateText, readmeResult, agentsResult] = await Promise.all([
      githubFile("manifest.json"),
      githubFile("world-state.json"),
      githubFile("README.md").catch((error) => `README import failed: ${error.message}`),
      githubFile("AGENTS.md").catch((error) => `AGENTS import failed: ${error.message}`)
    ]);
    manifest = JSON.parse(manifestText);
    worldState = JSON.parse(worldStateText);
    readmeText = readmeResult;
    agentsText = agentsResult;
    progress.update(12, "Repository index loaded", manifest.name ?? manifest.campaignId ?? "MK Sandbox");
  } catch (error) {
    console.error("MK Sandbox importer:", error);
    progress.fail(error.message);
    ui.notifications.error(`MK Sandbox import stopped: ${error.message}`);
    return;
  }

  const failures = [];
  const manifestElements = Object.entries(manifest.elements ?? {}).map(([id, meta]) => ({
    id,
    ...meta,
    indexed: true,
    discovered: false
  }));

  progress.update(13, "Discovering supplemental records", "Scanning reports, events, artifacts, and plots");
  const discoveredElements = [];
  const discoveryTargets = [
    { type: "event", path: manifest.directories?.events ?? "events/" },
    { type: "report", path: manifest.directories?.reports ?? "reports/" },
    { type: "artifact", path: manifest.directories?.artifacts ?? "artifacts/" },
    { type: "plot", path: manifest.directories?.plots ?? "plots/" }
  ];

  for (const target of discoveryTargets) {
    try {
      const found = await discoverDirectoryFiles(target.path, target.type);
      discoveredElements.push(...found);
      progress.update(16, "Discovering supplemental records", `${humanize(target.type)}: ${found.length} file(s)`);
    } catch (error) {
      failures.push({
        id: `${target.type}-directory`,
        path: target.path,
        message: `Could not scan ${target.path}: ${error.message}`
      });
      console.error(`MK Sandbox importer failed to scan ${target.path}:`, error);
    }
  }

  const indexedPaths = new Set(manifestElements.map((meta) => meta.path));
  const sourceElements = [
    ...manifestElements,
    ...discoveredElements.filter((meta) => !indexedPaths.has(meta.path))
  ];

  if (!sourceElements.length) {
    progress.fail("The repository contains no importable source records.");
    ui.notifications.warn("The MK Sandbox repository contains no importable source records.");
    return;
  }

  ui.notifications.info(`Downloading ${sourceElements.length} sandbox source records…`);
  progress.update(18, "Downloading source records", `0 / ${sourceElements.length}`);

  let downloadedCount = 0;
  const loaded = await mapLimit(sourceElements, GITHUB_REQUEST_CONCURRENCY, async (meta) => {
    try {
      const text = await githubFile(meta.path);
      const extension = fileExtension(meta.path);
      let record;

      if (extension === "json") {
        record = JSON.parse(text);
        const sourceId = record.id ?? meta.id ?? stableIdFromPath(meta.type ?? "other", meta.path);
        if (meta.indexed && record.id && record.id !== meta.id) {
          throw new Error(`Manifest ID ${meta.id} does not match source record ID ${record.id}.`);
        }
        meta.id = sourceId;
        record.id = sourceId;
        if (!record.type) record.type = meta.type;
      } else {
        meta.id = meta.id ?? stableIdFromPath(meta.type ?? "other", meta.path);
        record = {
          id: meta.id,
          type: meta.type ?? "other",
          name: documentTitleFromText(text, meta.path),
          sourceFormat: extension || "text"
        };
      }

      return { meta, record, text };
    } catch (error) {
      failures.push({ id: meta.id ?? meta.path, path: meta.path, message: error.message });
      console.error(`MK Sandbox importer failed to load ${meta.path}:`, error);
      return null;
    } finally {
      downloadedCount += 1;
      const downloadPercent = 18 + Math.round((downloadedCount / sourceElements.length) * 34);
      progress.update(downloadPercent, "Downloading source records", `${downloadedCount} / ${sourceElements.length}`);
    }
  });

  const records = [];
  const seenSourceIds = new Map();
  for (const item of loaded.filter(Boolean)) {
    const sourceId = item.record.id ?? item.meta.id;
    const previousPath = seenSourceIds.get(sourceId);
    if (previousPath) {
      failures.push({
        id: sourceId,
        path: item.meta.path,
        message: `Duplicate source ID; already imported from ${previousPath}.`
      });
      continue;
    }
    seenSourceIds.set(sourceId, item.meta.path);
    records.push(item);
  }

  progress.update(53, "Creating journal folders", `${records.length} records ready`);

  let rootFolder;
  const folders = new Map();
  try {
    rootFolder = await ensureFolder({
      name: settings.rootFolder,
      key: "root",
      sort: 0
    });

    for (const [key, config] of Object.entries(categoryConfig)) {
      const folder = await ensureFolder({
        name: config.name,
        key: `category:${key}`,
        parent: rootFolder,
        sort: config.order
      });
      folders.set(key, folder);
    }
  } catch (error) {
    console.error("MK Sandbox importer folder creation failed:", error);
    progress.fail(error.message);
    ui.notifications.error(`Could not create journal folders: ${error.message}`);
    return;
  }

  progress.update(58, "Journal folders ready", `${folders.size} category folders`);

  const linkIndex = new Map();
  const sourceJournalMap = new Map();
  const existingBySourceId = new Map();

  for (const journal of game.journal) {
    const flag = readFlag(journal);
    if (flag?.sourceId) existingBySourceId.set(flag.sourceId, journal);
  }

  const campaignSourceId = "__campaign__";
  let campaignJournal = existingBySourceId.get(campaignSourceId);
  const campaignFolder = folders.get("campaign");
  const ownership = getOwnership(settings.visibility);

  if (!campaignJournal) {
    campaignJournal = await journalClass.create({
      name: manifest.name ?? "Darkest Sun Sandbox",
      folder: campaignFolder.id,
      ownership,
      flags: makeJournalFlags({
        importerVersion: IMPORTER_VERSION,
        sourceId: campaignSourceId,
        sourceType: "campaign",
        sourcePath: "manifest.json",
        repository: `${settings.owner}/${settings.repo}`,
        ref: settings.ref
      })
    });
  } else if (settings.updateExisting) {
    await campaignJournal.update({
      name: manifest.name ?? campaignJournal.name,
      folder: campaignFolder.id,
      ownership,
      flags: makeJournalFlags({
        importerVersion: IMPORTER_VERSION,
        sourceId: campaignSourceId,
        sourceType: "campaign",
        sourcePath: "manifest.json",
        repository: `${settings.owner}/${settings.repo}`,
        ref: settings.ref
      })
    });
  }

  try {
    if (campaignJournal.getFlag?.("core", "sheetClass") !== SHEET_CLASS_KEY) {
      await campaignJournal.setFlag?.("core", "sheetClass", SHEET_CLASS_KEY);
    }
  } catch (_error) {}

  sourceJournalMap.set(campaignSourceId, campaignJournal);
  linkIndex.set(campaignSourceId, {
    uuid: campaignJournal.uuid,
    name: campaignJournal.name,
    sourceType: "campaign",
    sourcePath: "manifest.json"
  });

  const createQueue = [];
  let journalRecordIndex = 0;
  for (const { meta, record } of records) {
    journalRecordIndex += 1;
    progress.update(
      58 + Math.round((journalRecordIndex / Math.max(records.length, 1)) * 10),
      "Preparing journal entries",
      `${journalRecordIndex} / ${records.length}`
    );
    const sourceId = record.id ?? meta.id;
    const type = record.type ?? meta.type ?? "other";
    const folder = folders.get(categoryKey(type, meta.path));
    const existing = existingBySourceId.get(sourceId);

    if (existing) {
      sourceJournalMap.set(sourceId, existing);
      if (!settings.updateExisting) {
        try {
          if (existing.getFlag?.("core", "sheetClass") !== SHEET_CLASS_KEY) {
            await existing.setFlag?.("core", "sheetClass", SHEET_CLASS_KEY);
          }
        } catch (_error) {}
      }
      if (settings.updateExisting) {
        await existing.update({
          name: entityDisplayName(record, sourceId),
          folder: folder.id,
          ownership,
          flags: makeJournalFlags({
            importerVersion: IMPORTER_VERSION,
            sourceId,
            sourceType: type,
            sourcePath: meta.path,
            repository: `${settings.owner}/${settings.repo}`,
            ref: settings.ref,
            revision: record.revision ?? meta.revision ?? null,
            sourceUpdatedAt: record.updatedAt ?? null
          })
        });
      }
      continue;
    }

    createQueue.push({
      sourceId,
      type,
      meta,
      record,
      data: {
        name: entityDisplayName(record, sourceId),
        folder: folder.id,
        ownership,
        flags: makeJournalFlags({
          importerVersion: IMPORTER_VERSION,
          sourceId,
          sourceType: type,
          sourcePath: meta.path,
          repository: `${settings.owner}/${settings.repo}`,
          ref: settings.ref,
          revision: record.revision ?? meta.revision ?? null,
          sourceUpdatedAt: record.updatedAt ?? null
        })
      }
    });
  }

  if (createQueue.length) {
    const created = await journalClass.createDocuments(createQueue.map((item) => item.data));

    // Foundry does not guarantee that bulk-created documents are returned in
    // the same order as the input array. Bind each journal using its own stable
    // sourceId flag instead of matching by array index.
    for (const journal of created) {
      const sourceId = readFlag(journal)?.sourceId;
      if (!sourceId) {
        failures.push({
          id: journal.id ?? "unknown-journal",
          path: "Foundry JournalEntry",
          message: "Created journal has no MK Sandbox sourceId flag and could not be linked."
        });
        continue;
      }
      sourceJournalMap.set(sourceId, journal);
    }

    // Re-read the world collection as a safety net for Foundry versions or
    // hooks that replace/reorder returned document instances.
    for (const item of createQueue) {
      if (sourceJournalMap.has(item.sourceId)) continue;
      const recovered = game.journal.find((journal) => readFlag(journal)?.sourceId === item.sourceId);
      if (recovered) sourceJournalMap.set(item.sourceId, recovered);
      else failures.push({
        id: item.sourceId,
        path: item.meta.path,
        message: "Created journal could not be recovered by its stable sourceId."
      });
    }
  }

  progress.update(69, "Linking journals", `${sourceJournalMap.size} journal entries`);

  function resolveBoundJournal(sourceId) {
    const mapped = sourceJournalMap.get(sourceId);
    if (mapped && readFlag(mapped)?.sourceId === sourceId) return mapped;

    const recovered = game.journal.find((journal) => readFlag(journal)?.sourceId === sourceId);
    if (recovered) {
      sourceJournalMap.set(sourceId, recovered);
      return recovered;
    }
    return null;
  }

  for (const { meta, record } of records) {
    const sourceId = record.id ?? meta.id;
    const journal = resolveBoundJournal(sourceId);
    if (!journal) {
      failures.push({ id: sourceId, path: meta.path, message: "No correctly bound Foundry journal was found for this source record." });
      continue;
    }
    linkIndex.set(sourceId, {
      uuid: journal.uuid,
      name: journal.name,
      sourceType: record.type ?? meta.type ?? "other",
      sourcePath: meta.path
    });
  }

  ui.notifications.info("Creating and linking journal pages…");
  progress.update(70, "Writing journal pages", `0 / ${records.length}`);

  let pageRecordIndex = 0;
  for (const { meta, record, text: sourceText } of records) {
    pageRecordIndex += 1;
    progress.update(
      70 + Math.round((pageRecordIndex / Math.max(records.length, 1)) * 24),
      "Writing journal pages",
      `${pageRecordIndex} / ${records.length}`
    );
    const sourceId = record.id ?? meta.id;
    const journal = resolveBoundJournal(sourceId);
    if (!journal) {
      failures.push({ id: sourceId, path: meta.path, message: "Page update skipped because the journal/sourceId binding could not be verified." });
      continue;
    }
    if (!settings.updateExisting && existingBySourceId.has(sourceId)) continue;

    try {
      await upsertImportedPage(journal, makePage(
        "Overview",
        "overview",
        fileExtension(meta.path) === "json"
          ? renderEntityOverview(record, meta, linkIndex)
          : renderTextRecordOverview(record, meta, sourceText),
        0
      ));
      await upsertImportedPage(journal, makePage(
        "Raw Source",
        "raw-source",
        renderRawSource(record, meta, sourceText),
        1000
      ));
      await ensureNotesPage(journal);
    } catch (error) {
      failures.push({ id: sourceId, path: meta.path, message: `Journal page update failed: ${error.message}` });
      console.error(`MK Sandbox importer failed to update journal ${sourceId}:`, error);
    }
  }

  const importStats = {
    success: records.length - failures.filter((failure) => failure.message.startsWith("Journal page update failed")).length,
    failed: failures.length
  };

  progress.update(95, "Updating campaign journal", "Overview, source records, and import report");

  if (settings.updateExisting || !existingBySourceId.has(campaignSourceId)) {
    await upsertImportedPage(campaignJournal, makePage(
      "Campaign Overview",
      "campaign-overview",
      buildCampaignOverview(manifest, worldState, linkIndex, importStats),
      0
    ));
    await upsertImportedPage(campaignJournal, makePage(
      "Manifest & World State",
      "campaign-raw",
      campaignRawPage(manifest, worldState),
      1000
    ));
    await upsertImportedPage(campaignJournal, makePage(
      "Repository README",
      "repository-readme",
      renderMarkdownSource("Repository README", readmeText, "README.md"),
      2000
    ));
    await upsertImportedPage(campaignJournal, makePage(
      "Sandbox Instructions",
      "sandbox-instructions",
      renderMarkdownSource("Sandbox Instructions", agentsText, "AGENTS.md"),
      3000
    ));
    if (failures.length) {
      await upsertImportedPage(campaignJournal, makePage(
        "Import Problems",
        "import-problems",
        codexPage({
          eyebrow: "Darkest Sun · Import Report",
          title: "Import Problems",
          subtitle: `${failures.length} record(s) require attention`,
          tags: ["warning", "import"],
          body: `<div style="${CODEX_STYLE.panel}"><table style="${CODEX_STYLE.table}"><thead><tr><th style="${CODEX_STYLE.th}">ID</th><th style="${CODEX_STYLE.th}">Path</th><th style="${CODEX_STYLE.th}">Problem</th></tr></thead><tbody>${failures.map((failure) => `
            <tr><td style="${CODEX_STYLE.td}"><code>${escapeHTML(failure.id)}</code></td><td style="${CODEX_STYLE.td}"><code>${escapeHTML(failure.path)}</code></td><td style="${CODEX_STYLE.td}">${escapeHTML(failure.message)}</td></tr>`).join("")}</tbody></table></div>`
        }),
        8000
      ));
    }
    await ensureNotesPage(campaignJournal);
  }

  const message = failures.length
    ? `MK Sandbox import finished with ${failures.length} problem(s). See the Campaign journal's Import Problems page.`
    : `MK Sandbox import complete: ${records.length} source records created or updated, including artifacts, plots, reports, and events, using the MK Sandbox Journal sheet.`;

  progress.complete(message, failures.length > 0);

  if (failures.length) ui.notifications.warn(message);
  else ui.notifications.info(message);

  // Opening the journal is best-effort and must never turn a successful
  // import into a failure.
  try {
    await campaignJournal?.render(true);
  } catch (renderError) {
    console.warn("MK Sandbox import completed, but the Campaign journal could not be opened automatically:", renderError);
  }
  } catch (error) {
    console.error("MK Sandbox importer failed unexpectedly:", error);
    progress.fail(error?.message ?? String(error));
    ui.notifications.error(`MK Sandbox import failed: ${error?.message ?? String(error)}`);
  }
}
