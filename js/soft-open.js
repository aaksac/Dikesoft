/*
  soft-open.js
  Eski sürümlerde masaüstünde sonradan ikinci bir splash katmanı ekliyordu.
  Bu davranış ilk açılışta yeşil/beyaz yanıp sönme ve app.html tarafında
  gereksiz tekrar açılış üretiyordu. Splash/auth akışı artık login.js ve
  app.html içindeki erken stillerle yönetilir. Bu dosya bilinçli olarak
  görsel katman oluşturmaz; eski HTML önbellekten çağırırsa da güvenli kalır.
*/
(function cleanupLegacyDesktopSplash() {
  try {
    document.getElementById("desktop-splash")?.remove();
  } catch (error) {}
})();
