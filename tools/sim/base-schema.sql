--
-- PostgreSQL database dump
--

\restrict p8tFcI9FSGa8Z8LJSzy0AUF6QfRJh5UHD4R1NyFVLgIfqDaWrpafgLiTsLJcps9

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: is_business_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_business_member(target_business_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select exists (
    select 1 from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
  );
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_receptionists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_receptionists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    name text DEFAULT 'Alex'::text NOT NULL,
    personality text DEFAULT 'professional'::text NOT NULL,
    responsibilities jsonb DEFAULT '{"answer_questions": true, "escalate_to_human": true, "cancel_appointments": false, "collect_customer_info": true, "schedule_appointments": true, "reschedule_appointments": true}'::jsonb NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    escalation_rules text,
    booking_rules text,
    generated_instructions text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_receptionists_personality_check CHECK ((personality = ANY (ARRAY['professional'::text, 'friendly'::text, 'warm'::text, 'energetic'::text, 'calm'::text]))),
    CONSTRAINT ai_receptionists_status_check CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text])))
);


--
-- Name: ai_voice_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_voice_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    voice_id text NOT NULL,
    provider text,
    provider_voice_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_voice_name text,
    CONSTRAINT ai_voice_configs_voice_id_check CHECK ((voice_id = ANY (ARRAY['alex_professional'::text, 'sarah_warm'::text, 'james_calm'::text, 'emma_friendly'::text, 'custom'::text])))
);


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    customer_id uuid,
    customer_name text NOT NULL,
    phone text NOT NULL,
    service_id uuid,
    service_name text NOT NULL,
    date date NOT NULL,
    "time" text NOT NULL,
    status text DEFAULT 'confirmed'::text NOT NULL,
    created_via text DEFAULT 'ai'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reminder_sent_at timestamp with time zone,
    sms_consent boolean DEFAULT false NOT NULL,
    CONSTRAINT appointments_created_via_check CHECK ((created_via = ANY (ARRAY['ai'::text, 'human'::text]))),
    CONSTRAINT appointments_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'pending'::text, 'cancelled'::text, 'completed'::text, 'no_show'::text])))
);


--
-- Name: business_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    weekday text NOT NULL,
    is_open boolean DEFAULT true NOT NULL,
    open_time time without time zone,
    close_time time without time zone,
    CONSTRAINT business_hours_weekday_check CHECK ((weekday = ANY (ARRAY['monday'::text, 'tuesday'::text, 'wednesday'::text, 'thursday'::text, 'friday'::text, 'saturday'::text, 'sunday'::text])))
);


--
-- Name: business_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


--
-- Name: businesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.businesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    business_type text,
    description text,
    address text,
    phone text,
    website text,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    onboarding_step text DEFAULT 'business_info'::text NOT NULL,
    onboarding_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_status text DEFAULT 'none'::text NOT NULL,
    current_period_end timestamp with time zone,
    notification_preferences jsonb DEFAULT '{"calls": false, "digest": false, "escalations": true}'::jsonb NOT NULL,
    is_suspended boolean DEFAULT false NOT NULL,
    suspended_at timestamp with time zone,
    suspended_reason text,
    CONSTRAINT businesses_onboarding_step_check CHECK ((onboarding_step = ANY (ARRAY['business_info'::text, 'hours'::text, 'services'::text, 'ai_receptionist'::text, 'voice'::text, 'calendar'::text, 'complete'::text]))),
    CONSTRAINT businesses_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['none'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text])))
);


--
-- Name: call_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    tool_call jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT call_messages_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'ai'::text, 'system'::text])))
);


--
-- Name: calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    customer_id uuid,
    customer_name text NOT NULL,
    phone text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    outcome text DEFAULT 'no_action'::text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    handled_by text DEFAULT 'ai'::text NOT NULL,
    escalation_reason text,
    recording_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calls_handled_by_check CHECK ((handled_by = ANY (ARRAY['ai'::text, 'human'::text]))),
    CONSTRAINT calls_outcome_check CHECK ((outcome = ANY (ARRAY['appointment_booked'::text, 'question_answered'::text, 'escalated'::text, 'no_action'::text, 'missed'::text]))),
    CONSTRAINT calls_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'in_progress'::text, 'missed'::text, 'voicemail'::text])))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_blocked boolean DEFAULT false NOT NULL,
    blocked_at timestamp with time zone
);


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'not_connected'::text NOT NULL,
    external_account_id text,
    connected_at timestamp with time zone,
    metadata jsonb,
    CONSTRAINT integrations_provider_check CHECK ((provider = ANY (ARRAY['google_calendar'::text, 'icloud_calendar'::text, 'microsoft_outlook'::text, 'twilio'::text, 'sms'::text, 'voice_provider'::text]))),
    CONSTRAINT integrations_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'not_connected'::text, 'coming_soon'::text])))
);


--
-- Name: knowledge_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    category text DEFAULT 'custom'::text NOT NULL,
    question text,
    title text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_items_category_check CHECK ((category = ANY (ARRAY['business_info'::text, 'services'::text, 'pricing'::text, 'faq'::text, 'policy'::text, 'custom'::text])))
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    applies_to text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_hits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rate_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_name text NOT NULL,
    reviewer_name text NOT NULL,
    rating integer NOT NULL,
    review_text text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    price_cents integer DEFAULT 0 NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_receptionists ai_receptionists_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_receptionists
    ADD CONSTRAINT ai_receptionists_business_id_key UNIQUE (business_id);


--
-- Name: ai_receptionists ai_receptionists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_receptionists
    ADD CONSTRAINT ai_receptionists_pkey PRIMARY KEY (id);


--
-- Name: ai_voice_configs ai_voice_configs_business_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_configs
    ADD CONSTRAINT ai_voice_configs_business_id_key UNIQUE (business_id);


--
-- Name: ai_voice_configs ai_voice_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_configs
    ADD CONSTRAINT ai_voice_configs_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: business_hours business_hours_business_id_weekday_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_hours
    ADD CONSTRAINT business_hours_business_id_weekday_key UNIQUE (business_id, weekday);


--
-- Name: business_hours business_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_hours
    ADD CONSTRAINT business_hours_pkey PRIMARY KEY (id);


--
-- Name: business_members business_members_business_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_business_id_user_id_key UNIQUE (business_id, user_id);


--
-- Name: business_members business_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_pkey PRIMARY KEY (id);


--
-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);


--
-- Name: call_messages call_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_messages
    ADD CONSTRAINT call_messages_pkey PRIMARY KEY (id);


--
-- Name: calls calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_business_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_business_id_provider_key UNIQUE (business_id, provider);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: knowledge_items knowledge_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_items
    ADD CONSTRAINT knowledge_items_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_hits rate_limit_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_hits
    ADD CONSTRAINT rate_limit_hits_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: appointments_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_business_idx ON public.appointments USING btree (business_id);


--
-- Name: businesses_stripe_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX businesses_stripe_customer_idx ON public.businesses USING btree (stripe_customer_id);


--
-- Name: call_messages_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_messages_call_idx ON public.call_messages USING btree (call_id);


--
-- Name: calls_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calls_business_idx ON public.calls USING btree (business_id);


--
-- Name: customers_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_business_idx ON public.customers USING btree (business_id);


--
-- Name: idx_rate_limit_hits_key_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_hits_key_time ON public.rate_limit_hits USING btree (rate_key, created_at);


--
-- Name: idx_reviews_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_status ON public.reviews USING btree (status);


--
-- Name: knowledge_items_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_items_business_idx ON public.knowledge_items USING btree (business_id);


--
-- Name: promotions_business_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_business_idx ON public.promotions USING btree (business_id);


--
-- Name: ai_receptionists ai_receptionists_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_receptionists_set_updated_at BEFORE UPDATE ON public.ai_receptionists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: businesses businesses_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER businesses_set_updated_at BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers customers_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: knowledge_items knowledge_items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER knowledge_items_set_updated_at BEFORE UPDATE ON public.knowledge_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: services services_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ai_receptionists ai_receptionists_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_receptionists
    ADD CONSTRAINT ai_receptionists_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: ai_voice_configs ai_voice_configs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_configs
    ADD CONSTRAINT ai_voice_configs_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;


--
-- Name: business_hours business_hours_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_hours
    ADD CONSTRAINT business_hours_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: business_members business_members_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: business_members business_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_members
    ADD CONSTRAINT business_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: call_messages call_messages_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_messages
    ADD CONSTRAINT call_messages_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id) ON DELETE CASCADE;


--
-- Name: calls calls_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: calls calls_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: customers customers_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: integrations integrations_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: knowledge_items knowledge_items_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_items
    ADD CONSTRAINT knowledge_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: promotions promotions_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: services services_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reviews Anyone can submit a review; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can submit a review" ON public.reviews FOR INSERT WITH CHECK ((status = 'pending'::text));


--
-- Name: rate_limit_hits No direct client access to rate limit data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct client access to rate limit data" ON public.rate_limit_hits USING (false) WITH CHECK (false);


--
-- Name: reviews Public can view approved reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view approved reviews" ON public.reviews FOR SELECT USING ((status = 'approved'::text));


--
-- Name: ai_receptionists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_receptionists ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_receptionists ai_receptionists_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_receptionists_all_member ON public.ai_receptionists USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: ai_voice_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_voice_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_voice_configs ai_voice_configs_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_voice_configs_all_member ON public.ai_voice_configs USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments appointments_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_all_member ON public.appointments USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: business_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: business_hours business_hours_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY business_hours_all_member ON public.business_hours USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: business_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

--
-- Name: business_members business_members_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY business_members_insert_self ON public.business_members FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: business_members business_members_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY business_members_select_member ON public.business_members FOR SELECT USING (public.is_business_member(business_id));


--
-- Name: businesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

--
-- Name: businesses businesses_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY businesses_insert_authenticated ON public.businesses FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: businesses businesses_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY businesses_select_member ON public.businesses FOR SELECT USING (public.is_business_member(id));


--
-- Name: businesses businesses_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY businesses_update_member ON public.businesses FOR UPDATE USING (public.is_business_member(id));


--
-- Name: call_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: call_messages call_messages_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY call_messages_all_member ON public.call_messages USING ((EXISTS ( SELECT 1
   FROM public.calls c
  WHERE ((c.id = call_messages.call_id) AND public.is_business_member(c.business_id)))));


--
-- Name: calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

--
-- Name: calls calls_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calls_all_member ON public.calls USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_all_member ON public.customers USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations integrations_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY integrations_all_member ON public.integrations USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: knowledge_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_items knowledge_items_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_items_all_member ON public.knowledge_items USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: promotions promotions_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promotions_all_member ON public.promotions USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: rate_limit_hits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: services services_all_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY services_all_member ON public.services USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_self ON public.users FOR SELECT USING ((id = auth.uid()));


--
-- Name: users users_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_self ON public.users FOR UPDATE USING ((id = auth.uid()));


--
-- PostgreSQL database dump complete
--

\unrestrict p8tFcI9FSGa8Z8LJSzy0AUF6QfRJh5UHD4R1NyFVLgIfqDaWrpafgLiTsLJcps9

