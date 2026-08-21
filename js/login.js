/*
  login.js
  Görev: Sadece giriş ekranını yönetir. Kayıt olma yoktur.
  Kullanıcılar Firebase Authentication panelinden eklenir.
*/
import { firebaseConfig } from "./config.js";
import { setupDeviceClasses, toast } from "./ui.js";
import { checkForAppUpdate, setupSilentAutoUpdate } from "./updater.js";

setupDeviceClasses();
setupSilentAutoUpdate();
// Açılışta görsel kesinti oluşturmamak için güncelleme kontrolü auth kararından sonraya bırakılır.

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

let authRedirecting = false;
let manualLoginInProgress = false;
const authBootStartedAt = window.performance?.now?.() || Date.now();

const MOBILE_STARTUP_QUERY = "(max-width: 768px), (hover: none) and (pointer: coarse)";
const FIRST_VISIT_SPLASH_MIN_MS = 950;
const MANUAL_LOGIN_SPLASH_MIN_MS = 700;
const MOBILE_APP_NAV_SPLASH_MIN_MS = 220;

function isMobileStartupMode() {
  try {
    if (window.matchMedia && window.matchMedia(MOBILE_STARTUP_QUERY).matches) return true;
  } catch (error) {}
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(window.navigator.userAgent || "");
}

function markAuthSplashImageReady() {
  const img = document.getElementById("authBootImage");
  if (img && img.complete && img.naturalWidth > 0) {
    img.classList.add("is-loaded");
    [document.documentElement, document.body].filter(Boolean).forEach(target => {
      target.classList.add("dikesoft-splash-ready");
    });
  }
}

function setAuthSplashActive(active) {
  const targets = [document.documentElement, document.body].filter(Boolean);
  const splash = document.getElementById("authBootScreen");
  const mobile = isMobileStartupMode();

  if (!active) {
    document.documentElement.classList.remove("dikesoft-first-paint");
  }

  if (!mobile) {
    targets.forEach(target => {
      target.classList.remove("dikesoft-splash-active", "dikesoft-splash-image", "dikesoft-splash-ready");
      target.classList.toggle("dikesoft-auth-pending", active);
    });

    if (document.body) {
      document.body.classList.toggle("auth-checking", active);
      document.body.classList.remove("dikesoft-splash-active", "dikesoft-splash-image");
    }

    if (splash) {
      splash.classList.toggle("is-visible", active);
      splash.setAttribute("aria-hidden", active ? "false" : "true");
      splash.dataset.mode = "desktop";
    }

    if (active) {
      markAuthSplashImageReady();
    }
    return;
  }

  targets.forEach(target => {
    target.classList.toggle("dikesoft-auth-pending", active);
    target.classList.toggle("dikesoft-splash-active", active);
    target.classList.toggle("dikesoft-splash-image", active);
  });

  if (document.body) {
    document.body.classList.toggle("auth-checking", active);
    document.body.classList.toggle("dikesoft-splash-active", active);
    document.body.classList.toggle("dikesoft-splash-image", active);
  }

  if (splash) {
    splash.classList.toggle("is-visible", active);
    splash.setAttribute("aria-hidden", active ? "false" : "true");
    splash.dataset.mode = "image";
  }

  if (active) {
    markAuthSplashImageReady();
  } else {
    targets.forEach(target => target.classList.remove("dikesoft-splash-ready"));
  }
}

function keepSplashForAppNavigation() {
  // Rota uygulamasındaki akışla aynı: app.html ikinci splash üretmez.
  // Giriş sayfasındaki tam ekran splash, yönlendirme anına kadar görünür;
  // uygulama sayfası kendi arayüzünü doğrudan açar.
  clearSplashNavigationState();
}

function clearSplashNavigationState() {
  try {
    sessionStorage.removeItem("dikesoftStartupSplash");
    sessionStorage.removeItem("dikesoftStartupSplashAt");
  } catch {}
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function waitUntilBootMinimum(minMs) {
  const now = window.performance?.now?.() || Date.now();
  const elapsed = Math.max(0, now - authBootStartedAt);
  const remaining = Math.max(0, minMs - elapsed);
  if (remaining > 0) await wait(remaining);
}

async function finishAuthCheck({ respectFirstVisitMinimum = true } = {}) {
  if (authRedirecting) return;
  if (respectFirstVisitMinimum) {
    await waitUntilBootMinimum(FIRST_VISIT_SPLASH_MIN_MS);
  }
  setAuthSplashActive(false);
  clearSplashNavigationState();
  window.setTimeout(() => checkForAppUpdate(), 800);
}

async function goToApp() {
  if (authRedirecting) return;
  authRedirecting = true;
  keepSplashForAppNavigation();
  setAuthSplashActive(true);

  if (manualLoginInProgress) {
    await wait(MANUAL_LOGIN_SPLASH_MIN_MS);
  } else if (isMobileStartupMode()) {
    await wait(MOBILE_APP_NAV_SPLASH_MIN_MS);
  }

  window.location.replace("./app.html");
}

async function initLogin() {
  try {
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
    const {
      getAuth,
      signInWithEmailAndPassword,
      onAuthStateChanged
    } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");

    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const auth = getAuth(app);

    onAuthStateChanged(auth, async user => {
      if (user) {
        await goToApp();
        return;
      }

      await finishAuthCheck({ respectFirstVisitMinimum: true });
    });

    document.getElementById("loginForm").addEventListener("submit", async event => {
      event.preventDefault();

      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      const errorBox = document.getElementById("loginError");

      errorBox.classList.add("hidden");
      errorBox.textContent = "";

      try {
        manualLoginInProgress = true;
        setAuthSplashActive(true);
        await signInWithEmailAndPassword(auth, email, password);
        await goToApp();
      } catch (error) {
        authRedirecting = false;
        manualLoginInProgress = false;
        setAuthSplashActive(false);
        errorBox.textContent = "Giriş başarısız. Kullanıcı adı veya şifre hatalı olabilir.";
        errorBox.classList.remove("hidden");
      }
    });
  } catch (error) {
    console.warn("Firebase başlatılamadı:", error);
    finishAuthCheck({ respectFirstVisitMinimum: false });
    toast("Firebase ayarları girilmedi. js/config.js dosyasını kontrol edin.");
  }
}

initLogin();
