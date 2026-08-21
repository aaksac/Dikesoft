/*
  auth.js
  Görev: app.html içinde oturum kontrolü ve çıkış işlemleri.
*/
import { firebaseConfig } from "./config.js";
import { state } from "./state.js";
import { toast } from "./ui.js";

let auth = null;
let firebaseSignOut = null;

export async function initAuth() {
  try {
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
    const {
      getAuth,
      signOut,
      onAuthStateChanged
    } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");

    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    firebaseSignOut = signOut;

    bindLogoutButtons();
    setLogoutEnabled(true);

    if (auth.currentUser) {
      state.user = auth.currentUser;
      setAuthStatus(auth.currentUser.email || "Oturum açık");
    }

    return await new Promise(resolve => {
      let initialResolved = false;

      onAuthStateChanged(auth, user => {
        if (!initialResolved) {
          initialResolved = true;
          resolve(Boolean(user));
        }

        if (!user) {
          window.location.replace("./index.html");
          return;
        }

        state.user = user;
        setAuthStatus(user.email || "Oturum açık");
        setLogoutEnabled(true);
      });
    });
  } catch (error) {
    console.warn("Firebase başlatılamadı, demo mod aktif:", error);
    bindLogoutButtons();
    toast("Firebase ayarı girilmediği için demo mod açıldı.");
    return false;
  }
}

function setAuthStatus(text) {
  const status = document.getElementById("authStatus");
  if (!status) return;

  const nextText = text || "Oturum açık";
  const menu = document.getElementById("mobileMoreMenu");
  const isMobileMenuOpen = menu && !menu.classList.contains("hidden") && (() => {
    try {
      return window.matchMedia("(max-width: 767px)").matches;
    } catch {
      return window.innerWidth <= 767;
    }
  })();

  // Mobil menü açıkken Firebase kullanıcı maili sonradan gelirse üst barı yeniden akıtıp menüyü kapatmasın.
  // Mail bilgisi arka planda saklanır; menü kapandığında ui.js bekleyen metni ekrana uygular.
  if (isMobileMenuOpen) {
    status.dataset.pendingText = nextText;
    return;
  }

  status.textContent = nextText;
  delete status.dataset.pendingText;
}

function setLogoutEnabled(enabled) {
  document.querySelectorAll("#logoutBtn, [data-action='logout'], .logout-btn").forEach(btn => {
    btn.disabled = !enabled;
    btn.classList.toggle("is-disabled", !enabled);
    btn.style.pointerEvents = enabled ? "auto" : "none";
    btn.style.opacity = enabled ? "1" : ".65";
  });
}

function bindLogoutButtons() {
  document.querySelectorAll("#logoutBtn, [data-action='logout'], .logout-btn").forEach(btn => {
    if (btn.dataset.logoutBound === "1") return;

    btn.dataset.logoutBound = "1";
    btn.addEventListener("click", logout);
  });
}

async function logout() {
  try {
    if (auth && firebaseSignOut) {
      await firebaseSignOut(auth);
    }
  } catch (error) {
    console.warn("Çıkış yapılırken hata:", error);
  } finally {
    try {
      localStorage.removeItem("dikesoft:currentDraft");
      sessionStorage.clear();
    } catch {}

    window.location.replace("./index.html");
  }
}
