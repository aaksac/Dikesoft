const SECRET_TOKEN = 'AliDikesoft2026MailToken';

function doPost(e) {
  try {
    const data = JSON.parse(
      e.postData && e.postData.contents ? e.postData.contents : '{}'
    );

    if (!data.token || data.token !== SECRET_TOKEN) {
      return json({ ok: false, error: 'Yetkisiz istek.' });
    }

    if (!data.to) {
      return json({ ok: false, error: 'Alıcı mail adresi eksik.' });
    }

    const subject = data.subject || 'Dikesoft Raporu';
    const body = data.body || 'Sayın yetkili, hesap özeti raporunuz ektedir.';
    const htmlBody = data.html || body.replace(/\n/g, '<br>');
    const fromName = data.fromName || 'Veriteam';
    const filename = data.filename || 'rapor.pdf';

    const options = {
      name: fromName,
      htmlBody: htmlBody
    };

    if (data.pdfBase64) {
      const cleanBase64 = String(data.pdfBase64).replace(/^data:application\/pdf;base64,/, '');
      const blob = Utilities.newBlob(
        Utilities.base64Decode(cleanBase64),
        MimeType.PDF,
        filename
      );
      options.attachments = [blob];
    }

    GmailApp.sendEmail(data.to, subject, body, options);

    return json({ ok: true, message: 'Mail başarıyla gönderildi.' });
  } catch (err) {
    return json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function doGet() {
  return json({ ok: true, message: 'Dikesoft Gmail Apps Script çalışıyor.' });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
