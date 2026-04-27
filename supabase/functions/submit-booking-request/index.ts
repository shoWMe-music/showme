import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { name, email, phone, artistName, wantedDate, artistFee, note, targetProfileSlug, targetRole, source, musicUrl, videoUrl } = body;

    if (!name || !email || !artistName || !wantedDate) {
      return new Response(JSON.stringify({ error: "Missing required fields: name, email, artistName, wantedDate" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error } = await supabase.from("booking_requests").insert({
      name,
      email,
      phone: phone || "",
      artist_name: artistName,
      wanted_date: wantedDate,
      artist_fee: artistFee ? parseFloat(artistFee) : null,
      note: note || "",
      target_profile_slug: targetProfileSlug || "",
      target_role: targetRole || "",
      source: source || "widget",
      music_url: musicUrl || "",
      video_url: videoUrl || "",
    });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
