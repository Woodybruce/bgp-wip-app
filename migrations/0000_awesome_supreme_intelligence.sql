CREATE TABLE "ai_lead_activity" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_lead_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"focus_areas" text[],
	"asset_classes" text[],
	"deal_types" text[],
	"custom_prompt" text,
	"setup_complete" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" varchar,
	"source_context" text,
	"area" text,
	"asset_class" text,
	"opportunity_type" text,
	"confidence" integer DEFAULT 50,
	"status" text DEFAULT 'new' NOT NULL,
	"suggested_action" text,
	"related_company_id" integer,
	"related_contact_id" integer,
	"related_property_id" integer,
	"related_deal_id" integer,
	"ai_reasoning" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "app_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"description" text NOT NULL,
	"requested_by" text,
	"requested_by_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"category" text DEFAULT 'feature',
	"priority" text DEFAULT 'normal',
	"developer_notes" text,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now(),
	"reviewed_at" timestamp,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app_feedback_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text DEFAULT 'suggestion' NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"user_id" varchar(255),
	"user_name" varchar(255),
	"thread_id" varchar(255),
	"page_context" varchar(255),
	"status" varchar(50) DEFAULT 'new' NOT NULL,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "available_units" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" varchar NOT NULL,
	"unit_name" text NOT NULL,
	"floor" text,
	"sqft" real,
	"asking_rent" real,
	"rates_pa" real,
	"service_charge_pa" real,
	"use_class" text,
	"condition" text,
	"available_date" text,
	"marketing_status" text DEFAULT 'Available',
	"location" text,
	"epc_rating" text,
	"notes" text,
	"restrictions" text,
	"fee" real,
	"deal_id" varchar,
	"agent_user_ids" text[],
	"viewings_count" integer DEFAULT 0,
	"last_viewing_date" text,
	"marketing_start_date" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"user_id" varchar,
	"action_data" text,
	"attachments" text[],
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_thread_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"added_by" varchar,
	"seen" boolean DEFAULT false,
	"added_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"created_by" varchar NOT NULL,
	"property_id" text,
	"property_name" text,
	"linked_type" text,
	"linked_id" text,
	"linked_name" text,
	"is_ai_chat" boolean DEFAULT false,
	"group_pic_url" text,
	"has_ai_member" boolean DEFAULT false,
	"project_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chatbgp_email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"subject" text,
	"sender_email" text,
	"sender_name" text,
	"received_at" timestamp,
	"classification" text DEFAULT 'unknown' NOT NULL,
	"actions_taken" jsonb DEFAULT '[]'::jsonb,
	"ai_summary" text,
	"reply_sent" boolean DEFAULT false,
	"processed_at" timestamp DEFAULT now(),
	"error" text,
	CONSTRAINT "chatbgp_email_log_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "chatbgp_learnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(100) DEFAULT 'general' NOT NULL,
	"learning" text NOT NULL,
	"source_user" varchar(255),
	"source_user_name" varchar(255),
	"source_thread_id" varchar(255),
	"confidence" varchar(50) DEFAULT 'confirmed' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chatbgp_memories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"role" text,
	"type" text DEFAULT 'client'
);
--> statement-breakpoint
CREATE TABLE "crm_companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"domain" text,
	"domain_url" text,
	"company_type" text,
	"description" text,
	"head_office_address" jsonb,
	"company_profile_url" text,
	"bgp_contact_crm" text,
	"bgp_contact_user_ids" text[],
	"parent_company_id" varchar,
	"is_portfolio_account" boolean DEFAULT false,
	"companies_house_number" text,
	"companies_house_data" jsonb,
	"companies_house_officers" jsonb,
	"kyc_status" text,
	"kyc_checked_at" timestamp,
	"contacted" boolean DEFAULT false,
	"details_sent" boolean DEFAULT false,
	"viewing" boolean DEFAULT false,
	"shortlisted" boolean DEFAULT false,
	"under_offer" boolean DEFAULT false,
	"ai_disabled" boolean DEFAULT false,
	"linkedin_url" text,
	"phone" text,
	"industry" text,
	"employee_count" text,
	"annual_revenue" text,
	"founded_year" text,
	"last_enriched_at" timestamp,
	"enrichment_source" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_company_deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"deal_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_company_properties" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"property_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_comps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"property_id" varchar,
	"deal_id" varchar,
	"deal_type" text,
	"comp_type" text,
	"address" jsonb,
	"tenant" text,
	"landlord" text,
	"transaction" text,
	"term" text,
	"demise" text,
	"area_sqft" text,
	"headline_rent" text,
	"zone_a_rate" text,
	"overall_rate" text,
	"rent_free" text,
	"capex" text,
	"pricing" text,
	"yield_percent" text,
	"rent_analysis" text,
	"completion_date" text,
	"comments" text,
	"use_class" text,
	"transaction_type" text,
	"lt_act_status" text,
	"passing_rent" text,
	"fitout_contribution" text,
	"source_evidence" text,
	"nia_sqft" text,
	"gia_sqft" text,
	"ipms_sqft" text,
	"basement_sqft" text,
	"ground_floor_sqft" text,
	"upper_floor_sqft" text,
	"itza_sqft" text,
	"frontage_ft" text,
	"depth_ft" text,
	"return_frontage_ft" text,
	"net_effective_rent" text,
	"rent_psf_nia" text,
	"rent_psf_gia" text,
	"rent_psf_overall" text,
	"break_clause" text,
	"lease_start" text,
	"lease_expiry" text,
	"rent_review_pattern" text,
	"next_review_date" text,
	"area_location" text,
	"postcode" text,
	"measurement_standard" text,
	"verified" boolean DEFAULT false,
	"verified_by" text,
	"verified_date" text,
	"created_by" text,
	"zone_a_rate_psf" text,
	"overall_rate_psf" text,
	"passing_rent_pa" text,
	"rent_free_months" text,
	"evidence_source" text,
	"floor_area_sqft" text,
	"effective_rent_pa" text,
	"effective_rate_psf" text,
	"ancillary_sqft" text,
	"zone_a_depth_ft" text,
	"review_pattern" text,
	"principal_client" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_contact_deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"deal_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_contact_properties" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"property_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_contact_requirements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"requirement_id" varchar NOT NULL,
	"requirement_type" text
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"role" text,
	"company_id" varchar,
	"company_name" text,
	"email" text,
	"bgp_allocation" text,
	"contact_type" text,
	"agent_specialty" text,
	"phone" text,
	"bgp_client" boolean DEFAULT false,
	"is_favourite" boolean DEFAULT false,
	"next_meeting_date" text,
	"notes" text,
	"avatar_url" text,
	"linkedin_url" text,
	"last_enriched_at" timestamp,
	"enrichment_source" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_deal_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" varchar NOT NULL,
	"lead_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"property_id" varchar,
	"landlord_id" varchar,
	"deal_type" text,
	"status" text,
	"team" text[],
	"internal_agent" text[],
	"tenant_id" varchar,
	"client_contact_id" varchar,
	"vendor_id" varchar,
	"purchaser_id" varchar,
	"vendor_agent_id" varchar,
	"acquisition_agent_id" varchar,
	"purchaser_agent_id" varchar,
	"leasing_agent_id" varchar,
	"timeline_start" text,
	"timeline_end" text,
	"pricing" real,
	"yield_percent" real,
	"fee_agreement" text,
	"fee" real,
	"aml_check_completed" text,
	"total_area_sqft" real,
	"basement_area_sqft" real,
	"gf_area_sqft" real,
	"ff_area_sqft" real,
	"itza_area_sqft" real,
	"price_psf" real,
	"price_itza" real,
	"rent_pa" real,
	"capital_contribution" real,
	"rent_free" real,
	"lease_length" real,
	"break_option" real,
	"completion_date" text,
	"rent_analysis" real,
	"comments" text,
	"last_interaction" text,
	"sharepoint_link" text,
	"tenure_text" text,
	"asset_class" text,
	"invoicing_entity_id" varchar,
	"invoicing_email" text,
	"fee_percentage" real,
	"completion_timing" text,
	"invoicing_notes" text,
	"hots_completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_interactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"company_id" varchar,
	"type" text NOT NULL,
	"direction" text,
	"subject" text,
	"preview" text,
	"participants" jsonb,
	"microsoft_id" text,
	"match_method" text,
	"interaction_date" timestamp NOT NULL,
	"bgp_user" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"assigned_to" text,
	"status" text,
	"lead_type" text,
	"source" text,
	"email" text,
	"phone" text,
	"date_added" text,
	"address" jsonb,
	"last_interaction" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_properties" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"agent" text,
	"landlord_id" varchar,
	"status" text,
	"address" jsonb,
	"bgp_engagement" text[],
	"asset_class" text,
	"tenure" text,
	"sqft" real,
	"notes" text,
	"website" text,
	"billing_entity_id" varchar,
	"folder_teams" text[],
	"title_number" text,
	"proprietor_name" text,
	"proprietor_type" text,
	"proprietor_address" text,
	"proprietor_company_number" text,
	"title_search_date" timestamp,
	"proprietor_kyc_status" text,
	"proprietor_kyc_data" jsonb,
	"bgp_contact_crm" text,
	"bgp_contact_user_ids" text[],
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_property_agents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" varchar NOT NULL,
	"user_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_property_clients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"role" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_property_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" varchar NOT NULL,
	"lead_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_property_tenants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" varchar NOT NULL,
	"company_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_req_invest_deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" varchar NOT NULL,
	"deal_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_req_invest_properties" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" varchar NOT NULL,
	"property_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_requirements_investment" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"status" text,
	"company_id" varchar,
	"use_types" text[],
	"requirement_types" text[],
	"size_range" text[],
	"requirement_locations" text[],
	"location_data" text,
	"locations" text,
	"location" jsonb,
	"principal_contact_id" varchar,
	"agent_contact_id" varchar,
	"contact_id" varchar,
	"contact_name" text,
	"contact_email" text,
	"contact_mobile" text,
	"bgp_contact_user_ids" text[],
	"deal_id" varchar,
	"landlord_pack" text,
	"extract" text,
	"comments" text,
	"requirement_date" text,
	"contacted" boolean DEFAULT false,
	"details_sent" boolean DEFAULT false,
	"viewing" boolean DEFAULT false,
	"shortlisted" boolean DEFAULT false,
	"under_offer" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_requirements_leasing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monday_item_id" text,
	"group_name" text,
	"status" text,
	"company_id" varchar,
	"use" text[],
	"requirement_type" text[],
	"size" text[],
	"requirement_locations" text[],
	"location_data" text,
	"principal_contact_id" varchar,
	"agent_contact_id" varchar,
	"bgp_contact_user_id" varchar,
	"bgp_contact_user_ids" text[],
	"deal_id" varchar,
	"landlord_pack" text,
	"extract" text,
	"comments" text,
	"requirement_date" text,
	"contacted" boolean DEFAULT false,
	"details_sent" boolean DEFAULT false,
	"viewing" boolean DEFAULT false,
	"shortlisted" boolean DEFAULT false,
	"under_offer" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_fee_allocations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" varchar NOT NULL,
	"agent_name" text NOT NULL,
	"allocation_type" text NOT NULL,
	"percentage" real,
	"fixed_amount" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"person" text NOT NULL,
	"project" text,
	"day" text NOT NULL,
	"time" text NOT NULL,
	"type" text DEFAULT 'meeting'
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_file_name" text NOT NULL,
	"source_file_path" text NOT NULL,
	"template_content" text NOT NULL,
	"fields" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"design" text DEFAULT '{}' NOT NULL,
	"canva_design_id" text,
	"canva_edit_url" text,
	"canva_view_url" text,
	"page_images" text DEFAULT '[]',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_ingest" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"inbox_id" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text,
	"body_preview" text,
	"body_text" text,
	"received_at" timestamp NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "email_ingest_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "excel_model_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar NOT NULL,
	"name" text NOT NULL,
	"input_values" text DEFAULT '{}' NOT NULL,
	"output_values" text,
	"generated_file_path" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"property_id" varchar,
	"sharepoint_url" text,
	"sharepoint_drive_item_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "excel_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_path" text NOT NULL,
	"original_file_name" text NOT NULL,
	"input_mapping" text DEFAULT '{}' NOT NULL,
	"output_mapping" text DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1,
	"previous_version_id" varchar,
	"property_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "external_requirements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"source_id" text,
	"company_name" text NOT NULL,
	"company_logo" text,
	"contact_name" text,
	"contact_title" text,
	"contact_phone" text,
	"contact_email" text,
	"tenure" text,
	"size_range" text,
	"use_class" text,
	"pitch" text,
	"locations" text[],
	"last_updated" text,
	"description" text,
	"status" text DEFAULT 'active',
	"raw_data" jsonb,
	"imported_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "favorite_instructions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investment_comps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rca_deal_id" text,
	"rca_property_id" text,
	"status" text,
	"transaction_type" text,
	"subtype" text,
	"features" text,
	"market" text,
	"transaction_date" text,
	"property_name" text,
	"address" text,
	"city" text,
	"region" text,
	"country" text,
	"postal_code" text,
	"units" integer,
	"area_sqft" real,
	"year_built" integer,
	"year_renov" integer,
	"num_buildings" integer,
	"num_floors" integer,
	"land_area_acres" real,
	"occupancy" real,
	"price" real,
	"currency" text,
	"price_per_unit" real,
	"price_psf" real,
	"price_qualifier" text,
	"partial_interest" text,
	"cap_rate" real,
	"cap_rate_qualifier" text,
	"buyer" text,
	"buyer_broker" text,
	"seller" text,
	"seller_broker" text,
	"lender" text,
	"comments" text,
	"latitude" real,
	"longitude" real,
	"submarket" text,
	"property_id" varchar,
	"buyer_company_id" varchar,
	"seller_company_id" varchar,
	"source" text DEFAULT 'RCA',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investment_distributions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" varchar NOT NULL,
	"contact_id" varchar,
	"company_id" varchar,
	"contact_name" text,
	"company_name" text,
	"sent_date" timestamp DEFAULT now(),
	"method" text DEFAULT 'Email',
	"document_type" text,
	"response" text,
	"response_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investment_marketing_files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_type" text DEFAULT 'upload' NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investment_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" varchar NOT NULL,
	"company" text,
	"contact" text,
	"offer_date" timestamp,
	"offer_price" real,
	"niy" real,
	"conditions" text,
	"status" text DEFAULT 'Pending',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investment_tracker" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" varchar NOT NULL,
	"asset_name" text NOT NULL,
	"asset_type" text,
	"tenure" text,
	"guide_price" real,
	"niy" real,
	"eqy" real,
	"sqft" real,
	"wault_break" real,
	"wault_expiry" real,
	"current_rent" real,
	"erv_pa" real,
	"occupancy" real,
	"capex_required" real,
	"board_type" text DEFAULT 'Purchases' NOT NULL,
	"status" text DEFAULT 'Reporting',
	"client" text,
	"client_id" varchar,
	"client_contact" text,
	"client_contact_id" varchar,
	"vendor" text,
	"vendor_id" varchar,
	"vendor_agent" text,
	"vendor_agent_id" varchar,
	"buyer" text,
	"address" text,
	"notes" text,
	"deal_id" varchar,
	"agent_user_ids" text[],
	"fee" real,
	"fee_type" text,
	"marketing_date" text,
	"bid_deadline" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investment_viewings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" varchar NOT NULL,
	"company" text,
	"contact" text,
	"viewing_date" timestamp,
	"attendees" text,
	"outcome" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_url" text,
	"folder_url" text,
	"summary" text,
	"content" text,
	"category" text,
	"ai_tags" text[],
	"size_bytes" integer,
	"last_modified" timestamp,
	"indexed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "msal_token_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"home_account_id" text,
	"cache_data" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" varchar,
	"source_name" text,
	"title" text NOT NULL,
	"summary" text,
	"content" text,
	"url" text NOT NULL,
	"author" text,
	"image_url" text,
	"published_at" timestamp,
	"fetched_at" timestamp DEFAULT now(),
	"category" text DEFAULT 'general',
	"ai_relevance_scores" jsonb,
	"ai_tags" text[],
	"ai_summary" text,
	"processed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "news_engagement" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" varchar NOT NULL,
	"user_id" varchar,
	"team" text,
	"action" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"summary" text,
	"url" text,
	"time_ago" text,
	"category" text DEFAULT 'general'
);
--> statement-breakpoint
CREATE TABLE "news_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" varchar NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"area" text,
	"property_type" text,
	"opportunity_type" text,
	"confidence" text DEFAULT 'medium',
	"source" text,
	"suggested_action" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"monday_item_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"feed_url" text,
	"type" text DEFAULT 'rss' NOT NULL,
	"category" text DEFAULT 'general',
	"active" boolean DEFAULT true,
	"last_fetched_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"type" text DEFAULT 'retail' NOT NULL,
	"description" text,
	"rent_pa" real,
	"size" text,
	"last_updated" text,
	"assignee" text,
	"priority" text DEFAULT 'medium',
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text,
	"size_min" text,
	"size_max" text,
	"budget" text,
	"location" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"priority" text DEFAULT 'medium'
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "team_news_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team" text NOT NULL,
	"keywords" text[],
	"boosted_topics" text[],
	"muted_topics" text[],
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "team_news_preferences_team_unique" UNIQUE("team")
);
--> statement-breakpoint
CREATE TABLE "tracker_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_name" text NOT NULL,
	"address" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"rent_pa" real,
	"size" text,
	"next_action" text,
	"next_action_date" text,
	"assignee" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "turnover_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"company_name" text NOT NULL,
	"property_id" varchar,
	"property_name" text,
	"location" text,
	"period" text NOT NULL,
	"turnover" real,
	"sqft" real,
	"turnover_per_sqft" real,
	"source" text DEFAULT 'Conversation' NOT NULL,
	"confidence" text DEFAULT 'Medium' NOT NULL,
	"category" text,
	"notes" text,
	"linked_requirement_id" varchar,
	"added_by" text,
	"added_by_user_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unit_marketing_files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_type" text DEFAULT 'upload' NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unit_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" varchar NOT NULL,
	"company_name" text,
	"contact_name" text,
	"contact_id" varchar,
	"company_id" varchar,
	"offer_date" text NOT NULL,
	"rent_pa" real,
	"rent_free_months" real,
	"term_years" real,
	"break_option" text,
	"incentives" text,
	"premium" real,
	"fitting_out_contribution" real,
	"status" text DEFAULT 'Pending',
	"comments" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unit_viewings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" varchar NOT NULL,
	"company_name" text,
	"contact_name" text,
	"contact_id" varchar,
	"company_id" varchar,
	"viewing_date" text NOT NULL,
	"viewing_time" text,
	"attendees" text,
	"notes" text,
	"outcome" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"department" text,
	"team" text,
	"additional_teams" text[],
	"is_admin" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"dashboard_widgets" jsonb,
	"dashboard_layout" jsonb,
	"profile_pic_url" text,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "voa_ratings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "voa_ratings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uarn" text NOT NULL,
	"ba_code" text NOT NULL,
	"ba_ref" text,
	"description_code" text,
	"description_text" text,
	"firm_name" text,
	"number_or_name" text,
	"street" text,
	"town" text,
	"locality" text,
	"county" text,
	"postcode" text,
	"scat_code" text,
	"rateable_value" integer,
	"effective_date" text,
	"list_alteration_date" text,
	"composite_billing_authority" text,
	"list_year" text DEFAULT '2023'
);
--> statement-breakpoint
CREATE TABLE "wa_conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_phone_number" text NOT NULL,
	"contact_name" text,
	"contact_id" varchar,
	"last_message_at" timestamp DEFAULT now(),
	"last_message_preview" text,
	"unread_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"wa_message_id" text,
	"direction" text NOT NULL,
	"from_number" text NOT NULL,
	"to_number" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'sent',
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wip_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text,
	"group_name" text,
	"project" text,
	"tenant" text,
	"team" text,
	"agent" text,
	"amt_wip" real,
	"amt_invoice" real,
	"month" text,
	"deal_status" text,
	"stage" text,
	"invoice_no" text,
	"order_number" text,
	"fiscal_year" integer
);
--> statement-breakpoint
CREATE TABLE "xero_invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" varchar NOT NULL,
	"xero_invoice_id" text,
	"xero_contact_id" text,
	"invoicing_entity_id" varchar,
	"invoicing_entity_name" text,
	"invoice_number" text,
	"reference" text,
	"status" text DEFAULT 'DRAFT',
	"total_amount" real,
	"currency" text DEFAULT 'GBP',
	"due_date" text,
	"sent_to_xero" boolean DEFAULT false,
	"xero_url" text,
	"error_message" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_rep_searches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text NOT NULL,
	"company_id" varchar,
	"contact_id" varchar,
	"deal_id" varchar,
	"status" text NOT NULL DEFAULT 'Brief Received',
	"target_use" text[],
	"size_min" integer,
	"size_max" integer,
	"target_locations" text[],
	"budget_min" integer,
	"budget_max" integer,
	"next_action" text,
	"next_action_date" text,
	"notes" text,
	"assigned_to" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
