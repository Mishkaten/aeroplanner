/** True when this build is connected to a Supabase project (the shared testing site). Otherwise it is the browser-only demo. */
export const WORKSPACE_MODE = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const FEEDBACK_EMAIL = "mishkaten@gmail.com";
