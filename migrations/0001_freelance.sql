-- Freelance: sellers, services, packages, orders and payments, order room,
-- reviews, tasks, proposals and invites (final state of platform migrations
-- 0050, 0055, 0056, 0062, 0069, 0071, 0072, 0073, 0084). Idempotent.

CREATE TABLE IF NOT EXISTS public.freelance_client_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seller_id uuid,
    buyer_id uuid NOT NULL,
    rating smallint NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_client_reviews_body_check CHECK ((char_length(body) <= 1000)),
    CONSTRAINT freelance_client_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

ALTER TABLE ONLY public.freelance_client_reviews FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    author_id uuid,
    body text NOT NULL,
    links text[] DEFAULT '{}'::text[] NOT NULL,
    hidden_at timestamp with time zone,
    hidden_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000))),
    CONSTRAINT freelance_messages_links_check CHECK ((cardinality(links) <= 5))
);

ALTER TABLE ONLY public.freelance_messages FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_order_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.freelance_order_history FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_order_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    buyer_id uuid,
    chain text NOT NULL,
    token text NOT NULL,
    token_contract text NOT NULL,
    recipient text NOT NULL,
    payer_address text NOT NULL,
    amount_minor bigint NOT NULL,
    token_amount numeric(30,0) NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    reason text,
    tx_hash text,
    expires_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_order_payments_amount_check CHECK (((amount_minor >= 1000) AND (amount_minor <= 2000000))),
    CONSTRAINT freelance_order_payments_recipient_check CHECK ((recipient ~ '^0x[0-9a-f]{40}$'::text)),
    CONSTRAINT freelance_order_payments_status_check CHECK ((status = ANY (ARRAY['open'::text, 'submitted'::text, 'confirmed'::text, 'failed'::text, 'frozen'::text]))),
    CONSTRAINT freelance_order_payments_token_check CHECK ((token = ANY (ARRAY['USDC'::text, 'USDT'::text]))),
    CONSTRAINT freelance_order_payments_tx_check CHECK (((tx_hash IS NULL) OR (tx_hash ~ '^0x[0-9a-f]{64}$'::text)))
);

ALTER TABLE ONLY public.freelance_order_payments FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    seller_id uuid,
    buyer_id uuid,
    buyer_company_id uuid,
    service_title text NOT NULL,
    package_tier text NOT NULL,
    price_minor bigint NOT NULL,
    delivery_days integer NOT NULL,
    revisions_left integer NOT NULL,
    task text NOT NULL,
    wanted_by text,
    status text DEFAULT 'sent'::text NOT NULL,
    delivery_url text,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    started_at timestamp with time zone,
    delivered_at timestamp with time zone,
    auto_complete_at timestamp with time zone,
    completed_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_orders_days_check CHECK (((delivery_days >= 1) AND (delivery_days <= 90))),
    CONSTRAINT freelance_orders_delivery_url_check CHECK (((delivery_url IS NULL) OR (delivery_url ~ '^https://'::text))),
    CONSTRAINT freelance_orders_not_self CHECK (((seller_id IS NULL) OR (buyer_id IS NULL) OR (seller_id <> buyer_id))),
    CONSTRAINT freelance_orders_price_check CHECK (((price_minor >= 1000) AND (price_minor <= 2000000))),
    CONSTRAINT freelance_orders_revisions_check CHECK (((revisions_left >= 0) AND (revisions_left <= 10))),
    CONSTRAINT freelance_orders_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'accepted'::text, 'in_progress'::text, 'delivered'::text, 'completed'::text, 'declined'::text, 'cancelled'::text, 'expired'::text]))),
    CONSTRAINT freelance_orders_task_len CHECK (((char_length(task) >= 20) AND (char_length(task) <= 2000))),
    CONSTRAINT freelance_orders_tier_check CHECK ((package_tier = ANY (ARRAY['basic'::text, 'standard'::text, 'pro'::text]))),
    CONSTRAINT freelance_orders_wanted_len CHECK (((wanted_by IS NULL) OR ((char_length(wanted_by) >= 1) AND (char_length(wanted_by) <= 80))))
);

ALTER TABLE ONLY public.freelance_orders FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    tier text NOT NULL,
    price_minor bigint NOT NULL,
    delivery_days integer NOT NULL,
    revisions integer NOT NULL,
    includes text[] NOT NULL,
    CONSTRAINT freelance_packages_days_check CHECK (((delivery_days >= 1) AND (delivery_days <= 90))),
    CONSTRAINT freelance_packages_includes_count CHECK (((cardinality(includes) >= 1) AND (cardinality(includes) <= 8))),
    CONSTRAINT freelance_packages_price_check CHECK (((price_minor >= 1000) AND (price_minor <= 2000000))),
    CONSTRAINT freelance_packages_revisions_check CHECK (((revisions >= 0) AND (revisions <= 10))),
    CONSTRAINT freelance_packages_tier_check CHECK ((tier = ANY (ARRAY['basic'::text, 'standard'::text, 'pro'::text])))
);

ALTER TABLE ONLY public.freelance_packages FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    price_minor bigint NOT NULL,
    delivery_days integer NOT NULL,
    cover text NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_proposals_cover_check CHECK (((char_length(cover) >= 40) AND (char_length(cover) <= 2000))),
    CONSTRAINT freelance_proposals_days_check CHECK (((delivery_days >= 1) AND (delivery_days <= 90))),
    CONSTRAINT freelance_proposals_price_check CHECK (((price_minor >= 1000) AND (price_minor <= 2000000))),
    CONSTRAINT freelance_proposals_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text])))
);

ALTER TABLE ONLY public.freelance_proposals FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    service_id uuid NOT NULL,
    author_id uuid,
    author_kind text NOT NULL,
    rating smallint NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_reviews_body_len CHECK ((char_length(body) <= 1000)),
    CONSTRAINT freelance_reviews_kind_check CHECK ((author_kind = ANY (ARRAY['person'::text, 'company'::text]))),
    CONSTRAINT freelance_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

ALTER TABLE ONLY public.freelance_reviews FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_sellers (
    user_id uuid NOT NULL,
    accepting boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.freelance_sellers FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_service_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    draft jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_service_drafts_object_check CHECK ((jsonb_typeof(draft) = 'object'::text))
);

ALTER TABLE ONLY public.freelance_service_drafts FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    seller_id uuid NOT NULL,
    title text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    buyer_needs text DEFAULT ''::text NOT NULL,
    languages text[] NOT NULL,
    skill_slugs text[] DEFAULT '{}'::text[] NOT NULL,
    links text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    moderation_note text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_services_category_check CHECK ((category = ANY (ARRAY['operations'::text, 'community'::text, 'growth'::text, 'product'::text, 'development'::text, 'web3'::text, 'people'::text, 'research'::text, 'design'::text, 'communications'::text]))),
    CONSTRAINT freelance_services_description_len CHECK (((char_length(description) >= 80) AND (char_length(description) <= 1500))),
    CONSTRAINT freelance_services_languages_check CHECK ((((cardinality(languages) >= 1) AND (cardinality(languages) <= 5)) AND (array_to_string(languages, ','::text) ~ '^[a-z]{2}(,[a-z]{2})*$'::text))),
    CONSTRAINT freelance_services_links_count CHECK ((cardinality(links) <= 5)),
    CONSTRAINT freelance_services_needs_len CHECK ((char_length(buyer_needs) <= 800)),
    CONSTRAINT freelance_services_skills_count CHECK ((cardinality(skill_slugs) <= 6)),
    CONSTRAINT freelance_services_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'published'::text, 'paused'::text, 'rejected'::text, 'removed'::text]))),
    CONSTRAINT freelance_services_title_len CHECK (((char_length(title) >= 10) AND (char_length(title) <= 80)))
);

ALTER TABLE ONLY public.freelance_services FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_task_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.freelance_task_invites FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    buyer_company_id uuid,
    title text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    budget_min_minor bigint,
    budget_max_minor bigint,
    wanted_by text,
    status text DEFAULT 'pending'::text NOT NULL,
    moderation_note text,
    hired_order_id uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_tasks_budget_check CHECK ((((budget_min_minor IS NULL) OR ((budget_min_minor >= 1000) AND (budget_min_minor <= 2000000))) AND ((budget_max_minor IS NULL) OR ((budget_max_minor >= 1000) AND (budget_max_minor <= 2000000))) AND ((budget_min_minor IS NULL) OR (budget_max_minor IS NULL) OR (budget_min_minor <= budget_max_minor)))),
    CONSTRAINT freelance_tasks_description_check CHECK (((char_length(description) >= 80) AND (char_length(description) <= 2000))),
    CONSTRAINT freelance_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'open'::text, 'hired'::text, 'closed'::text, 'expired'::text, 'rejected'::text]))),
    CONSTRAINT freelance_tasks_title_check CHECK (((char_length(title) >= 10) AND (char_length(title) <= 120))),
    CONSTRAINT freelance_tasks_wanted_by_check CHECK (((wanted_by IS NULL) OR (char_length(wanted_by) <= 80)))
);

ALTER TABLE ONLY public.freelance_tasks FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.freelance_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT freelance_threads_subject_type_check CHECK ((subject_type = 'order'::text))
);

ALTER TABLE ONLY public.freelance_threads FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_client_reviews_order_key') THEN
    ALTER TABLE public.freelance_client_reviews ADD CONSTRAINT freelance_client_reviews_order_key UNIQUE (order_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_client_reviews_pkey') THEN
    ALTER TABLE public.freelance_client_reviews ADD CONSTRAINT freelance_client_reviews_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_messages_pkey') THEN
    ALTER TABLE public.freelance_messages ADD CONSTRAINT freelance_messages_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_order_history_pkey') THEN
    ALTER TABLE public.freelance_order_history ADD CONSTRAINT freelance_order_history_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_order_payments_pkey') THEN
    ALTER TABLE public.freelance_order_payments ADD CONSTRAINT freelance_order_payments_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_orders_pkey') THEN
    ALTER TABLE public.freelance_orders ADD CONSTRAINT freelance_orders_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_packages_pkey') THEN
    ALTER TABLE public.freelance_packages ADD CONSTRAINT freelance_packages_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_packages_service_tier_key') THEN
    ALTER TABLE public.freelance_packages ADD CONSTRAINT freelance_packages_service_tier_key UNIQUE (service_id, tier);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_proposals_pkey') THEN
    ALTER TABLE public.freelance_proposals ADD CONSTRAINT freelance_proposals_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_proposals_task_seller_key') THEN
    ALTER TABLE public.freelance_proposals ADD CONSTRAINT freelance_proposals_task_seller_key UNIQUE (task_id, seller_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_reviews_order_key') THEN
    ALTER TABLE public.freelance_reviews ADD CONSTRAINT freelance_reviews_order_key UNIQUE (order_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_reviews_pkey') THEN
    ALTER TABLE public.freelance_reviews ADD CONSTRAINT freelance_reviews_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_sellers_pkey') THEN
    ALTER TABLE public.freelance_sellers ADD CONSTRAINT freelance_sellers_pkey PRIMARY KEY (user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_service_drafts_pkey') THEN
    ALTER TABLE public.freelance_service_drafts ADD CONSTRAINT freelance_service_drafts_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_service_drafts_user_id_key') THEN
    ALTER TABLE public.freelance_service_drafts ADD CONSTRAINT freelance_service_drafts_user_id_key UNIQUE (user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_services_pkey') THEN
    ALTER TABLE public.freelance_services ADD CONSTRAINT freelance_services_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_services_slug_key') THEN
    ALTER TABLE public.freelance_services ADD CONSTRAINT freelance_services_slug_key UNIQUE (slug);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_task_invites_pkey') THEN
    ALTER TABLE public.freelance_task_invites ADD CONSTRAINT freelance_task_invites_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_task_invites_task_seller_key') THEN
    ALTER TABLE public.freelance_task_invites ADD CONSTRAINT freelance_task_invites_task_seller_key UNIQUE (task_id, seller_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_tasks_pkey') THEN
    ALTER TABLE public.freelance_tasks ADD CONSTRAINT freelance_tasks_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_threads_pkey') THEN
    ALTER TABLE public.freelance_threads ADD CONSTRAINT freelance_threads_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_threads_subject_unique') THEN
    ALTER TABLE public.freelance_threads ADD CONSTRAINT freelance_threads_subject_unique UNIQUE (subject_type, subject_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS freelance_client_reviews_buyer_idx ON public.freelance_client_reviews USING btree (buyer_id);

CREATE INDEX IF NOT EXISTS freelance_messages_thread_idx ON public.freelance_messages USING btree (thread_id, created_at);

CREATE INDEX IF NOT EXISTS freelance_order_history_order_idx ON public.freelance_order_history USING btree (order_id, created_at);

CREATE INDEX IF NOT EXISTS freelance_order_payments_order_idx ON public.freelance_order_payments USING btree (order_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS freelance_order_payments_paid_idx ON public.freelance_order_payments USING btree (order_id) WHERE (status = 'confirmed'::text);

CREATE INDEX IF NOT EXISTS freelance_order_payments_submitted_idx ON public.freelance_order_payments USING btree (created_at) WHERE (status = 'submitted'::text);

CREATE UNIQUE INDEX IF NOT EXISTS freelance_order_payments_tx_idx ON public.freelance_order_payments USING btree (chain, tx_hash) WHERE (status = 'confirmed'::text);

CREATE INDEX IF NOT EXISTS freelance_orders_auto_complete_idx ON public.freelance_orders USING btree (status, auto_complete_at);

CREATE INDEX IF NOT EXISTS freelance_orders_buyer_idx ON public.freelance_orders USING btree (buyer_id, status);

CREATE INDEX IF NOT EXISTS freelance_orders_expires_idx ON public.freelance_orders USING btree (status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS freelance_orders_open_pair_idx ON public.freelance_orders USING btree (service_id, buyer_id) WHERE (status = ANY (ARRAY['sent'::text, 'accepted'::text, 'in_progress'::text, 'delivered'::text]));

CREATE INDEX IF NOT EXISTS freelance_orders_seller_idx ON public.freelance_orders USING btree (seller_id, status);

CREATE INDEX IF NOT EXISTS freelance_proposals_seller_idx ON public.freelance_proposals USING btree (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS freelance_reviews_service_idx ON public.freelance_reviews USING btree (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS freelance_service_drafts_updated_idx ON public.freelance_service_drafts USING btree (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS freelance_services_seller_idx ON public.freelance_services USING btree (seller_id);

CREATE INDEX IF NOT EXISTS freelance_services_skills_idx ON public.freelance_services USING gin (skill_slugs);

CREATE INDEX IF NOT EXISTS freelance_services_status_category_idx ON public.freelance_services USING btree (status, category);

CREATE INDEX IF NOT EXISTS freelance_task_invites_seller_idx ON public.freelance_task_invites USING btree (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS freelance_tasks_buyer_idx ON public.freelance_tasks USING btree (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS freelance_tasks_open_idx ON public.freelance_tasks USING btree (status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_client_reviews_buyer_id_fkey') THEN
    ALTER TABLE public.freelance_client_reviews ADD CONSTRAINT freelance_client_reviews_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_client_reviews_order_id_fkey') THEN
    ALTER TABLE public.freelance_client_reviews ADD CONSTRAINT freelance_client_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.freelance_orders(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_client_reviews_seller_id_fkey') THEN
    ALTER TABLE public.freelance_client_reviews ADD CONSTRAINT freelance_client_reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_messages_author_id_fkey') THEN
    ALTER TABLE public.freelance_messages ADD CONSTRAINT freelance_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_messages_hidden_by_fkey') THEN
    ALTER TABLE public.freelance_messages ADD CONSTRAINT freelance_messages_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_messages_thread_id_fkey') THEN
    ALTER TABLE public.freelance_messages ADD CONSTRAINT freelance_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.freelance_threads(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_order_history_actor_id_fkey') THEN
    ALTER TABLE public.freelance_order_history ADD CONSTRAINT freelance_order_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_order_history_order_id_fkey') THEN
    ALTER TABLE public.freelance_order_history ADD CONSTRAINT freelance_order_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.freelance_orders(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_order_payments_buyer_id_fkey') THEN
    ALTER TABLE public.freelance_order_payments ADD CONSTRAINT freelance_order_payments_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_order_payments_order_id_fkey') THEN
    ALTER TABLE public.freelance_order_payments ADD CONSTRAINT freelance_order_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.freelance_orders(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_orders_buyer_company_id_fkey') THEN
    ALTER TABLE public.freelance_orders ADD CONSTRAINT freelance_orders_buyer_company_id_fkey FOREIGN KEY (buyer_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_orders_buyer_id_fkey') THEN
    ALTER TABLE public.freelance_orders ADD CONSTRAINT freelance_orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_orders_seller_id_fkey') THEN
    ALTER TABLE public.freelance_orders ADD CONSTRAINT freelance_orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_orders_service_id_fkey') THEN
    ALTER TABLE public.freelance_orders ADD CONSTRAINT freelance_orders_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.freelance_services(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_packages_service_id_fkey') THEN
    ALTER TABLE public.freelance_packages ADD CONSTRAINT freelance_packages_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.freelance_services(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_proposals_seller_id_fkey') THEN
    ALTER TABLE public.freelance_proposals ADD CONSTRAINT freelance_proposals_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_proposals_task_id_fkey') THEN
    ALTER TABLE public.freelance_proposals ADD CONSTRAINT freelance_proposals_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.freelance_tasks(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_reviews_author_id_fkey') THEN
    ALTER TABLE public.freelance_reviews ADD CONSTRAINT freelance_reviews_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_reviews_order_id_fkey') THEN
    ALTER TABLE public.freelance_reviews ADD CONSTRAINT freelance_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.freelance_orders(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_reviews_service_id_fkey') THEN
    ALTER TABLE public.freelance_reviews ADD CONSTRAINT freelance_reviews_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.freelance_services(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_sellers_user_id_fkey') THEN
    ALTER TABLE public.freelance_sellers ADD CONSTRAINT freelance_sellers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_service_drafts_user_id_fkey') THEN
    ALTER TABLE public.freelance_service_drafts ADD CONSTRAINT freelance_service_drafts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_services_seller_id_fkey') THEN
    ALTER TABLE public.freelance_services ADD CONSTRAINT freelance_services_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_task_invites_invited_by_fkey') THEN
    ALTER TABLE public.freelance_task_invites ADD CONSTRAINT freelance_task_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_task_invites_seller_id_fkey') THEN
    ALTER TABLE public.freelance_task_invites ADD CONSTRAINT freelance_task_invites_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_task_invites_task_id_fkey') THEN
    ALTER TABLE public.freelance_task_invites ADD CONSTRAINT freelance_task_invites_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.freelance_tasks(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_tasks_buyer_company_id_fkey') THEN
    ALTER TABLE public.freelance_tasks ADD CONSTRAINT freelance_tasks_buyer_company_id_fkey FOREIGN KEY (buyer_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_tasks_buyer_id_fkey') THEN
    ALTER TABLE public.freelance_tasks ADD CONSTRAINT freelance_tasks_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'freelance_tasks_hired_order_id_fkey') THEN
    ALTER TABLE public.freelance_tasks ADD CONSTRAINT freelance_tasks_hired_order_id_fkey FOREIGN KEY (hired_order_id) REFERENCES public.freelance_orders(id) ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE public.freelance_client_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_client_reviews' AND policyname = 'freelance_client_reviews_anon_deny') THEN
    CREATE POLICY freelance_client_reviews_anon_deny ON public.freelance_client_reviews TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_client_reviews' AND policyname = 'freelance_client_reviews_app_rw_all') THEN
    CREATE POLICY freelance_client_reviews_app_rw_all ON public.freelance_client_reviews TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_client_reviews' AND policyname = 'freelance_client_reviews_authenticated_deny') THEN
    CREATE POLICY freelance_client_reviews_authenticated_deny ON public.freelance_client_reviews TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_messages' AND policyname = 'freelance_messages_anon_deny') THEN
    CREATE POLICY freelance_messages_anon_deny ON public.freelance_messages TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_messages' AND policyname = 'freelance_messages_app_rw_all') THEN
    CREATE POLICY freelance_messages_app_rw_all ON public.freelance_messages TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_messages' AND policyname = 'freelance_messages_authenticated_deny') THEN
    CREATE POLICY freelance_messages_authenticated_deny ON public.freelance_messages TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_order_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_order_history' AND policyname = 'freelance_order_history_anon_deny') THEN
    CREATE POLICY freelance_order_history_anon_deny ON public.freelance_order_history TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_order_history' AND policyname = 'freelance_order_history_app_rw_all') THEN
    CREATE POLICY freelance_order_history_app_rw_all ON public.freelance_order_history TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_order_history' AND policyname = 'freelance_order_history_authenticated_deny') THEN
    CREATE POLICY freelance_order_history_authenticated_deny ON public.freelance_order_history TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_order_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_order_payments' AND policyname = 'freelance_order_payments_anon_deny') THEN
    CREATE POLICY freelance_order_payments_anon_deny ON public.freelance_order_payments TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_order_payments' AND policyname = 'freelance_order_payments_app_rw_all') THEN
    CREATE POLICY freelance_order_payments_app_rw_all ON public.freelance_order_payments TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_order_payments' AND policyname = 'freelance_order_payments_authenticated_deny') THEN
    CREATE POLICY freelance_order_payments_authenticated_deny ON public.freelance_order_payments TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_orders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_orders' AND policyname = 'freelance_orders_anon_deny') THEN
    CREATE POLICY freelance_orders_anon_deny ON public.freelance_orders TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_orders' AND policyname = 'freelance_orders_app_rw_all') THEN
    CREATE POLICY freelance_orders_app_rw_all ON public.freelance_orders TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_orders' AND policyname = 'freelance_orders_authenticated_deny') THEN
    CREATE POLICY freelance_orders_authenticated_deny ON public.freelance_orders TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_packages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_packages' AND policyname = 'freelance_packages_anon_deny') THEN
    CREATE POLICY freelance_packages_anon_deny ON public.freelance_packages TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_packages' AND policyname = 'freelance_packages_app_rw_all') THEN
    CREATE POLICY freelance_packages_app_rw_all ON public.freelance_packages TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_packages' AND policyname = 'freelance_packages_authenticated_deny') THEN
    CREATE POLICY freelance_packages_authenticated_deny ON public.freelance_packages TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_proposals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_proposals' AND policyname = 'freelance_proposals_anon_deny') THEN
    CREATE POLICY freelance_proposals_anon_deny ON public.freelance_proposals TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_proposals' AND policyname = 'freelance_proposals_app_rw_all') THEN
    CREATE POLICY freelance_proposals_app_rw_all ON public.freelance_proposals TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_proposals' AND policyname = 'freelance_proposals_authenticated_deny') THEN
    CREATE POLICY freelance_proposals_authenticated_deny ON public.freelance_proposals TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_reviews' AND policyname = 'freelance_reviews_anon_deny') THEN
    CREATE POLICY freelance_reviews_anon_deny ON public.freelance_reviews TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_reviews' AND policyname = 'freelance_reviews_app_rw_all') THEN
    CREATE POLICY freelance_reviews_app_rw_all ON public.freelance_reviews TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_reviews' AND policyname = 'freelance_reviews_authenticated_deny') THEN
    CREATE POLICY freelance_reviews_authenticated_deny ON public.freelance_reviews TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_sellers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_sellers' AND policyname = 'freelance_sellers_anon_deny') THEN
    CREATE POLICY freelance_sellers_anon_deny ON public.freelance_sellers TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_sellers' AND policyname = 'freelance_sellers_app_rw_all') THEN
    CREATE POLICY freelance_sellers_app_rw_all ON public.freelance_sellers TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_sellers' AND policyname = 'freelance_sellers_authenticated_deny') THEN
    CREATE POLICY freelance_sellers_authenticated_deny ON public.freelance_sellers TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_service_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_service_drafts' AND policyname = 'freelance_service_drafts_anon_deny') THEN
    CREATE POLICY freelance_service_drafts_anon_deny ON public.freelance_service_drafts TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_service_drafts' AND policyname = 'freelance_service_drafts_app_rw_all') THEN
    CREATE POLICY freelance_service_drafts_app_rw_all ON public.freelance_service_drafts TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_service_drafts' AND policyname = 'freelance_service_drafts_authenticated_deny') THEN
    CREATE POLICY freelance_service_drafts_authenticated_deny ON public.freelance_service_drafts TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_services ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_services' AND policyname = 'freelance_services_anon_deny') THEN
    CREATE POLICY freelance_services_anon_deny ON public.freelance_services TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_services' AND policyname = 'freelance_services_app_rw_all') THEN
    CREATE POLICY freelance_services_app_rw_all ON public.freelance_services TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_services' AND policyname = 'freelance_services_authenticated_deny') THEN
    CREATE POLICY freelance_services_authenticated_deny ON public.freelance_services TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_task_invites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_task_invites' AND policyname = 'freelance_task_invites_anon_deny') THEN
    CREATE POLICY freelance_task_invites_anon_deny ON public.freelance_task_invites TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_task_invites' AND policyname = 'freelance_task_invites_app_rw_all') THEN
    CREATE POLICY freelance_task_invites_app_rw_all ON public.freelance_task_invites TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_task_invites' AND policyname = 'freelance_task_invites_authenticated_deny') THEN
    CREATE POLICY freelance_task_invites_authenticated_deny ON public.freelance_task_invites TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_tasks' AND policyname = 'freelance_tasks_anon_deny') THEN
    CREATE POLICY freelance_tasks_anon_deny ON public.freelance_tasks TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_tasks' AND policyname = 'freelance_tasks_app_rw_all') THEN
    CREATE POLICY freelance_tasks_app_rw_all ON public.freelance_tasks TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_tasks' AND policyname = 'freelance_tasks_authenticated_deny') THEN
    CREATE POLICY freelance_tasks_authenticated_deny ON public.freelance_tasks TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.freelance_threads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_threads' AND policyname = 'freelance_threads_anon_deny') THEN
    CREATE POLICY freelance_threads_anon_deny ON public.freelance_threads TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_threads' AND policyname = 'freelance_threads_app_rw_all') THEN
    CREATE POLICY freelance_threads_app_rw_all ON public.freelance_threads TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'freelance_threads' AND policyname = 'freelance_threads_authenticated_deny') THEN
    CREATE POLICY freelance_threads_authenticated_deny ON public.freelance_threads TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

-- Table rights for the app role, as on the platform.
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_client_reviews TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_messages TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_order_history TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_order_payments TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_orders TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_packages TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_proposals TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_reviews TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_sellers TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_service_drafts TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_services TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_task_invites TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_tasks TO app_rw;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.freelance_threads TO app_rw;
