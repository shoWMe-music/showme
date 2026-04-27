import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const eventId = url.searchParams.get("eventId");
    const emailParam = url.searchParams.get("email");

    if (!token || !eventId) {
      return new Response(JSON.stringify({ error: "token and eventId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine the user's email: try JWT first, fall back to email query param
    let userEmail = "";
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader !== `Bearer ${supabaseAnonKey}`) {
      try {
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user?.email) userEmail = user.email.toLowerCase().trim();
      } catch {
        // JWT invalid, fall through to email param
      }
    }

    // Fall back to email query param (mock auth)
    if (!userEmail && emailParam) {
      userEmail = emailParam.toLowerCase().trim();
    }

    if (!userEmail) {
      return new Response(JSON.stringify({ error: "Authentication required. Provide a valid session or email.", code: "AUTH_REQUIRED" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: shareToken, error: fetchError } = await serviceClient
      .from("share_tokens")
      .select("*")
      .eq("token", token)
      .eq("event_id", eventId)
      .single();

    if (fetchError || !shareToken) {
      return new Response(JSON.stringify({ error: "Share link not found or expired", code: "NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user's email is in the recipients list
    const recipients: string[] = (shareToken.recipients as string[]) || [];
    const isAuthorized = recipients.some((r: string) => r.toLowerCase().trim() === userEmail);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ 
        error: "Access denied. Your email is not authorized to view this shared event.",
        code: "ACCESS_DENIED",
        email: userEmail,
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return the snapshot data and metadata
    const parties = shareToken.parties as any;
    return new Response(JSON.stringify({
      snapshot: shareToken.snapshot_data,
      sections: shareToken.sections,
      parties: {
        createdBy: parties?.createdBy || shareToken.created_by,
        createdAt: parties?.createdAt || shareToken.created_at,
        tabs: parties?.tabs || [],
        sections: parties?.sections || [],
        level: parties?.level || "all",
      },
      eventId: shareToken.event_id,
    }), {
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
