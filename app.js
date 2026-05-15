const DEFAULT_SETTINGS = {
  marginX: 48,
  marginY: 36,
  baseFontSize: 13,
  headingFontSize: 15,
  nameFontSize: 21,
  lineHeight: 1.48,
  paragraphGap: 3,
  normalTextDepth: 28,
  fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif',
};

const STORAGE_KEYS = {
  settings: "resume-template-settings",
};

let isLoadingMarkdown = false;
let markdownFileHandle = null;
let lastKnownFileModified = 0;
let pendingSaveTimer = null;
let hasPendingLocalSave = false;
let isWritingMarkdown = false;

const els = {
  preview: document.querySelector("#resumePreview"),
  markdown: document.querySelector("#markdownInput"),
  printBtn: document.querySelector("#printBtn"),
  openMdBtn: document.querySelector("#openMdBtn"),
  fileStatus: document.querySelector("#fileStatus"),
  marginX: document.querySelector("#marginX"),
  marginY: document.querySelector("#marginY"),
  baseFontSize: document.querySelector("#baseFontSize"),
  headingFontSize: document.querySelector("#headingFontSize"),
  nameFontSize: document.querySelector("#nameFontSize"),
  lineHeight: document.querySelector("#lineHeight"),
  paragraphGap: document.querySelector("#paragraphGap"),
  normalTextDepth: document.querySelector("#normalTextDepth"),
  fontFamily: document.querySelector("#fontFamily"),
};

const outputs = {
  marginX: document.querySelector("#marginXValue"),
  marginY: document.querySelector("#marginYValue"),
  baseFontSize: document.querySelector("#baseFontSizeValue"),
  headingFontSize: document.querySelector("#headingFontSizeValue"),
  nameFontSize: document.querySelector("#nameFontSizeValue"),
  lineHeight: document.querySelector("#lineHeightValue"),
  paragraphGap: document.querySelector("#paragraphGapValue"),
  normalTextDepth: document.querySelector("#normalTextDepthValue"),
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(text) {
  const placeholders = [];
  let safe = escapeHtml(text);

  safe = safe.replace(/`([^`]+)`/g, (_, label) => {
    const token = `@@TAG_${placeholders.length}@@`;
    placeholders.push(`<span class="tag">${label}</span>`);
    return token;
  });

  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  placeholders.forEach((html, index) => {
    safe = safe.replace(`@@TAG_${index}@@`, html);
  });

  return safe;
}

function parseAvatarLine(line) {
  const match = line.trim().match(/^!\[[^\]]*\]\(([^)]+)\)$/);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

function stripOuterBold(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^\*\*(.*)\*\*$/);
  return match ? match[1].trim() : trimmed;
}

function splitTrailingDate(text) {
  const cleaned = stripOuterBold(text);
  const dateToken = "(?:\\d{4}[.-]\\d{2}|至今|现在|Present|present)";
  const rangeToken = `${dateToken}\\s*(?:-|~|至)\\s*${dateToken}`;
  const datePattern = new RegExp(`\\s*((?:[（(]\\s*)?${rangeToken}(?:\\s*[）)])?)\\s*$`);
  const match = cleaned.match(datePattern);

  if (!match) {
    return null;
  }

  return {
    main: cleaned.slice(0, match.index).trim(),
    date: match[1].trim(),
  };
}

function isStrongOnlyLine(line) {
  return /^\*\*.+\*\*$/.test(line.trim());
}

function renderDatedLine(line) {
  const parts = splitTrailingDate(line);
  if (!parts) {
    return null;
  }

  return `<div class="entry-row"><div class="entry-title entry-main">${renderInline(parts.main)}</div><time class="entry-date">${escapeHtml(parts.date)}</time></div>`;
}

function closeList(state, html) {
  if (!state.listType) {
    return;
  }
  html.push(`</${state.listType}>`);
  state.listType = null;
}

function renderBodyLine(line) {
  const dated = renderDatedLine(line);
  if (dated) {
    return dated;
  }

  if (isStrongOnlyLine(line)) {
    const label = stripOuterBold(line);
    if (/^(项目描述|主要工作|项目职责|技术栈|项目亮点|成果)[:：]?$/.test(label)) {
      return `<h4>${renderInline(label)}</h4>`;
    }
    return `<h3>${renderInline(label)}</h3>`;
  }

  return `<p>${renderInline(line)}</p>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const state = {
    listType: null,
    listIndent: 0,
    inSection: false,
    headerStarted: false,
    headerRendered: false,
    headerName: "",
    headerMetaLines: [],
    headerAvatar: null,
    currentSectionTitle: "",
    inProjectSection: false,
    inProjectBlock: false,
  };

  const closeProjectBlock = () => {
    if (!state.inProjectBlock) {
      return;
    }
    closeList(state, html);
    html.push("</div>");
    state.inProjectBlock = false;
  };

  const openProjectBlock = () => {
    if (!state.inProjectSection || state.inProjectBlock) {
      return;
    }
    html.push('<div class="project-block">');
    state.inProjectBlock = true;
  };

  const closeHeader = () => {
    if (!state.headerStarted || state.headerRendered) {
      return;
    }

    const metaHtml = state.headerMetaLines.map((meta) => `<p class="resume-meta-line">${renderInline(meta)}</p>`).join("");
    const avatarHtml = state.headerAvatar
      ? `<img class="resume-avatar" src="${escapeHtml(state.headerAvatar)}" alt="avatar" />`
      : "";

    html.push(`<header class="resume-header"><h1 class="resume-name">${renderInline(state.headerName)}</h1>${metaHtml}${avatarHtml}</header>`);
    state.headerRendered = true;
  };

  const closeSection = () => {
    if (!state.inSection) {
      return;
    }
    closeProjectBlock();
    closeList(state, html);
    html.push("</section>");
    state.inSection = false;
    state.inProjectSection = false;
    state.currentSectionTitle = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeList(state, html);
      continue;
    }

    if (line.startsWith("# ")) {
      closeSection();
      closeHeader();
      state.headerStarted = true;
      state.headerRendered = false;
      state.headerName = line.slice(2).trim();
      state.headerMetaLines = [];
      state.headerAvatar = null;
      continue;
    }

    if (line.startsWith("## ")) {
      closeHeader();
      closeSection();
      const sectionTitle = line.slice(3).trim();
      html.push(`<section class="section"><h2 class="section-title">${renderInline(sectionTitle)}</h2>`);
      state.inSection = true;
      state.currentSectionTitle = sectionTitle;
      state.inProjectSection = /项目(经历|经验)/.test(sectionTitle);
      continue;
    }

    if (state.headerStarted && !state.headerRendered && !state.inSection) {
      const avatarSrc = parseAvatarLine(line);
      if (avatarSrc && !state.headerAvatar) {
        state.headerAvatar = avatarSrc;
      } else {
        state.headerMetaLines.push(line);
      }
      continue;
    }

    if (line === "---") {
      closeList(state, html);
      if (state.inProjectSection) {
        closeProjectBlock();
      }
      html.push('<hr class="project-separator" />');
      continue;
    }

    if (state.inProjectSection) {
      openProjectBlock();
    }

    const listMatch = rawLine.match(/^(\s*)(\d+\.\s+|[-*]\s+)(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].replace(/\t/g, "  ").length;
      const listType = /^\d+\.\s+$/.test(listMatch[2]) ? "ol" : "ul";
      if (indent >= 2) {
        closeList(state, html);
        html.push(`<ul class="nested-list"><li>${renderInline(listMatch[3].trim())}</li></ul>`);
        continue;
      }
      if (state.listType !== listType) {
        closeList(state, html);
        html.push(`<${listType}>`);
        state.listType = listType;
      }
      html.push(`<li>${renderInline(listMatch[3].trim())}</li>`);
      continue;
    }

    closeList(state, html);
    html.push(renderBodyLine(line));
  }

  closeHeader();
  closeSection();

  return html.join("");
}

function normalTextColor(depth) {
  const lightness = 4 + depth * 0.68;
  return `hsl(210 19% ${lightness.toFixed(1)}%)`;
}

function fitToOnePage() {
  const content = els.preview.querySelector(".resume-content");
  if (!content) {
    return;
  }

  document.documentElement.style.setProperty("--fit-scale", "1");
  content.style.width = "100%";

  requestAnimationFrame(() => {
    const pageStyle = getComputedStyle(els.preview);
    const availableHeight = els.preview.clientHeight - parseFloat(pageStyle.paddingTop) - parseFloat(pageStyle.paddingBottom);
    const contentHeight = content.scrollHeight;
    const scale = Math.min(1, availableHeight / Math.max(contentHeight, 1));

    document.documentElement.style.setProperty("--fit-scale", scale.toFixed(4));
    content.style.width = `calc(100% / ${scale.toFixed(4)})`;
  });
}

function setStatus(message) {
  els.fileStatus.textContent = message;
}

function renderPreview() {
  els.preview.innerHTML = `<div class="resume-content resume-template-blue-compact">${renderMarkdown(els.markdown.value)}</div>`;
  fitToOnePage();
}

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function getCurrentSettings() {
  return {
    marginX: Number(els.marginX.value),
    marginY: Number(els.marginY.value),
    baseFontSize: Number(els.baseFontSize.value),
    headingFontSize: Number(els.headingFontSize.value),
    nameFontSize: Number(els.nameFontSize.value),
    lineHeight: Number(els.lineHeight.value),
    paragraphGap: Number(els.paragraphGap.value),
    normalTextDepth: Number(els.normalTextDepth.value),
    fontFamily: els.fontFamily.value,
  };
}

function applySettings(settings) {
  document.documentElement.style.setProperty("--page-margin-x", `${settings.marginX}px`);
  document.documentElement.style.setProperty("--page-margin-y", `${settings.marginY}px`);
  document.documentElement.style.setProperty("--base-font-size", `${settings.baseFontSize}px`);
  document.documentElement.style.setProperty("--heading-font-size", `${settings.headingFontSize}px`);
  document.documentElement.style.setProperty("--name-font-size", `${settings.nameFontSize}px`);
  document.documentElement.style.setProperty("--line-height", settings.lineHeight);
  document.documentElement.style.setProperty("--paragraph-gap", `${settings.paragraphGap}px`);
  document.documentElement.style.setProperty("--resume-font-family", settings.fontFamily);
  document.documentElement.style.setProperty("--normal-text-color", normalTextColor(settings.normalTextDepth));

  outputs.marginX.textContent = `${settings.marginX}px`;
  outputs.marginY.textContent = `${settings.marginY}px`;
  outputs.baseFontSize.textContent = `${settings.baseFontSize}px`;
  outputs.headingFontSize.textContent = `${settings.headingFontSize}px`;
  outputs.nameFontSize.textContent = `${settings.nameFontSize}px`;
  outputs.lineHeight.textContent = settings.lineHeight.toFixed(2);
  outputs.paragraphGap.textContent = `${settings.paragraphGap}px`;
  outputs.normalTextDepth.textContent = `${settings.normalTextDepth}%`;
}

function syncControls(settings) {
  Object.entries(settings).forEach(([key, value]) => {
    if (els[key]) {
      els[key].value = value;
    }
  });
}

function loadMarkdown(markdown, status) {
  isLoadingMarkdown = true;
  els.markdown.value = markdown;
  renderPreview();
  setStatus(status);
  isLoadingMarkdown = false;
}

function loadInitialMarkdown() {
  loadMarkdown("", "请选择 Markdown 文件，选择后会自动双向同步。");
}

async function verifyFilePermission(handle, mode = "read") {
  if (!handle?.queryPermission) {
    return false;
  }

  const options = { mode };
  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }

  return (await handle.requestPermission(options)) === "granted";
}

async function readMarkdownFile() {
  const file = await markdownFileHandle.getFile();
  lastKnownFileModified = file.lastModified;
  return await file.text();
}

async function writeMarkdownFile() {
  if (!markdownFileHandle || isLoadingMarkdown) {
    return;
  }

  try {
    isWritingMarkdown = true;
    const writable = await markdownFileHandle.createWritable();
    await writable.write(els.markdown.value);
    await writable.close();

    const file = await markdownFileHandle.getFile();
    lastKnownFileModified = file.lastModified;
    hasPendingLocalSave = false;
    setStatus(`已自动保存到 ${markdownFileHandle.name}。外部修改也会自动刷新。`);
  } catch (error) {
    setStatus(`自动保存失败：${error.message}`);
  } finally {
    isWritingMarkdown = false;
  }
}

function scheduleMarkdownSave() {
  if (!markdownFileHandle || isLoadingMarkdown) {
    return;
  }

  hasPendingLocalSave = true;
  clearTimeout(pendingSaveTimer);
  setStatus(`正在等待保存到 ${markdownFileHandle.name}...`);
  pendingSaveTimer = window.setTimeout(writeMarkdownFile, 500);
}

async function pollMarkdownFile() {
  if (!markdownFileHandle || isLoadingMarkdown || isWritingMarkdown || hasPendingLocalSave) {
    return;
  }

  try {
    const file = await markdownFileHandle.getFile();
    if (file.lastModified === lastKnownFileModified) {
      return;
    }

    const markdown = await file.text();
    lastKnownFileModified = file.lastModified;
    loadMarkdown(markdown, `检测到 ${markdownFileHandle.name} 已在外部修改，已刷新。`);
  } catch (error) {
    setStatus(`检测文件变化失败：${error.message}`);
  }
}

async function openMarkdownFile() {
  if (!window.showOpenFilePicker) {
    setStatus("当前浏览器不支持自动写回文件，请使用新版 Chrome 或 Edge。");
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });

    if (!(await verifyFilePermission(handle, "readwrite"))) {
      setStatus("没有文件读写权限，无法自动双向同步。");
      return;
    }

    markdownFileHandle = handle;
    const markdown = await readMarkdownFile();
    loadMarkdown(markdown, `已绑定 ${handle.name}，网页修改会自动保存，外部修改会自动刷新。`);
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus(`选择失败：${error.message}`);
    }
  }
}

function renderAndPersist() {
  const settings = getCurrentSettings();
  renderPreview();
  applySettings(settings);
  fitToOnePage();
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  scheduleMarkdownSave();
}

async function init() {
  const settings = readSettings();

  syncControls(settings);
  applySettings(settings);
  renderPreview();
  loadInitialMarkdown();

  els.markdown.addEventListener("input", renderAndPersist);
  els.printBtn.addEventListener("click", () => window.print());
  els.openMdBtn.addEventListener("click", openMarkdownFile);

  ["marginX", "marginY", "baseFontSize", "headingFontSize", "nameFontSize", "lineHeight", "paragraphGap", "normalTextDepth", "fontFamily"].forEach((key) => {
    els[key].addEventListener("input", renderAndPersist);
    els[key].addEventListener("change", renderAndPersist);
  });

  window.addEventListener("resize", fitToOnePage);
  window.setInterval(pollMarkdownFile, 1000);
}

init();
