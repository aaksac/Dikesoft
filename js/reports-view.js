/*
  reports-view.js
  Raporlar ekranında Genel Rapor / Bayi Bazlı Raporlar görünümünü ayırır.
*/
let activeReportView = "general";

export function showReportView(view = "general") {
  activeReportView = view;

  const generalPanel = document.getElementById("generalReportPanel");
  const dealerPanel = document.getElementById("dealerReportPanel");
  const generalBtn = document.getElementById("reportViewGeneralBtn");
  const dealerBtn = document.getElementById("reportViewDealerBtn");

  if (generalPanel) {
    generalPanel.classList.toggle("is-active-report-view", activeReportView === "general");
  }

  if (dealerPanel) {
    dealerPanel.classList.toggle("is-active-report-view", activeReportView === "dealer");
  }

  if (generalBtn) {
    generalBtn.classList.toggle("btn-primary", activeReportView === "general");
    generalBtn.classList.toggle("btn-soft", activeReportView !== "general");
  }

  if (dealerBtn) {
    dealerBtn.classList.toggle("btn-primary", activeReportView === "dealer");
    dealerBtn.classList.toggle("btn-soft", activeReportView !== "dealer");
  }
}

export function setupReportViewControls() {
  document.getElementById("reportViewGeneralBtn")?.addEventListener("click", () => showReportView("general"));
  document.getElementById("reportViewDealerBtn")?.addEventListener("click", () => showReportView("dealer"));

  setTimeout(() => showReportView(activeReportView), 0);
}
