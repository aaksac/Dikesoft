/*
  settings.js
  Görev: Toplu mail konusu ve açıklama metnini yönetir.
*/
import { state } from "./state.js";
import { sanitizeText } from "./security.js";
import { toast } from "./ui.js";
import { saveGlobalMailSettings, loadGlobalMailSettings } from "./cloud.js";

const DEFAULT_SUBJECT = "Hesap Özeti Raporu";
const DEFAULT_BODY = "Sayın yetkili, hesap özeti raporunuz ektedir.";

export async function setupSettings() {
  const form = document.getElementById("globalMailSettingsForm");
  const subjectInput = document.getElementById("globalMailSubject");
  const bodyInput = document.getElementById("globalMailBody");

  if (!form || !subjectInput || !bodyInput) return;

  const saved = await loadGlobalMailSettings();

  state.settings.defaultSubject = saved?.subject || state.settings.defaultSubject || DEFAULT_SUBJECT;
  state.settings.defaultBody = saved?.body || state.settings.defaultBody || DEFAULT_BODY;

  subjectInput.value = state.settings.defaultSubject;
  bodyInput.value = state.settings.defaultBody;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const subject = sanitizeText(subjectInput.value || DEFAULT_SUBJECT);
    const body = sanitizeText(bodyInput.value || DEFAULT_BODY);

    state.settings.defaultSubject = subject;
    state.settings.defaultBody = body;

    try {
      await saveGlobalMailSettings({ subject, body });
      toast("Toplu mail ayarları kaydedildi.");
    } catch (error) {
      console.error(error);
      toast("Ayar kaydı sırasında hata oluştu.");
    }
  });
}
