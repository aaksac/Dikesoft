const titles={dashboard:["Ana Sayfa","Excel verisini içe aktar, hesapla, raporları gönder."],import:["Dosya İçe Aktar","Ödeme/fatura verilerini sisteme al."],data:["Veriler","Son yüklenen dosya verilerini düzenle, sil veya toplu yönet."],definitions:["Tanımlar","Kanal, bayi ve mail tanımlarını yönet."],customerAnalytics:["Müşteri Yönetimi","SQL kayıtlarını müşteri, bayi, kanal, yıl ve ay filtresiyle incele."],bayiManagement:["Bayi Yönetimi","Kanal, yıl ve ay filtresine göre bayi pay raporlarını analiz et."],reports:["Raporlar","Genel özet ve bayi bazlı raporları kontrol et."],sendLogs:["Gönderimler","Mail gönderim geçmişini incele."],settings:["Ayarlar","Sistem ayarlarını düzenle."]};
const pageIcons={dashboard:"⌂",import:"⇪",data:"▦",definitions:"☷",customerAnalytics:"◉",bayiManagement:"◍",reports:"▤",sendLogs:"✉",settings:"⚙"};
export function showPage(pageId){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("is-visible"));
  document.getElementById(pageId)?.classList.add("is-visible");
  document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("is-active",b.dataset.page===pageId));

  const title = titles[pageId]?.[0] || "Panel";
  const icon = pageIcons[pageId] || "";
  const pageTitle = document.getElementById("pageTitle");
  const pageTitleText = document.getElementById("pageTitleText");
  const pageTitleIcon = document.getElementById("pageTitleIcon");

  if (pageTitleText) {
    pageTitleText.textContent = title;
    if (pageTitleIcon) pageTitleIcon.textContent = icon;
  } else if (pageTitle) {
    pageTitle.textContent = title;
  }

  document.getElementById("pageSubtitle").textContent=titles[pageId]?.[1]||""
}
export function toast(message, options = {}){
  const el=document.getElementById("toast");
  if(!el) return;
  const duration = Number.isFinite(options?.duration) ? options.duration : 2600;
  el.textContent=message;
  el.classList.remove("hidden","toast-mail-centered","toast-info","toast-success","toast-warning","toast-error");
  if(options?.variant === "mail"){
    el.classList.add("toast-mail-centered", `toast-${options?.type || "info"}`);
  }
  clearTimeout(window.__toastTimer);
  if(duration > 0){
    window.__toastTimer=setTimeout(()=>el.classList.add("hidden"),duration);
  }
}
export function renderTable(targetId,rows,columns){const el=document.getElementById(targetId);if(!rows.length){el.textContent="Kayıt yok.";return}el.innerHTML="";const table=document.createElement("table");const thead=document.createElement("thead");const trh=document.createElement("tr");columns.forEach(c=>{const th=document.createElement("th");th.textContent=c.label;trh.appendChild(th)});thead.appendChild(trh);const tbody=document.createElement("tbody");rows.forEach(row=>{const tr=document.createElement("tr");columns.forEach(c=>{const td=document.createElement("td");td.textContent=row[c.key]??"";tr.appendChild(td)});tbody.appendChild(tr)});table.append(thead,tbody);el.appendChild(table)}
export function setupDeviceClasses(){const ua=navigator.userAgent||"";const isIPadOS=/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1;document.body.classList.toggle("is-android",/Android/i.test(ua));document.body.classList.toggle("is-ios",/iPhone|iPad|iPod/i.test(ua)||isIPadOS);document.body.classList.toggle("is-tablet",window.matchMedia&&window.matchMedia("(min-width:768px) and (max-width:1366px)").matches)}

function isTabletPortraitLayout(){
  try{
    return window.matchMedia("(min-width:768px) and (max-width:1180px) and (orientation: portrait)").matches;
  }catch{
    return window.innerWidth>=768&&window.innerWidth<=1180&&window.innerHeight>window.innerWidth;
  }
}

function isMobileMenuViewport(){
  try{
    return window.matchMedia("(max-width: 767px)").matches||isTabletPortraitLayout();
  }catch{
    return window.innerWidth<=767||isTabletPortraitLayout();
  }
}


export function setupSidebarToggle() {
  const btn = document.getElementById("sidebarToggleBtn");
  const shell = document.getElementById("appShell");

  if (!btn || !shell) return;

  const applyA11y = () => {
    const collapsed = shell.classList.contains("sidebar-collapsed");
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", collapsed ? "Menüyü genişlet" : "Menüyü daralt");
    btn.title = collapsed ? "Menüyü genişlet" : "Menüyü daralt";
  };

  const saved = localStorage.getItem("dikesoft:sidebarCollapsed");
  if (saved === "1") {
    shell.classList.add("sidebar-collapsed");
  }
  applyA11y();

  let transitionTimer = null;
  btn.addEventListener("click", () => {
    if (shell.classList.contains("is-sidebar-transitioning")) return;

    shell.classList.add("is-sidebar-transitioning");

    requestAnimationFrame(() => {
      shell.classList.toggle("sidebar-collapsed");
      localStorage.setItem("dikesoft:sidebarCollapsed", shell.classList.contains("sidebar-collapsed") ? "1" : "0");
      applyA11y();

      clearTimeout(transitionTimer);
      transitionTimer = setTimeout(() => {
        shell.classList.remove("is-sidebar-transitioning");
      }, 330);
    });
  });
}


export function setupMobileMoreMenu() {
  const btn = document.getElementById("mobileMoreBtn");
  const menu = document.getElementById("mobileMoreMenu");

  if (!btn || !menu) return;

  const isMobileMenuLayout = isMobileMenuViewport;

  const isOpen = () => !menu.classList.contains("hidden");

  const applyPendingAuthStatus = () => {
    const status = document.getElementById("authStatus");
    const pendingText = status?.dataset?.pendingText;
    if (!status || !pendingText) return;
    status.textContent = pendingText;
    delete status.dataset.pendingText;
  };

  const close = () => {
    if (!isOpen()) return;
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
    applyPendingAuthStatus();
  };

  const open = () => {
    menu.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  };

  const toggle = event => {
    event.stopPropagation();
    if (isOpen()) close();
    else open();
  };

  if (btn.dataset.moreBound !== "1") {
    btn.dataset.moreBound = "1";
    btn.addEventListener("click", toggle);
  }

  menu.querySelectorAll("[data-page], [data-action='logout']").forEach(item => {
    if (item.dataset.moreItemBound === "1") return;
    item.dataset.moreItemBound = "1";
    item.addEventListener("click", close);
  });

  if (document.documentElement.dataset.mobileMoreOutsideBound !== "1") {
    document.documentElement.dataset.mobileMoreOutsideBound = "1";
    document.addEventListener("click", event => {
      if (!menu.contains(event.target) && !btn.contains(event.target)) close();
    });
  }

  if (window.__dikesoftMobileMoreResizeHandler) {
    window.removeEventListener("resize", window.__dikesoftMobileMoreResizeHandler);
  }

  window.__dikesoftMobileMoreResizeHandler = () => {
    // Mobilde kullanıcı maili veya üst bar ölçüsü sonradan geldiğinde bazı tarayıcılar resize tetikliyor.
    // Menü açıksa ve hâlâ mobil kırılımdayız, menüyü kapatma; sadece desktop kırılımına geçildiğinde kapat.
    if (isOpen() && isMobileMenuLayout()) return;
    close();
  };
  window.addEventListener("resize", window.__dikesoftMobileMoreResizeHandler);
}


export function setupMobileScrollBoundaries() {
  if (document.documentElement.dataset.mobileScrollBoundaryBound === "1") return;
  document.documentElement.dataset.mobileScrollBoundaryBound = "1";

  const isMobile = isMobileMenuViewport;
  const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  const scrollHostSelector = ".definition-table-wrap,.definition-mobile-scroll-wrap,.main";
  const edgeSwipeState = { active: false, startX: 0, startY: 0, locked: false };

  const isInteractiveTextControl = target => {
    const el = target instanceof Element ? target : target?.parentElement;
    return Boolean(el?.closest?.("input, textarea, select, [contenteditable='true']"));
  };

  const shouldGuardIOSBrowserEdgeSwipe = touch => {
    if (!isMobile() || !isIOS() || !touch) return false;
    const edgeSize = Math.min(28, Math.max(18, window.innerWidth * 0.07));
    return touch.clientX <= edgeSize || touch.clientX >= window.innerWidth - edgeSize;
  };

  const nudgeInsideScrollableBoundary = el => {
    if (!el) return;

    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxTop > 1) {
      if (el.scrollTop <= 0) el.scrollTop = 1;
      else if (el.scrollTop >= maxTop) el.scrollTop = maxTop - 1;
    }

    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    if (maxLeft > 1) {
      if (el.scrollLeft <= 0) el.scrollLeft = 1;
      else if (el.scrollLeft >= maxLeft) el.scrollLeft = maxLeft - 1;
    }
  };

  document.addEventListener("touchstart", event => {
    if (!isMobile() || !event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    edgeSwipeState.active = shouldGuardIOSBrowserEdgeSwipe(touch) && !isInteractiveTextControl(event.target);
    edgeSwipeState.startX = touch.clientX;
    edgeSwipeState.startY = touch.clientY;
    edgeSwipeState.locked = false;

    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const host = target?.closest(scrollHostSelector);
    if (!host) return;
    nudgeInsideScrollableBoundary(host);
  }, { passive: true });

  document.addEventListener("touchmove", event => {
    if (!edgeSwipeState.active || !event.touches || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - edgeSwipeState.startX;
    const dy = touch.clientY - edgeSwipeState.startY;
    const horizontal = Math.abs(dx);
    const vertical = Math.abs(dy);

    if (!edgeSwipeState.locked && horizontal > 8 && horizontal > vertical * 1.15) {
      edgeSwipeState.locked = true;
    }

    if (edgeSwipeState.locked) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("touchend", () => {
    edgeSwipeState.active = false;
    edgeSwipeState.locked = false;
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    edgeSwipeState.active = false;
    edgeSwipeState.locked = false;
  }, { passive: true });
}
