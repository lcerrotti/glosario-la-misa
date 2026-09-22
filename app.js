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

function stopClip() {
  if (!activeClip) return;
  activeClip.classList.remove("is-playing");
  const box = activeClip.querySelector(".clip");
  if (box) box.innerHTML = "";
  activeClip = null;
}

function playClip(entry) {
  const id = entry.dataset.video;
  if (!id || activeClip === entry) return;
  stopClip();
  let box = entry.querySelector(".clip");
  if (!box) {
    box = document.createElement("div");
    box.className = "clip";
    entry.appendChild(box);
  }
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${id}`;
  box.innerHTML = `<iframe src="${src}" allow="autoplay; encrypted-media" title="Video"></iframe>`;
  entry.classList.add("is-playing");
  activeClip = entry;
}

glossaryEl.addEventListener("mouseover", (event) => {
  const entry = event.target.closest(".entry.has-video");
  if (!entry || entry.contains(event.relatedTarget)) return;
  playClip(entry);
});

glossaryEl.addEventListener("mouseout", (event) => {
  const entry = event.target.closest(".entry.has-video");
  if (!entry || entry.contains(event.relatedTarget)) return;
  stopClip();
});

glossaryEl.addEventListener("click", (event) => {
  if (!window.matchMedia("(hover: none)").matches) return;
  const entry = event.target.closest(".entry.has-video");
  if (!entry) return;
  if (activeClip === entry) stopClip();
  else playClip(entry);
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
