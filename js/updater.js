/*
  updater.js
  Görev: PWA güncellemesini kullanıcı ekranını yenilemeden arka planda almak.
  Not: controllerchange sonrası otomatik reload yapılmaz. Bu, mobil açılışta splash'ın aç-kapa yapmasını engeller.
*/
let updateCheckInProgress = false;

export async function checkForAppUpdate() {
  if (!("serviceWorker" in navigator)) return;
  if (updateCheckInProgress) return;

  updateCheckInProgress = true;
  try {
    const registration = await navigator.serviceWorker.getRegistration("./");
    if (registration) {
      await registration.update();
    }
  } catch (error) {
    console.warn("Sessiz güncelleme kontrolü yapılamadı:", error);
  } finally {
    updateCheckInProgress = false;
  }
}

export function setupSilentAutoUpdate() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    try {
      sessionStorage.setItem("dikesoft:update-ready", "1");
    } catch {}
  });
}
