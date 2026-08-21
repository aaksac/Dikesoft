const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY) {
      return Response.json(
        { error: "RESEND_API_KEY Supabase Function Secret olarak tanımlanmamış." },
        { status: 500, headers: corsHeaders }
      );
    }

    const {
      fromName,
      fromEmail,
      to,
      subject,
      html,
      filename,
      pdfBase64
    } = await req.json();

    if (!to || !pdfBase64) {
      return Response.json(
        { error: "to ve pdfBase64 zorunludur." },
        { status: 400, headers: corsHeaders }
      );
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${fromName || "Dikesoft"} <${fromEmail || "onboarding@resend.dev"}>`,
        to: [to],
        subject: subject || "Dikesoft Raporu",
        html: html || "<p>Raporunuz ektedir.</p>",
        attachments: [
          {
            filename: filename || "rapor.pdf",
            content: pdfBase64
          }
        ]
      })
    });

    const data = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      return Response.json(
        { error: data?.message || data?.error || "Resend mail gönderemedi.", detail: data },
        { status: resendResponse.status, headers: corsHeaders }
      );
    }

    return Response.json({ ok: true, data }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error?.message || String(error) },
      { status: 500, headers: corsHeaders }
    );
  }
});
