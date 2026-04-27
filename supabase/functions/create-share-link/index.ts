import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.99.1/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Try to get user from auth header (optional - app may not have auth yet)
    let creatorEmail = "Unknown";
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader !== `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`) {
      try {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user?.email) creatorEmail = user.email;
      } catch {
        // Not authenticated, continue without user context
      }
    }

    const body = await req.json();
    const { eventId, recipients, snapshotData, sections, tabs, level, creatorName } = body;

    if (!eventId || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return new Response(JSON.stringify({ error: "eventId and at least one recipient email are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipients.filter((r: string) => !emailRegex.test(r));
    if (invalidEmails.length > 0) {
      return new Response(JSON.stringify({ error: `Invalid email(s): ${invalidEmails.join(", ")}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = crypto.randomUUID();
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const normalizedRecipients = recipients.map((e: string) => e.toLowerCase().trim());
    const creator = creatorName || creatorEmail;

    const { error: insertError } = await serviceClient.from("share_tokens").insert({
      token,
      event_id: eventId,
      recipients: normalizedRecipients,
      snapshot_data: snapshotData || {},
      sections: sections || [],
      created_by: creator,
      parties: {
        recipients: normalizedRecipients,
        createdBy: creator,
        createdAt: new Date().toISOString(),
        tabs: tabs || [],
        sections: sections || [],
        level: level || "all",
      },
    });

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
