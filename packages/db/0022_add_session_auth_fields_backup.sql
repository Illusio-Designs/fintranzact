CREATE TYPE public.session_auth_method AS ENUM ('cookie', 'bearer');
--> statement-breakpoint
ALTER TABLE public.sessions
  ADD COLUMN auth_method public.session_auth_method NOT NULL DEFAULT 'cookie';
--> statement-breakpoint
ALTER TABLE public.sessions
  ADD COLUMN max_expires_at timestamp with time zone;
