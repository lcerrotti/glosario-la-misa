let TERMS = [];

const q = document.querySelector("#q");
const lettersEl = document.querySelector("#letters");
const glossaryEl = document.querySelector("#glossary");
const emptyEl = document.querySelector("#empty");
const countEl = document.querySelector("#count");

const params = new URLSearchParams(window.location.search);
if (params.get("q")) q.value = params.get("q");

let activeLetter = (params.get("letra") || "TODAS").toUpperCase();

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function firstLetter(term) {
  return normalize(term).charAt(0).toUpperCase();
}

function cellText(cell) {
  if (!cell) return "";
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

function pickColumn(headers, patterns, fallback) {
  const index = headers.findIndex((header) =>
    patterns.some((pattern) => pattern.test(normalize(header)))
  );
  return index >= 0 ? index : fallback;
}

function youtubeId(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  const match = text.match(
    /(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  return "";
}

function uniqueTerms(rows) {
  const seen = new Set();
  const terms = [];
  rows.forEach((row) => {
    const term = String(row.term || "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    const definition = String(row.definition || "").replace(/\s+/g, " ").trim();
    const key = normalize(term);
    if (!term || !definition || seen.has(key)) return;
    seen.add(key);
    terms.push({
      term,
      definition,
      video: youtubeId(row.video),
    });
  });
  return terms;
}

function termsFromGviz(table) {
  const labels = (table.cols || []).map((col) => String(col.label || "").trim());
  const raw = (table.rows || []).map((row) => (row.c || []).map(cellText));
  let headers = labels;
  let data = raw;
  if (!headers.some(Boolean) && raw.length) {
    headers = raw[0];
    data = raw.slice(1);
  }
  const termCol = pickColumn(headers, [/palabra/, /termino/, /term/], 0);
  const defCol = pickColumn(headers, [/defin/], 1);
  const videoCol = pickColumn(headers, [/^video$/], 2);
  return uniqueTerms(
    data.map((row) => ({
      term: row[termCol] || "",
      definition: row[defCol] || "",
      video: row[videoCol] || "",
    }))
  );
}

function termsFromObjects(rows) {
  return uniqueTerms(
    rows.map((row) => {
      const entries = Object.entries(row || {});
      const term =
        row.Palabra ||
        row.palabra ||
        row.Termino ||
        row.Término ||
        row.term ||
        (entries[0] ? entries[0][1] : "");
      const definition =
        row.Definicion ||
        row.Definición ||
        row.definicion ||
        row.definition ||
        (entries[1] ? entries[1][1] : "");
      const video = row.video || row.Video || row.VIDEO || "";
      return { term, definition, video };
    })
  );
}

async function loadFromGviz(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=0`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("gviz");
  const text = await response.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("gviz-parse");
  const payload = JSON.parse(text.slice(start, end + 1));
  const terms = termsFromGviz(payload.table || {});
  if (!terms.length) throw new Error("gviz-empty");
  return terms;
}

async function loadFromOpenSheet(sheetId) {
  const tab = encodeURIComponent(SHEET_TAB || "Hoja 1");
  const url = `https://opensheet.elk.sh/${sheetId}/${tab}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("opensheet");
  const rows = await response.json();
  const terms = termsFromObjects(rows);
  if (!terms.length) throw new Error("opensheet-empty");
  return terms;
}

async function loadLocalTerms() {
  const response = await fetch("terms.json");
  if (!response.ok) throw new Error("local");
  return uniqueTerms(await response.json());
}

async function loadTerms() {
  const sheetId = (typeof SHEET_ID === "string" && SHEET_ID.trim()) || "";
  if (sheetId) {
    try {
      return await loadFromGviz(sheetId);
    } catch (error) {
      try {
        return await loadFromOpenSheet(sheetId);
      } catch (fallbackError) {
        console.warn("No se pudo leer Google Sheets, uso terms.json", error, fallbackError);
      }
    }
  }
  return loadLocalTerms();
}

function sortedTerms() {
  return [...TERMS].sort((a, b) =>
    a.term.localeCompare(b.term, "es", { sensitivity: "base" })
  );
}

function matches(term, query) {
  if (!query) return true;
  return normalize(`${term.term} ${term.definition}`).includes(query);
}

function lettersInUse() {
  return [...new Set(sortedTerms().map((item) => firstLetter(item.term)))].sort();
}

function filtered() {
  const query = normalize(q.value.trim());
  return sortedTerms().filter((item) => {
    const letterOk = activeLetter === "TODAS" || firstLetter(item.term) === activeLetter;
    return letterOk && matches(item, query);
  });
}

function renderLetters() {
  const buttons = ["TODAS", ...lettersInUse()]
    .map((letter) => {
      const pressed = letter === activeLetter ? "true" : "false";
      const label = letter === "TODAS" ? "Todas" : letter;
      return `<button type="button" data-letter="${letter}" aria-pressed="${pressed}">${label}</button>`;
    })
    .join("");
  lettersEl.innerHTML = buttons;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  const items = filtered();
  emptyEl.hidden = items.length > 0;
  countEl.textContent =
    items.length === 1 ? "1 término" : `${items.length} términos`;

  if (!items.length) {
    glossaryEl.innerHTML = "";
    return;
  }

  const groups = new Map();
  items.forEach((item) => {
    const letter = firstLetter(item.term);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(item);
  });

  let delay = 0;
  glossaryEl.innerHTML = [...groups.entries()]
    .map(([letter, group]) => {
      const entries = group
        .map((item) => {
          delay += 1;
          const video = item.video
            ? ` data-video="${escapeHtml(item.video)}" class="entry has-video"`
            : ` class="entry"`;
          return `
            <article${video} style="--d:${delay}">
              <h2>${escapeHtml(item.term)}</h2>
              <p>${escapeHtml(item.definition)}</p>
            </article>
          `;
        })
        .join("");
      return `
        <section class="letter-block" id="letra-${letter}">
          <h3>${escapeHtml(letter)}</h3>
          ${entries}
        </section>
      `;
    })
    .join("");
}

lettersEl.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  activeLetter = button.dataset.letter;
  renderLetters();
  render();
});

q.addEventListener("input", render);

let activeClip = null;
let clipLayer = null;
let hideTimer = 0;
let wantedVolume = 80;
let audioOn = false;

function isDesktop() {
  return window.matchMedia("(min-width: 721px)").matches;
}

function getClipLayer() {
  if (!clipLayer) {
    clipLayer = document.createElement("div");
    clipLayer.className = "clip clip-layer";
    clipLayer.hidden = true;
    document.body.appendChild(clipLayer);
    clipLayer.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    clipLayer.addEventListener("mouseleave", () => {
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(stopClip, 200);
    });
  }
  return clipLayer;
}

function clipSrc(id) {
  const origin = encodeURIComponent(window.location.origin);
  return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${id}&enablejsapi=1&origin=${origin}`;
}

function sendYt(iframe, func, args = []) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    JSON.stringify({ event: "command", func, args }),
    "*"
  );
}

function placeClip(entry, box) {
  const rect = entry.getBoundingClientRect();
  const width = 210;
  const height = 374;
  let left = rect.right + 18;
  if (left + width > window.innerWidth - 12) {
    left = window.innerWidth - width - 12;
  }
  let top = rect.top;
  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - height - 12);
  }
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

function stopClip() {
  clearTimeout(hideTimer);
  if (activeClip) activeClip.classList.remove("is-playing");
  if (clipLayer) {
    clipLayer.hidden = true;
    clipLayer.innerHTML = "";
  }
  const local = activeClip?.querySelector(".clip");
  if (local) local.remove();
  activeClip = null;
  audioOn = false;
}

function bindClipControls(box) {
  const iframe = box.querySelector("iframe");
  const sound = box.querySelector(".clip-sound");
  const volume = box.querySelector(".clip-vol");

  sound.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    audioOn = !audioOn;
    if (audioOn) {
      sendYt(iframe, "unMute");
      sendYt(iframe, "setVolume", [wantedVolume]);
      sound.textContent = "Silenciar";
      sound.classList.add("is-on");
    } else {
      sendYt(iframe, "mute");
      sound.textContent = "Activar audio";
      sound.classList.remove("is-on");
    }
  });

  volume.addEventListener("input", (event) => {
    event.stopPropagation();
    wantedVolume = Number(volume.value);
    sendYt(iframe, "setVolume", [wantedVolume]);
    if (wantedVolume > 0 && !audioOn) {
      audioOn = true;
      sendYt(iframe, "unMute");
      sound.textContent = "Silenciar";
      sound.classList.add("is-on");
    }
  });

  box.addEventListener("pointerdown", (event) => event.stopPropagation());
}

function playClip(entry) {
  const id = entry.dataset.video;
  if (!id || activeClip === entry) return;
  stopClip();

  const desktop = isDesktop();
  const box = desktop ? getClipLayer() : document.createElement("div");
  if (!desktop) {
    box.className = "clip";
    entry.appendChild(box);
  }

  box.hidden = false;
  box.innerHTML = `
    <div class="clip-frame">
      <iframe src="${clipSrc(id)}" allow="autoplay; encrypted-media; fullscreen" title="Video"></iframe>
    </div>
    <div class="clip-ui">
      <button type="button" class="clip-sound">Activar audio</button>
      <input class="clip-vol" type="range" min="0" max="100" value="${wantedVolume}" aria-label="Volumen" />
    </div>
  `;
  bindClipControls(box);
  entry.classList.add("is-playing");
  activeClip = entry;
  if (desktop) placeClip(entry, box);
}

glossaryEl.addEventListener("mouseenter", (event) => {
  if (!isDesktop()) return;
  const entry = event.target.closest(".entry.has-video");
  if (!entry) return;
  clearTimeout(hideTimer);
  playClip(entry);
}, true);

glossaryEl.addEventListener("mouseleave", (event) => {
  if (!isDesktop()) return;
  const entry = event.target.closest(".entry.has-video");
  if (!entry) return;
  if (clipLayer && event.relatedTarget && clipLayer.contains(event.relatedTarget)) return;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(stopClip, 250);
}, true);

glossaryEl.addEventListener("click", (event) => {
  if (event.target.closest(".clip")) return;
  if (isDesktop()) return;
  const entry = event.target.closest(".entry.has-video");
  if (!entry) return;
  if (activeClip === entry) stopClip();
  else playClip(entry);
});

window.addEventListener(
  "scroll",
  () => {
    if (!activeClip || !isDesktop()) return;
    const box = activeClip.querySelector(".clip");
    if (box) placeClip(activeClip, box);
  },
  { passive: true }
);

window.addEventListener("resize", () => {
  if (!activeClip) return;
  const box = activeClip.querySelector(".clip");
  if (box) placeClip(activeClip, box);
});

const hint = document.querySelector("#hint");
let hintShown = false;

if (params.get("hint")) {
  hint.classList.add("is-on");
  hintShown = true;
}

window.addEventListener(
  "scroll",
  () => {
    if (hintShown || window.scrollY < 20) return;
    hint.classList.add("is-on");
    hintShown = true;
  },
  { passive: true }
);

loadTerms()
  .then((data) => {
    TERMS = data;
    renderLetters();
    render();
  })
  .catch(() => {
    countEl.textContent = "No se pudo cargar el glosario.";
  });
