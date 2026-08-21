/*
  definitions-view.js
  Tanımlar ekranında yalnızca seçilen tabloyu gösterir.
*/
let activeDefinitionView = "channels";

function getPanels() {
  return {
    channels: document.getElementById("channelsTable")?.closest(".panel"),
    dealers: document.getElementById("dealersTable")?.closest(".panel"),
    mails: document.getElementById("mailsTable")?.closest(".panel")
  };
}

export function applyDefinitionView(type = "channels") {
  activeDefinitionView = type || "channels";

  const panels = getPanels();

  Object.entries(panels).forEach(([key, panel]) => {
    if (!panel) return;
    const show = key === activeDefinitionView;
    panel.dataset.definitionPanel = key;
    panel.classList.add("definition-card");
    panel.classList.toggle("hidden", !show);
    panel.style.display = show ? "block" : "none";
  });

  document.querySelectorAll("#definitions [data-definition-view]").forEach(btn => {
    btn.classList.toggle("is-active-definition", btn.dataset.definitionView === activeDefinitionView);
  });

  const grid = document.querySelector("#definitions > .grid.two-cols");
  if (grid) {
    const showGrid = activeDefinitionView === "channels" || activeDefinitionView === "dealers";
    grid.classList.toggle("definition-grid-hidden", !showGrid);
    grid.style.display = showGrid ? "" : "none";
  }

  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

export function setupDefinitionViewController() {
  document.addEventListener("click", event => {
    const btn = event.target.closest("#definitions [data-definition-view]");
    if (!btn) return;
    applyDefinitionView(btn.dataset.definitionView);
  });

  document.addEventListener("dikesoft:definitions-imported", event => {
    applyDefinitionView(event.detail?.view || activeDefinitionView);
  });

  document.addEventListener("dikesoft:definitions-rendered", event => {
    applyDefinitionView(event.detail?.view || activeDefinitionView);
  });

  setTimeout(() => applyDefinitionView(activeDefinitionView), 0);
  setTimeout(() => applyDefinitionView(activeDefinitionView), 250);
}

export function refreshDefinitionView() {
  applyDefinitionView(activeDefinitionView);
}
