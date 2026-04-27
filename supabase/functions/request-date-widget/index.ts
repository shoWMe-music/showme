const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") || "";
  const role = url.searchParams.get("role") || "venue";
  const submitUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/submit-booking-request`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Request a Date</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #fff; color: #1a1a2e; padding: 24px; }
    h2 { font-size: 20px; font-weight: 700; margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #555; }
    input, textarea { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; margin-bottom: 12px; font-family: inherit; }
    input:focus, textarea:focus { outline: none; border-color: #e85d3a; box-shadow: 0 0 0 2px rgba(232,93,58,0.15); }
    textarea { resize: vertical; min-height: 60px; }
    button { width: 100%; padding: 10px; background: #e85d3a; color: #fff; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #d14e2d; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .success { text-align: center; padding: 32px 16px; }
    .success h3 { color: #16a34a; font-size: 18px; margin-bottom: 8px; }
    .error { color: #dc2626; font-size: 13px; margin-bottom: 8px; }
    .req { color: #e85d3a; }
  </style>
</head>
<body>
  <div id="form-container">
    <h2>Request a Date</h2>
    <div id="error" class="error" style="display:none"></div>
    <label>Name <span class="req">*</span></label>
    <input id="name" placeholder="Your name" />
    <label>Email <span class="req">*</span></label>
    <input id="email" type="email" placeholder="your@email.com" />
    <label>Phone</label>
    <input id="phone" type="tel" placeholder="+1 234 567 890" />
    <label>Artist / Performer Name <span class="req">*</span></label>
    <input id="artistName" placeholder="Artist or performer name" />
    <label>Wanted Date (DD/MM/YY or MM/YY) <span class="req">*</span></label>
    <input id="wantedDate" placeholder="e.g. 15/06/26 or 06/26" />
    <label>Artist / Performer Fee (optional)</label>
    <input id="artistFee" type="number" placeholder="e.g. 5000" />
    <label>Note</label>
    <textarea id="note" placeholder="Additional details..."></textarea>
    <label>Link to Music</label>
    <input id="musicUrl" placeholder="https://open.spotify.com/..." />
    <label>Link to Live Video</label>
    <input id="videoUrl" placeholder="https://youtube.com/..." />
    <button id="submitBtn" onclick="submitForm()">Submit Request</button>
  </div>
  <div id="success" class="success" style="display:none">
    <h3>✓ Request Submitted!</h3>
    <p>Your booking request has been sent successfully. We'll be in touch soon.</p>
  </div>
  <script>
    async function submitForm() {
      const btn = document.getElementById('submitBtn');
      const errEl = document.getElementById('error');
      errEl.style.display = 'none';
      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const artistName = document.getElementById('artistName').value.trim();
      const wantedDate = document.getElementById('wantedDate').value.trim();
      if (!name || !email || !artistName || !wantedDate) {
        errEl.textContent = 'Please fill in all required fields.';
        errEl.style.display = 'block';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      try {
        const res = await fetch('${submitUrl}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, email,
            phone: document.getElementById('phone').value.trim(),
            artistName, wantedDate,
            artistFee: document.getElementById('artistFee').value || null,
            note: document.getElementById('note').value.trim(),
            musicUrl: document.getElementById('musicUrl').value.trim(),
            videoUrl: document.getElementById('videoUrl').value.trim(),
            targetProfileSlug: '${slug}',
            targetRole: '${role}',
            source: 'widget'
          })
        });
        if (!res.ok) throw new Error('Failed');
        document.getElementById('form-container').style.display = 'none';
        document.getElementById('success').style.display = 'block';
      } catch(e) {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Submit Request';
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
});
