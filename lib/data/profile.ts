import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
}

export async function getCurrentUserProfile(): Promise<UserProfile> {
  if (!isSupabaseConfigured()) {
    return { id: "demo", email: "demo@havnline.example", fullName: "Demo User" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { id: "demo", email: "demo@havnline.example", fullName: "Demo User" };
  }

  const { data: profileRow } = await supabase.from("users").select("full_name").eq("id", user.id).maybeSingle();

  const fullName = profileRow?.full_name || (user.user_metadata?.full_name as string | undefined) || user.email?.split("@")[0] || "";

  return { id: user.id, email: user.email || "", fullName };
}
