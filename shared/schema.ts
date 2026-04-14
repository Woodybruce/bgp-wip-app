import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, real, jsonb, uuid, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"),
  type: text("type").notNull().default("retail"),
  description: text("description"),
  rentPA: real("rent_pa"),
  size: text("size"),
  lastUpdated: text("last_updated"),
  assignee: text("assignee"),
  priority: text("priority").default("medium"),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export const trackerItems = pgTable("tracker_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyName: text("property_name").notNull(),
  address: text("address").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("available"),
  rentPA: real("rent_pa"),
  size: text("size"),
  nextAction: text("next_action"),
  nextActionDate: text("next_action_date"),
  assignee: text("assignee"),
  notes: text("notes"),
});

export const insertTrackerItemSchema = createInsertSchema(trackerItems).omit({ id: true });
export type InsertTrackerItem = z.infer<typeof insertTrackerItemSchema>;
export type TrackerItem = typeof trackerItems.$inferSelect;

export const requirements = pgTable("requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  sizeMin: text("size_min"),
  sizeMax: text("size_max"),
  budget: text("budget"),
  location: text("location"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  priority: text("priority").default("medium"),
});

export const insertRequirementSchema = createInsertSchema(requirements).omit({ id: true });
export type InsertRequirement = z.infer<typeof insertRequirementSchema>;
export type Requirement = typeof requirements.$inferSelect;

export const newsItems = pgTable("news_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  source: text("source").notNull(),
  summary: text("summary"),
  url: text("url"),
  timeAgo: text("time_ago"),
  category: text("category").default("general"),
});

export const insertNewsItemSchema = createInsertSchema(newsItems).omit({ id: true });
export type InsertNewsItem = z.infer<typeof insertNewsItemSchema>;
export type NewsItem = typeof newsItems.$inferSelect;

export const diaryEntries = pgTable("diary_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  person: text("person").notNull(),
  project: text("project"),
  day: text("day").notNull(),
  time: text("time").notNull(),
  type: text("type").default("meeting"),
});

export const insertDiaryEntrySchema = createInsertSchema(diaryEntries).omit({ id: true });
export type InsertDiaryEntry = z.infer<typeof insertDiaryEntrySchema>;
export type DiaryEntry = typeof diaryEntries.$inferSelect;

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  type: text("type").default("client"),
});

export const insertContactSchema = createInsertSchema(contacts).omit({ id: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  department: text("department"),
  team: text("team"),
  additionalTeams: text("additional_teams").array(),
  isAdmin: boolean("is_admin").default(false),
  isActive: boolean("is_active").default(true),
  dashboardWidgets: jsonb("dashboard_widgets").$type<string[]>(),
  dashboardLayout: jsonb("dashboard_layout").$type<Record<string, any>>(),
  profilePicUrl: text("profile_pic_url"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const waConversations = pgTable("wa_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  waPhoneNumber: text("wa_phone_number").notNull(),
  contactName: text("contact_name"),
  contactId: varchar("contact_id"),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  lastMessagePreview: text("last_message_preview"),
  unreadCount: integer("unread_count").default(0),
});

export const insertWaConversationSchema = createInsertSchema(waConversations).omit({ id: true });
export type InsertWaConversation = z.infer<typeof insertWaConversationSchema>;
export type WaConversation = typeof waConversations.$inferSelect;

export const waMessages = pgTable("wa_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull(),
  waMessageId: text("wa_message_id"),
  direction: text("direction").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  body: text("body").notNull(),
  status: text("status").default("sent"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const insertWaMessageSchema = createInsertSchema(waMessages).omit({ id: true });
export type InsertWaMessage = z.infer<typeof insertWaMessageSchema>;
export type WaMessage = typeof waMessages.$inferSelect;

export const emailIngest = pgTable("email_ingest", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: text("message_id").notNull().unique(),
  inboxId: text("inbox_id").notNull(),
  fromAddress: text("from_address").notNull(),
  subject: text("subject"),
  bodyPreview: text("body_preview"),
  bodyText: text("body_text"),
  receivedAt: timestamp("received_at").notNull(),
  status: text("status").notNull().default("new"),
  processedAt: timestamp("processed_at"),
});

export const insertEmailIngestSchema = createInsertSchema(emailIngest).omit({ id: true });
export type InsertEmailIngest = z.infer<typeof insertEmailIngestSchema>;
export type EmailIngest = typeof emailIngest.$inferSelect;

export const newsLeads = pgTable("news_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  emailId: varchar("email_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  area: text("area"),
  propertyType: text("property_type"),
  opportunityType: text("opportunity_type"),
  confidence: text("confidence").default("medium"),
  source: text("source"),
  suggestedAction: text("suggested_action"),
  status: text("status").notNull().default("draft"),
  mondayItemId: text("monday_item_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNewsLeadSchema = createInsertSchema(newsLeads).omit({ id: true });
export type InsertNewsLead = z.infer<typeof insertNewsLeadSchema>;
export type NewsLead = typeof newsLeads.$inferSelect;

export const excelTemplates = pgTable("excel_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  filePath: text("file_path").notNull(),
  originalFileName: text("original_file_name").notNull(),
  inputMapping: text("input_mapping").notNull().default("{}"),
  outputMapping: text("output_mapping").notNull().default("{}"),
  version: integer("version").default(1),
  previousVersionId: varchar("previous_version_id"),
  propertyId: varchar("property_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertExcelTemplateSchema = createInsertSchema(excelTemplates).omit({ id: true, createdAt: true });
export type InsertExcelTemplate = z.infer<typeof insertExcelTemplateSchema>;
export type ExcelTemplate = typeof excelTemplates.$inferSelect;

export const excelModelRuns = pgTable("excel_model_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull(),
  name: text("name").notNull(),
  inputValues: text("input_values").notNull().default("{}"),
  outputValues: text("output_values"),
  generatedFilePath: text("generated_file_path"),
  status: text("status").notNull().default("draft"),
  propertyId: varchar("property_id"),
  sharepointUrl: text("sharepoint_url"),
  sharepointDriveItemId: text("sharepoint_drive_item_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertExcelModelRunSchema = createInsertSchema(excelModelRuns).omit({ id: true, createdAt: true });
export type InsertExcelModelRun = z.infer<typeof insertExcelModelRunSchema>;
export type ExcelModelRun = typeof excelModelRuns.$inferSelect;

export const documentTemplates = pgTable("document_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  sourceFileName: text("source_file_name").notNull(),
  sourceFilePath: text("source_file_path").notNull(),
  templateContent: text("template_content").notNull(),
  fields: text("fields").notNull().default("[]"),
  status: text("status").notNull().default("draft"),
  design: text("design").notNull().default("{}"),
  canvaDesignId: text("canva_design_id"),
  canvaEditUrl: text("canva_edit_url"),
  canvaViewUrl: text("canva_view_url"),
  pageImages: text("page_images").default("[]"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;

export const newsSources = pgTable("news_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  feedUrl: text("feed_url"),
  type: text("type").notNull().default("rss"),
  category: text("category").default("general"),
  active: boolean("active").default(true),
  lastFetchedAt: timestamp("last_fetched_at"),
});

export const insertNewsSourceSchema = createInsertSchema(newsSources).omit({ id: true, lastFetchedAt: true });
export type InsertNewsSource = z.infer<typeof insertNewsSourceSchema>;
export type NewsSource = typeof newsSources.$inferSelect;

export const newsArticles = pgTable("news_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id"),
  sourceName: text("source_name"),
  title: text("title").notNull(),
  summary: text("summary"),
  content: text("content"),
  url: text("url").notNull(),
  author: text("author"),
  imageUrl: text("image_url"),
  publishedAt: timestamp("published_at"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  category: text("category").default("general"),
  aiRelevanceScores: jsonb("ai_relevance_scores"),
  aiTags: text("ai_tags").array(),
  aiSummary: text("ai_summary"),
  processed: boolean("processed").default(false),
});

export const insertNewsArticleSchema = createInsertSchema(newsArticles).omit({ id: true, fetchedAt: true });
export type InsertNewsArticle = z.infer<typeof insertNewsArticleSchema>;
export type NewsArticle = typeof newsArticles.$inferSelect;

export const newsEngagement = pgTable("news_engagement", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  articleId: varchar("article_id").notNull(),
  userId: varchar("user_id"),
  team: text("team"),
  action: text("action").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNewsEngagementSchema = createInsertSchema(newsEngagement).omit({ id: true, createdAt: true });
export type InsertNewsEngagement = z.infer<typeof insertNewsEngagementSchema>;
export type NewsEngagement = typeof newsEngagement.$inferSelect;

export const teamNewsPreferences = pgTable("team_news_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  team: text("team").notNull().unique(),
  keywords: text("keywords").array(),
  boostedTopics: text("boosted_topics").array(),
  mutedTopics: text("muted_topics").array(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTeamNewsPreferencesSchema = createInsertSchema(teamNewsPreferences).omit({ id: true, updatedAt: true });
export type InsertTeamNewsPreferences = z.infer<typeof insertTeamNewsPreferencesSchema>;
export type TeamNewsPreferences = typeof teamNewsPreferences.$inferSelect;

export const knowledgeBase = pgTable("knowledge_base", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileUrl: text("file_url"),
  folderUrl: text("folder_url"),
  summary: text("summary"),
  content: text("content"),
  category: text("category"),
  aiTags: text("ai_tags").array(),
  sizeBytes: integer("size_bytes"),
  lastModified: timestamp("last_modified"),
  indexedAt: timestamp("indexed_at").defaultNow(),
  source: text("source").default("sharepoint"),
});

export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBase).omit({ id: true, indexedAt: true });
export type InsertKnowledgeBase = z.infer<typeof insertKnowledgeBaseSchema>;
export type KnowledgeBase = typeof knowledgeBase.$inferSelect;

export const chatThreads = pgTable("chat_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title"),
  createdBy: varchar("created_by").notNull(),
  propertyId: text("property_id"),
  propertyName: text("property_name"),
  linkedType: text("linked_type"),
  linkedId: text("linked_id"),
  linkedName: text("linked_name"),
  isAiChat: boolean("is_ai_chat").default(false),
  groupPicUrl: text("group_pic_url"),
  hasAiMember: boolean("has_ai_member").default(false),
  projectId: varchar("project_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertChatThreadSchema = createInsertSchema(chatThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatThread = z.infer<typeof insertChatThreadSchema>;
export type ChatThread = typeof chatThreads.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  userId: varchar("user_id"),
  actionData: text("action_data"),
  attachments: text("attachments").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export const chatThreadMembers = pgTable("chat_thread_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  userId: varchar("user_id").notNull(),
  addedBy: varchar("added_by"),
  seen: boolean("seen").default(false),
  addedAt: timestamp("added_at").defaultNow(),
});

export const insertChatThreadMemberSchema = createInsertSchema(chatThreadMembers).omit({ id: true, addedAt: true });
export type InsertChatThreadMember = z.infer<typeof insertChatThreadMemberSchema>;
export type ChatThreadMember = typeof chatThreadMembers.$inferSelect;

export const chatbgpMemories = pgTable("chatbgp_memories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  category: text("category").notNull(),
  content: text("content").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertChatbgpMemorySchema = createInsertSchema(chatbgpMemories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatbgpMemory = z.infer<typeof insertChatbgpMemorySchema>;
export type ChatbgpMemory = typeof chatbgpMemories.$inferSelect;

export const msalTokenCache = pgTable("msal_token_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  homeAccountId: text("home_account_id"),
  cacheData: text("cache_data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const crmCompanies = pgTable("crm_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  domain: text("domain"),
  domainUrl: text("domain_url"),
  companyType: text("company_type"),
  description: text("description"),
  headOfficeAddress: jsonb("head_office_address"),
  companyProfileUrl: text("company_profile_url"),
  bgpContactCrm: text("bgp_contact_crm"),
  bgpContactUserIds: text("bgp_contact_user_ids").array(),
  parentCompanyId: varchar("parent_company_id"),
  isPortfolioAccount: boolean("is_portfolio_account").default(false),
  companiesHouseNumber: text("companies_house_number"),
  companiesHouseData: jsonb("companies_house_data"),
  companiesHouseOfficers: jsonb("companies_house_officers"),
  kycStatus: text("kyc_status"),
  kycCheckedAt: timestamp("kyc_checked_at"),
  contacted: boolean("contacted").default(false),
  detailsSent: boolean("details_sent").default(false),
  viewing: boolean("viewing").default(false),
  shortlisted: boolean("shortlisted").default(false),
  underOffer: boolean("under_offer").default(false),
  aiDisabled: boolean("ai_disabled").default(false),
  linkedinUrl: text("linkedin_url"),
  phone: text("phone"),
  industry: text("industry"),
  employeeCount: text("employee_count"),
  annualRevenue: text("annual_revenue"),
  foundedYear: text("founded_year"),
  lastEnrichedAt: timestamp("last_enriched_at"),
  enrichmentSource: text("enrichment_source"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmCompanySchema = createInsertSchema(crmCompanies).omit({ id: true, createdAt: true, updatedAt: true, lastEnrichedAt: true, enrichmentSource: true });
export type InsertCrmCompany = z.infer<typeof insertCrmCompanySchema>;
export type CrmCompany = typeof crmCompanies.$inferSelect;

export const crmContacts = pgTable("crm_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  role: text("role"),
  companyId: varchar("company_id"),
  companyName: text("company_name"),
  email: text("email"),
  bgpAllocation: text("bgp_allocation"),
  contactType: text("contact_type"),
  agentSpecialty: text("agent_specialty"),
  phone: text("phone"),
  bgpClient: boolean("bgp_client").default(false),
  isFavourite: boolean("is_favourite").default(false),
  nextMeetingDate: text("next_meeting_date"),
  notes: text("notes"),
  avatarUrl: text("avatar_url"),
  linkedinUrl: text("linkedin_url"),
  lastEnrichedAt: timestamp("last_enriched_at"),
  enrichmentSource: text("enrichment_source"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmContactSchema = createInsertSchema(crmContacts).omit({ id: true, createdAt: true, updatedAt: true, lastEnrichedAt: true, enrichmentSource: true });
export type InsertCrmContact = z.infer<typeof insertCrmContactSchema>;
export type CrmContact = typeof crmContacts.$inferSelect;

export const crmProperties = pgTable("crm_properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  agent: text("agent"),
  landlordId: varchar("landlord_id"),
  status: text("status"),
  address: jsonb("address"),
  bgpEngagement: text("bgp_engagement").array(),
  assetClass: text("asset_class"),
  tenure: text("tenure"),
  sqft: real("sqft"),
  notes: text("notes"),
  website: text("website"),
  billingEntityId: varchar("billing_entity_id"),
  folderTeams: text("folder_teams").array(),
  titleNumber: text("title_number"),
  proprietorName: text("proprietor_name"),
  proprietorType: text("proprietor_type"),
  proprietorAddress: text("proprietor_address"),
  proprietorCompanyNumber: text("proprietor_company_number"),
  titleSearchDate: timestamp("title_search_date"),
  proprietorKycStatus: text("proprietor_kyc_status"),
  proprietorKycData: jsonb("proprietor_kyc_data"),
  bgpContactCrm: text("bgp_contact_crm"),
  bgpContactUserIds: text("bgp_contact_user_ids").array(),
  leasingPrivacyEnabled: boolean("leasing_privacy_enabled").default(false),
  sharepointFolderUrl: text("sharepoint_folder_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmPropertySchema = createInsertSchema(crmProperties).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmProperty = z.infer<typeof insertCrmPropertySchema>;
export type CrmProperty = typeof crmProperties.$inferSelect;

export const crmPropertyClients = pgTable("crm_property_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  contactId: varchar("contact_id").notNull(),
  role: text("role"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CrmPropertyClient = typeof crmPropertyClients.$inferSelect;

export const crmDeals = pgTable("crm_deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  propertyId: varchar("property_id"),
  landlordId: varchar("landlord_id"),
  dealType: text("deal_type"),
  status: text("status"),
  team: text("team").array(),
  internalAgent: text("internal_agent").array(),
  tenantId: varchar("tenant_id"),
  clientContactId: varchar("client_contact_id"),
  vendorId: varchar("vendor_id"),
  purchaserId: varchar("purchaser_id"),
  vendorAgentId: varchar("vendor_agent_id"),
  acquisitionAgentId: varchar("acquisition_agent_id"),
  purchaserAgentId: varchar("purchaser_agent_id"),
  leasingAgentId: varchar("leasing_agent_id"),
  timelineStart: text("timeline_start"),
  timelineEnd: text("timeline_end"),
  pricing: real("pricing"),
  yieldPercent: real("yield_percent"),
  feeAgreement: text("fee_agreement"),
  fee: real("fee"),
  amlCheckCompleted: text("aml_check_completed"),
  totalAreaSqft: real("total_area_sqft"),
  basementAreaSqft: real("basement_area_sqft"),
  gfAreaSqft: real("gf_area_sqft"),
  ffAreaSqft: real("ff_area_sqft"),
  itzaAreaSqft: real("itza_area_sqft"),
  pricePsf: real("price_psf"),
  priceItza: real("price_itza"),
  rentPa: real("rent_pa"),
  capitalContribution: real("capital_contribution"),
  rentFree: real("rent_free"),
  leaseLength: real("lease_length"),
  breakOption: text("break_option"),
  completionDate: text("completion_date"),
  rentAnalysis: real("rent_analysis"),
  comments: text("comments"),
  lastInteraction: text("last_interaction"),
  sharepointLink: text("sharepoint_link"),
  tenureText: text("tenure_text"),
  assetClass: text("asset_class"),
  invoicingEntityId: varchar("invoicing_entity_id"),
  invoicingEmail: text("invoicing_email"),
  feePercentage: real("fee_percentage"),
  completionTiming: text("completion_timing"),
  invoicingNotes: text("invoicing_notes"),
  poNumber: text("po_number"),
  kycApproved: boolean("kyc_approved").default(false),
  kycApprovedAt: timestamp("kyc_approved_at"),
  kycApprovedBy: text("kyc_approved_by"),
  hotsCompletedAt: timestamp("hots_completed_at"),
  // AML/MLR 2017 compliance fields
  amlRiskLevel: text("aml_risk_level"), // low, medium, high, critical
  amlSourceOfFunds: text("aml_source_of_funds"), // mortgage, cash, investment, pension, inheritance, sale_proceeds, other
  amlSourceOfFundsNotes: text("aml_source_of_funds_notes"),
  amlSourceOfWealth: text("aml_source_of_wealth"), // employment, business, inheritance, investment, property, other
  amlSourceOfWealthNotes: text("aml_source_of_wealth_notes"),
  amlPepStatus: text("aml_pep_status"), // clear, pep_domestic, pep_foreign, pep_associate, pep_family
  amlPepNotes: text("aml_pep_notes"),
  amlEddRequired: boolean("aml_edd_required").default(false),
  amlEddReason: text("aml_edd_reason"), // pep, high_risk_country, super_prime, complex_structure, suspicious, other
  amlEddCompletedAt: timestamp("aml_edd_completed_at"),
  amlEddCompletedBy: text("aml_edd_completed_by"),
  amlEddNotes: text("aml_edd_notes"),
  amlIdVerified: boolean("aml_id_verified").default(false),
  amlIdVerifiedAt: timestamp("aml_id_verified_at"),
  amlIdVerifiedBy: text("aml_id_verified_by"),
  amlIdDocType: text("aml_id_doc_type"), // passport, driving_licence, national_id, other
  amlAddressVerified: boolean("aml_address_verified").default(false),
  amlAddressDocType: text("aml_address_doc_type"), // utility_bill, bank_statement, council_tax, other
  amlSarFiled: boolean("aml_sar_filed").default(false),
  amlSarReference: text("aml_sar_reference"),
  amlSarFiledAt: timestamp("aml_sar_filed_at"),
  amlComplianceNotes: text("aml_compliance_notes"),
  amlChecklist: jsonb("aml_checklist"), // structured JSON checklist of all compliance steps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmDealSchema = createInsertSchema(crmDeals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmDeal = z.infer<typeof insertCrmDealSchema>;
export type CrmDeal = typeof crmDeals.$inferSelect;

export const crmRequirementsLeasing = pgTable("crm_requirements_leasing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  status: text("status"),
  companyId: varchar("company_id"),
  use: text("use").array(),
  requirementType: text("requirement_type").array(),
  size: text("size").array(),
  requirementLocations: text("requirement_locations").array(),
  locationData: text("location_data"),
  principalContactId: varchar("principal_contact_id"),
  agentContactId: varchar("agent_contact_id"),
  bgpContactUserId: varchar("bgp_contact_user_id"),
  bgpContactUserIds: text("bgp_contact_user_ids").array(),
  dealId: varchar("deal_id"),
  landlordPack: text("landlord_pack"),
  extract: text("extract"),
  comments: text("comments"),
  requirementDate: text("requirement_date"),
  contacted: boolean("contacted").default(false),
  detailsSent: boolean("details_sent").default(false),
  viewing: boolean("viewing").default(false),
  shortlisted: boolean("shortlisted").default(false),
  underOffer: boolean("under_offer").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmRequirementsLeasingSchema = createInsertSchema(crmRequirementsLeasing).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmRequirementsLeasing = z.infer<typeof insertCrmRequirementsLeasingSchema>;
export type CrmRequirementsLeasing = typeof crmRequirementsLeasing.$inferSelect;

export const crmRequirementsInvestment = pgTable("crm_requirements_investment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  status: text("status"),
  companyId: varchar("company_id"),
  use: text("use_types").array(),
  requirementType: text("requirement_types").array(),
  size: text("size_range").array(),
  requirementLocations: text("requirement_locations").array(),
  locationData: text("location_data"),
  locations: text("locations"),
  location: jsonb("location"),
  principalContactId: varchar("principal_contact_id"),
  agentContactId: varchar("agent_contact_id"),
  contactId: varchar("contact_id"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactMobile: text("contact_mobile"),
  bgpContactUserIds: text("bgp_contact_user_ids").array(),
  dealId: varchar("deal_id"),
  landlordPack: text("landlord_pack"),
  extract: text("extract"),
  comments: text("comments"),
  requirementDate: text("requirement_date"),
  contacted: boolean("contacted").default(false),
  detailsSent: boolean("details_sent").default(false),
  viewing: boolean("viewing").default(false),
  shortlisted: boolean("shortlisted").default(false),
  underOffer: boolean("under_offer").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmRequirementsInvestmentSchema = createInsertSchema(crmRequirementsInvestment).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmRequirementsInvestment = z.infer<typeof insertCrmRequirementsInvestmentSchema>;
export type CrmRequirementsInvestment = typeof crmRequirementsInvestment.$inferSelect;

export const crmComps = pgTable("crm_comps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  propertyId: varchar("property_id"),
  dealId: varchar("deal_id"),
  dealType: text("deal_type"),
  compType: text("comp_type"),
  address: jsonb("address"),
  tenant: text("tenant"),
  landlord: text("landlord"),
  transaction: text("transaction"),
  term: text("term"),
  demise: text("demise"),
  areaSqft: text("area_sqft"),
  headlineRent: text("headline_rent"),
  zoneARate: text("zone_a_rate"),
  overallRate: text("overall_rate"),
  rentFree: text("rent_free"),
  capex: text("capex"),
  pricing: text("pricing"),
  yieldPercent: text("yield_percent"),
  rentAnalysis: text("rent_analysis"),
  completionDate: text("completion_date"),
  comments: text("comments"),
  useClass: text("use_class"),
  transactionType: text("transaction_type"),
  ltActStatus: text("lt_act_status"),
  passingRent: text("passing_rent"),
  fitoutContribution: text("fitout_contribution"),
  sourceEvidence: text("source_evidence"),
  niaSqft: text("nia_sqft"),
  giaSqft: text("gia_sqft"),
  ipmsSqft: text("ipms_sqft"),
  basementSqft: text("basement_sqft"),
  groundFloorSqft: text("ground_floor_sqft"),
  upperFloorSqft: text("upper_floor_sqft"),
  itzaSqft: text("itza_sqft"),
  frontageFt: text("frontage_ft"),
  depthFt: text("depth_ft"),
  returnFrontageFt: text("return_frontage_ft"),
  netEffectiveRent: text("net_effective_rent"),
  rentPsfNia: text("rent_psf_nia"),
  rentPsfGia: text("rent_psf_gia"),
  rentPsfOverall: text("rent_psf_overall"),
  breakClause: text("break_clause"),
  leaseStart: text("lease_start"),
  leaseExpiry: text("lease_expiry"),
  rentReviewPattern: text("rent_review_pattern"),
  nextReviewDate: text("next_review_date"),
  areaLocation: text("area_location"),
  postcode: text("postcode"),
  measurementStandard: text("measurement_standard"),
  verified: boolean("verified").default(false),
  verifiedBy: text("verified_by"),
  verifiedDate: text("verified_date"),
  createdBy: text("created_by"),
  zoneARatePsf: text("zone_a_rate_psf"),
  overallRatePsf: text("overall_rate_psf"),
  passingRentPa: text("passing_rent_pa"),
  rentFreeMonths: text("rent_free_months"),
  evidenceSource: text("evidence_source"),
  floorAreaSqft: text("floor_area_sqft"),
  effectiveRentPa: text("effective_rent_pa"),
  effectiveRatePsf: text("effective_rate_psf"),
  ancillarySqft: text("ancillary_sqft"),
  zoneADepthFt: text("zone_a_depth_ft"),
  reviewPattern: text("review_pattern"),
  principalClient: text("principal_client"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmCompSchema = createInsertSchema(crmComps).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmComp = z.infer<typeof insertCrmCompSchema>;
export type CrmComp = typeof crmComps.$inferSelect;

export const compFiles = pgTable("comp_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  compId: varchar("comp_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCompFileSchema = createInsertSchema(compFiles).omit({ id: true, createdAt: true });
export type InsertCompFile = z.infer<typeof insertCompFileSchema>;
export type CompFile = typeof compFiles.$inferSelect;

export const crmLeads = pgTable("crm_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  mondayItemId: text("monday_item_id"),
  groupName: text("group_name"),
  assignedTo: text("assigned_to"),
  status: text("status"),
  leadType: text("lead_type"),
  source: text("source"),
  email: text("email"),
  phone: text("phone"),
  dateAdded: text("date_added"),
  address: jsonb("address"),
  lastInteraction: text("last_interaction"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrmLeadSchema = createInsertSchema(crmLeads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrmLead = z.infer<typeof insertCrmLeadSchema>;
export type CrmLead = typeof crmLeads.$inferSelect;

export const crmPropertyAgents = pgTable("crm_property_agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  userId: varchar("user_id").notNull(),
});

export const crmPropertyTenants = pgTable("crm_property_tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  companyId: varchar("company_id").notNull(),
});

export const crmPropertyLeads = pgTable("crm_property_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  leadId: varchar("lead_id").notNull(),
});

export const crmDealLeads = pgTable("crm_deal_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dealId: varchar("deal_id").notNull(),
  leadId: varchar("lead_id").notNull(),
});

export const crmReqInvestProperties = pgTable("crm_req_invest_properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requirementId: varchar("requirement_id").notNull(),
  propertyId: varchar("property_id").notNull(),
});

export const crmReqInvestDeals = pgTable("crm_req_invest_deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requirementId: varchar("requirement_id").notNull(),
  dealId: varchar("deal_id").notNull(),
});

export const crmContactProperties = pgTable("crm_contact_properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull(),
  propertyId: varchar("property_id").notNull(),
});

export const crmContactRequirements = pgTable("crm_contact_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull(),
  requirementId: varchar("requirement_id").notNull(),
  requirementType: text("requirement_type"),
});

export const crmContactDeals = pgTable("crm_contact_deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull(),
  dealId: varchar("deal_id").notNull(),
});

export const crmCompanyProperties = pgTable("crm_company_properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  propertyId: varchar("property_id").notNull(),
});

export const crmCompanyDeals = pgTable("crm_company_deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  dealId: varchar("deal_id").notNull(),
});

export const crmInteractions = pgTable("crm_interactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull(),
  companyId: varchar("company_id"),
  type: text("type").notNull(),
  direction: text("direction"),
  subject: text("subject"),
  preview: text("preview"),
  participants: jsonb("participants"),
  microsoftId: text("microsoft_id"),
  matchMethod: text("match_method"),
  interactionDate: timestamp("interaction_date").notNull(),
  bgpUser: text("bgp_user"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmInteractionSchema = createInsertSchema(crmInteractions).omit({ id: true, createdAt: true });
export type InsertCrmInteraction = z.infer<typeof insertCrmInteractionSchema>;
export type CrmInteraction = typeof crmInteractions.$inferSelect;

export const dealFeeAllocations = pgTable("deal_fee_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dealId: varchar("deal_id").notNull(),
  agentName: text("agent_name").notNull(),
  allocationType: text("allocation_type").notNull(),
  percentage: real("percentage"),
  fixedAmount: real("fixed_amount"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDealFeeAllocationSchema = createInsertSchema(dealFeeAllocations).omit({ id: true, createdAt: true });
export type InsertDealFeeAllocation = z.infer<typeof insertDealFeeAllocationSchema>;
export type DealFeeAllocation = typeof dealFeeAllocations.$inferSelect;

export const externalRequirements = pgTable("external_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  sourceId: text("source_id"),
  companyName: text("company_name").notNull(),
  companyLogo: text("company_logo"),
  contactName: text("contact_name"),
  contactTitle: text("contact_title"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  tenure: text("tenure"),
  sizeRange: text("size_range"),
  useClass: text("use_class"),
  pitch: text("pitch"),
  locations: text("locations").array(),
  lastUpdated: text("last_updated"),
  description: text("description"),
  status: text("status").default("active"),
  rawData: jsonb("raw_data"),
  importedAt: timestamp("imported_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExternalRequirementSchema = createInsertSchema(externalRequirements).omit({ id: true, importedAt: true, updatedAt: true });
export type InsertExternalRequirement = z.infer<typeof insertExternalRequirementSchema>;
export type ExternalRequirement = typeof externalRequirements.$inferSelect;

export const voaRatings = pgTable("voa_ratings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  uarn: text("uarn").notNull(),
  baCode: text("ba_code").notNull(),
  baRef: text("ba_ref"),
  descriptionCode: text("description_code"),
  descriptionText: text("description_text"),
  firmName: text("firm_name"),
  numberOrName: text("number_or_name"),
  street: text("street"),
  town: text("town"),
  locality: text("locality"),
  county: text("county"),
  postcode: text("postcode"),
  scatCode: text("scat_code"),
  rateableValue: integer("rateable_value"),
  effectiveDate: text("effective_date"),
  listAlterationDate: text("list_alteration_date"),
  compositeBillingAuthority: text("composite_billing_authority"),
  listYear: text("list_year").default("2023"),
});

export const insertVoaRatingSchema = createInsertSchema(voaRatings).omit({ id: true });
export type InsertVoaRating = z.infer<typeof insertVoaRatingSchema>;
export type VoaRating = typeof voaRatings.$inferSelect;

export const chatbgpEmailLog = pgTable("chatbgp_email_log", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").unique().notNull(),
  subject: text("subject"),
  senderEmail: text("sender_email"),
  senderName: text("sender_name"),
  receivedAt: timestamp("received_at"),
  classification: text("classification").notNull().default("unknown"),
  actionsTaken: jsonb("actions_taken").default([]),
  aiSummary: text("ai_summary"),
  replySent: boolean("reply_sent").default(false),
  processedAt: timestamp("processed_at").defaultNow(),
  error: text("error"),
});

export type ChatBGPEmailLog = typeof chatbgpEmailLog.$inferSelect;

export const appFeedbackLog = pgTable("app_feedback_log", {
  id: serial("id").primaryKey(),
  category: text("category").notNull().default("suggestion"),
  summary: text("summary").notNull(),
  detail: text("detail"),
  userId: varchar("user_id", { length: 255 }),
  userName: varchar("user_name", { length: 255 }),
  threadId: varchar("thread_id", { length: 255 }),
  pageContext: varchar("page_context", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("new"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type AppFeedbackLog = typeof appFeedbackLog.$inferSelect;

export const chatbgpLearnings = pgTable("chatbgp_learnings", {
  id: serial("id").primaryKey(),
  category: varchar("category", { length: 100 }).notNull().default("general"),
  learning: text("learning").notNull(),
  sourceUser: varchar("source_user", { length: 255 }),
  sourceUserName: varchar("source_user_name", { length: 255 }),
  sourceThreadId: varchar("source_thread_id", { length: 255 }),
  confidence: varchar("confidence", { length: 50 }).notNull().default("confirmed"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

export type ChatBGPLearning = typeof chatbgpLearnings.$inferSelect;

export const appChangeRequests = pgTable("app_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  description: text("description").notNull(),
  requestedBy: text("requested_by"),
  requestedByUserId: text("requested_by_user_id"),
  status: text("status").notNull().default("pending"),
  category: text("category").default("feature"),
  priority: text("priority").default("normal"),
  developerNotes: text("developer_notes"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  approvedAt: timestamp("approved_at"),
});

export const insertAppChangeRequestSchema = createInsertSchema(appChangeRequests).omit({ id: true, createdAt: true, reviewedAt: true, approvedAt: true });
export type InsertAppChangeRequest = z.infer<typeof insertAppChangeRequestSchema>;
export type AppChangeRequest = typeof appChangeRequests.$inferSelect;

export const wipEntries = pgTable("wip_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ref: text("ref"),
  groupName: text("group_name"),
  project: text("project"),
  tenant: text("tenant"),
  team: text("team"),
  agent: text("agent"),
  amtWip: real("amt_wip"),
  amtInvoice: real("amt_invoice"),
  month: text("month"),
  dealStatus: text("deal_status"),
  stage: text("stage"),
  invoiceNo: text("invoice_no"),
  orderNumber: text("order_number"),
  fiscalYear: integer("fiscal_year"),
});

export const insertWipEntrySchema = createInsertSchema(wipEntries).omit({ id: true });
export type InsertWipEntry = z.infer<typeof insertWipEntrySchema>;
export type WipEntry = typeof wipEntries.$inferSelect;

export const investmentComps = pgTable("investment_comps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rcaDealId: text("rca_deal_id"),
  rcaPropertyId: text("rca_property_id"),
  status: text("status"),
  transactionType: text("transaction_type"),
  subtype: text("subtype"),
  features: text("features"),
  market: text("market"),
  transactionDate: text("transaction_date"),
  propertyName: text("property_name"),
  address: text("address"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  postalCode: text("postal_code"),
  units: integer("units"),
  areaSqft: real("area_sqft"),
  yearBuilt: integer("year_built"),
  yearRenov: integer("year_renov"),
  numBuildings: integer("num_buildings"),
  numFloors: integer("num_floors"),
  landAreaAcres: real("land_area_acres"),
  occupancy: real("occupancy"),
  price: real("price"),
  currency: text("currency"),
  pricePerUnit: real("price_per_unit"),
  pricePsf: real("price_psf"),
  priceQualifier: text("price_qualifier"),
  partialInterest: text("partial_interest"),
  capRate: real("cap_rate"),
  capRateQualifier: text("cap_rate_qualifier"),
  buyer: text("buyer"),
  buyerBroker: text("buyer_broker"),
  seller: text("seller"),
  sellerBroker: text("seller_broker"),
  lender: text("lender"),
  comments: text("comments"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  submarket: text("submarket"),
  propertyId: varchar("property_id"),
  buyerCompanyId: varchar("buyer_company_id"),
  sellerCompanyId: varchar("seller_company_id"),
  source: text("source").default("RCA"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvestmentCompSchema = createInsertSchema(investmentComps).omit({ id: true, createdAt: true });
export type InsertInvestmentComp = z.infer<typeof insertInvestmentCompSchema>;
export type InvestmentComp = typeof investmentComps.$inferSelect;

export const xeroInvoices = pgTable("xero_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dealId: varchar("deal_id").notNull(),
  xeroInvoiceId: text("xero_invoice_id"),
  xeroContactId: text("xero_contact_id"),
  invoicingEntityId: varchar("invoicing_entity_id"),
  invoicingEntityName: text("invoicing_entity_name"),
  invoiceNumber: text("invoice_number"),
  reference: text("reference"),
  status: text("status").default("DRAFT"),
  totalAmount: real("total_amount"),
  currency: text("currency").default("GBP"),
  dueDate: text("due_date"),
  sentToXero: boolean("sent_to_xero").default(false),
  xeroUrl: text("xero_url"),
  errorMessage: text("error_message"),
  syncedAt: timestamp("synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertXeroInvoiceSchema = createInsertSchema(xeroInvoices).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertXeroInvoice = z.infer<typeof insertXeroInvoiceSchema>;
export type XeroInvoice = typeof xeroInvoices.$inferSelect;

export const favoriteInstructions = pgTable("favorite_instructions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  propertyId: text("property_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const availableUnits = pgTable("available_units", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  unitName: text("unit_name").notNull(),
  floor: text("floor"),
  sqft: real("sqft"),
  askingRent: real("asking_rent"),
  ratesPa: real("rates_pa"),
  serviceChargePa: real("service_charge_pa"),
  useClass: text("use_class"),
  condition: text("condition"),
  availableDate: text("available_date"),
  marketingStatus: text("marketing_status").default("Available"),
  location: text("location"),
  epcRating: text("epc_rating"),
  notes: text("notes"),
  restrictions: text("restrictions"),
  fee: real("fee"),
  dealId: varchar("deal_id"),
  agentUserIds: text("agent_user_ids").array(),
  viewingsCount: integer("viewings_count").default(0),
  lastViewingDate: text("last_viewing_date"),
  marketingStartDate: text("marketing_start_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAvailableUnitSchema = createInsertSchema(availableUnits).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAvailableUnit = z.infer<typeof insertAvailableUnitSchema>;
export type AvailableUnit = typeof availableUnits.$inferSelect;

export const unitViewings = pgTable("unit_viewings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitId: varchar("unit_id").notNull(),
  companyName: text("company_name"),
  contactName: text("contact_name"),
  contactId: varchar("contact_id"),
  companyId: varchar("company_id"),
  viewingDate: text("viewing_date").notNull(),
  viewingTime: text("viewing_time"),
  attendees: text("attendees"),
  notes: text("notes"),
  outcome: text("outcome"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUnitViewingSchema = createInsertSchema(unitViewings).omit({ id: true, createdAt: true });
export type InsertUnitViewing = z.infer<typeof insertUnitViewingSchema>;
export type UnitViewing = typeof unitViewings.$inferSelect;

export const unitOffers = pgTable("unit_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitId: varchar("unit_id").notNull(),
  companyName: text("company_name"),
  contactName: text("contact_name"),
  contactId: varchar("contact_id"),
  companyId: varchar("company_id"),
  offerDate: text("offer_date").notNull(),
  rentPa: real("rent_pa"),
  rentFreeMonths: real("rent_free_months"),
  termYears: real("term_years"),
  breakOption: text("break_option"),
  incentives: text("incentives"),
  premium: real("premium"),
  fittingOutContribution: real("fitting_out_contribution"),
  status: text("status").default("Pending"),
  comments: text("comments"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUnitOfferSchema = createInsertSchema(unitOffers).omit({ id: true, createdAt: true });
export type InsertUnitOffer = z.infer<typeof insertUnitOfferSchema>;
export type UnitOffer = typeof unitOffers.$inferSelect;

export const unitMarketingFiles = pgTable("unit_marketing_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitId: varchar("unit_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileType: text("file_type").notNull().default("upload"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUnitMarketingFileSchema = createInsertSchema(unitMarketingFiles).omit({ id: true, createdAt: true });
export type InsertUnitMarketingFile = z.infer<typeof insertUnitMarketingFileSchema>;
export type UnitMarketingFile = typeof unitMarketingFiles.$inferSelect;

export const investmentTracker = pgTable("investment_tracker", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  assetName: text("asset_name").notNull(),
  assetType: text("asset_type"),
  tenure: text("tenure"),
  guidePrice: real("guide_price"),
  niy: real("niy"),
  eqy: real("eqy"),
  sqft: real("sqft"),
  waultBreak: real("wault_break"),
  waultExpiry: real("wault_expiry"),
  currentRent: real("current_rent"),
  ervPa: real("erv_pa"),
  occupancy: real("occupancy"),
  capexRequired: real("capex_required"),
  boardType: text("board_type").notNull().default("Purchases"),
  status: text("status").default("Reporting"),
  client: text("client"),
  clientId: varchar("client_id"),
  clientContact: text("client_contact"),
  clientContactId: varchar("client_contact_id"),
  vendor: text("vendor"),
  vendorId: varchar("vendor_id"),
  vendorAgent: text("vendor_agent"),
  vendorAgentId: varchar("vendor_agent_id"),
  buyer: text("buyer"),
  address: text("address"),
  notes: text("notes"),
  dealId: varchar("deal_id"),
  agentUserIds: text("agent_user_ids").array(),
  fee: real("fee"),
  feeType: text("fee_type"),
  marketingDate: text("marketing_date"),
  bidDeadline: text("bid_deadline"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInvestmentTrackerSchema = createInsertSchema(investmentTracker).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestmentTracker = z.infer<typeof insertInvestmentTrackerSchema>;
export type InvestmentTracker = typeof investmentTracker.$inferSelect;

export const investmentViewings = pgTable("investment_viewings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trackerId: varchar("tracker_id").notNull(),
  company: text("company"),
  contact: text("contact"),
  viewingDate: timestamp("viewing_date"),
  attendees: text("attendees"),
  outcome: text("outcome"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertInvestmentViewingSchema = createInsertSchema(investmentViewings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestmentViewing = z.infer<typeof insertInvestmentViewingSchema>;
export type InvestmentViewing = typeof investmentViewings.$inferSelect;

export const investmentOffers = pgTable("investment_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trackerId: varchar("tracker_id").notNull(),
  company: text("company"),
  contact: text("contact"),
  offerDate: timestamp("offer_date"),
  offerPrice: real("offer_price"),
  niy: real("niy"),
  conditions: text("conditions"),
  status: text("status").default("Pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertInvestmentOfferSchema = createInsertSchema(investmentOffers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestmentOffer = z.infer<typeof insertInvestmentOfferSchema>;
export type InvestmentOffer = typeof investmentOffers.$inferSelect;

export const investmentDistributions = pgTable("investment_distributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trackerId: varchar("tracker_id").notNull(),
  contactId: varchar("contact_id"),
  companyId: varchar("company_id"),
  contactName: text("contact_name"),
  companyName: text("company_name"),
  sentDate: timestamp("sent_date").defaultNow(),
  method: text("method").default("Email"),
  documentType: text("document_type"),
  response: text("response"),
  responseDate: timestamp("response_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertInvestmentDistributionSchema = createInsertSchema(investmentDistributions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestmentDistribution = z.infer<typeof insertInvestmentDistributionSchema>;
export type InvestmentDistribution = typeof investmentDistributions.$inferSelect;

export const investmentMarketingFiles = pgTable("investment_marketing_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trackerId: varchar("tracker_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileType: text("file_type").notNull().default("upload"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvestmentMarketingFileSchema = createInsertSchema(investmentMarketingFiles).omit({ id: true, createdAt: true });
export type InsertInvestmentMarketingFile = z.infer<typeof insertInvestmentMarketingFileSchema>;
export type InvestmentMarketingFile = typeof investmentMarketingFiles.$inferSelect;

export const aiLeadProfiles = pgTable("ai_lead_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  focusAreas: text("focus_areas").array(),
  assetClasses: text("asset_classes").array(),
  dealTypes: text("deal_types").array(),
  customPrompt: text("custom_prompt"),
  setupComplete: boolean("setup_complete").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAiLeadProfileSchema = createInsertSchema(aiLeadProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiLeadProfile = z.infer<typeof insertAiLeadProfileSchema>;
export type AiLeadProfile = typeof aiLeadProfiles.$inferSelect;

export const aiLeads = pgTable("ai_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: varchar("source_id"),
  sourceContext: text("source_context"),
  area: text("area"),
  assetClass: text("asset_class"),
  opportunityType: text("opportunity_type"),
  confidence: integer("confidence").default(50),
  status: text("status").notNull().default("new"),
  suggestedAction: text("suggested_action"),
  relatedCompanyId: integer("related_company_id"),
  relatedContactId: integer("related_contact_id"),
  relatedPropertyId: integer("related_property_id"),
  relatedDealId: integer("related_deal_id"),
  aiReasoning: text("ai_reasoning"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAiLeadSchema = createInsertSchema(aiLeads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiLead = z.infer<typeof insertAiLeadSchema>;
export type AiLead = typeof aiLeads.$inferSelect;

export const aiLeadActivity = pgTable("ai_lead_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  userId: varchar("user_id").notNull(),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAiLeadActivitySchema = createInsertSchema(aiLeadActivity).omit({ id: true, createdAt: true });
export type InsertAiLeadActivity = z.infer<typeof insertAiLeadActivitySchema>;
export type AiLeadActivity = typeof aiLeadActivity.$inferSelect;

export const turnoverData = pgTable("turnover_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  companyName: text("company_name").notNull(),
  propertyId: varchar("property_id"),
  propertyName: text("property_name"),
  location: text("location"),
  period: text("period").notNull(),
  turnover: real("turnover"),
  sqft: real("sqft"),
  turnoverPerSqft: real("turnover_per_sqft"),
  source: text("source").notNull().default("Conversation"),
  confidence: text("confidence").notNull().default("Medium"),
  category: text("category"),
  notes: text("notes"),
  linkedRequirementId: varchar("linked_requirement_id"),
  addedBy: text("added_by"),
  addedByUserId: varchar("added_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTurnoverDataSchema = createInsertSchema(turnoverData).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTurnoverData = z.infer<typeof insertTurnoverDataSchema>;
export type TurnoverData = typeof turnoverData.$inferSelect;

export const systemActivityLog = pgTable("system_activity_log", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  count: integer("count").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SystemActivityLog = typeof systemActivityLog.$inferSelect;

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const imageStudioImages = pgTable("image_studio_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileName: text("file_name").notNull(),
  category: text("category").notNull().default("Uncategorised"),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  description: text("description"),
  source: text("source").notNull().default("upload"),
  propertyId: varchar("property_id"),
  area: text("area"),
  address: text("address"),
  brandName: text("brand_name"),
  brandSector: text("brand_sector"),
  propertyType: text("property_type"),
  mimeType: text("mime_type").notNull().default("image/jpeg"),
  fileSize: integer("file_size"),
  width: integer("width"),
  height: integer("height"),
  thumbnailData: text("thumbnail_data"),
  sharepointItemId: text("sharepoint_item_id"),
  sharepointDriveId: text("sharepoint_drive_id"),
  localPath: text("local_path"),
  uploadedBy: varchar("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertImageStudioImageSchema = createInsertSchema(imageStudioImages).omit({ id: true, createdAt: true });
export type InsertImageStudioImage = z.infer<typeof insertImageStudioImageSchema>;
export type ImageStudioImage = typeof imageStudioImages.$inferSelect;

export const deletedSharepointImages = pgTable("deleted_sharepoint_images", {
  id: serial("id").primaryKey(),
  sharepointDriveId: text("sharepoint_drive_id").notNull(),
  sharepointItemId: text("sharepoint_item_id").notNull(),
  deletedAt: timestamp("deleted_at").defaultNow(),
});

export const userTasks = pgTable("user_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("todo"),
  category: text("category"),
  linkedDealId: varchar("linked_deal_id"),
  linkedPropertyId: varchar("linked_property_id"),
  linkedContactId: varchar("linked_contact_id"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertUserTaskSchema = createInsertSchema(userTasks).omit({ id: true, createdAt: true, completedAt: true });
export type InsertUserTask = z.infer<typeof insertUserTaskSchema>;
export type UserTask = typeof userTasks.$inferSelect;

export const landRegistrySearches = pgTable("land_registry_searches", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  address: text("address").notNull(),
  postcode: text("postcode"),
  freeholdsCount: integer("freeholds_count").default(0),
  leaseholdsCount: integer("leaseholds_count").default(0),
  freeholds: jsonb("freeholds"),
  leaseholds: jsonb("leaseholds"),
  intelligence: jsonb("intelligence"),
  aiSummary: jsonb("ai_summary"),
  ownership: jsonb("ownership"),
  crmPropertyId: varchar("crm_property_id"),
  notes: text("notes"),
  tags: jsonb("tags").default(sql`'[]'::jsonb`),
  status: varchar("status").default("New"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type LandRegistrySearch = typeof landRegistrySearches.$inferSelect;

export const leasingScheduleUnits = pgTable("leasing_schedule_units", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  unitName: text("unit_name"),
  zone: text("zone"),
  positioning: text("positioning"),
  tenantName: text("tenant_name"),
  agentInitials: text("agent_initials"),
  leaseExpiry: timestamp("lease_expiry"),
  leaseBreak: timestamp("lease_break"),
  rentReview: timestamp("rent_review"),
  landlordBreak: timestamp("landlord_break"),
  rentPa: real("rent_pa"),
  sqft: real("sqft"),
  matPsqft: real("mat_psqft"),
  lflPercent: real("lfl_percent"),
  occCostPercent: real("occ_cost_percent"),
  financialNotes: text("financial_notes"),
  targetBrands: text("target_brands"),
  optimumTarget: text("optimum_target"),
  priority: text("priority"),
  status: text("status"),
  updates: text("updates"),
  targetCompanyIds: text("target_company_ids").array(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const leasingScheduleAudit = pgTable("leasing_schedule_audit", {
  id: serial("id").primaryKey(),
  unitId: varchar("unit_id"),
  propertyId: varchar("property_id").notNull(),
  userId: varchar("user_id").notNull(),
  userName: text("user_name").notNull(),
  action: text("action").notNull(),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const kycInvestigations = pgTable("kyc_investigations", {
  id: serial("id").primaryKey(),
  subjectType: text("subject_type").notNull(), // company | individual | property_intelligence
  subjectName: text("subject_name").notNull(),
  companyNumber: text("company_number"),
  crmCompanyId: varchar("crm_company_id"),
  officerName: text("officer_name"),
  riskLevel: text("risk_level"), // low | medium | high | critical
  riskScore: integer("risk_score"),
  sanctionsMatch: boolean("sanctions_match").default(false),
  result: jsonb("result"),
  conductedBy: varchar("conducted_by"),
  conductedAt: timestamp("conducted_at").defaultNow(),
  notes: text("notes"),
});

export const insertKycInvestigationSchema = createInsertSchema(kycInvestigations).omit({ id: true, conductedAt: true });
export type InsertKycInvestigation = z.infer<typeof insertKycInvestigationSchema>;
export type KycInvestigation = typeof kycInvestigations.$inferSelect;

export const kycAuditLog = pgTable("kyc_audit_log", {
  id: serial("id").primaryKey(),
  investigationId: integer("investigation_id").notNull(),
  action: text("action").notNull(), // created | updated | approved | rejected | re-screened
  performedBy: varchar("performed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertKycAuditLogSchema = createInsertSchema(kycAuditLog).omit({ id: true, createdAt: true });
export type InsertKycAuditLog = z.infer<typeof insertKycAuditLogSchema>;
export type KycAuditLog = typeof kycAuditLog.$inferSelect;

export const imageStudioCollections = pgTable("image_studio_collections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  coverImageId: varchar("cover_image_id"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertImageStudioCollectionSchema = createInsertSchema(imageStudioCollections).omit({ id: true, createdAt: true });
export type InsertImageStudioCollection = z.infer<typeof insertImageStudioCollectionSchema>;
export type ImageStudioCollection = typeof imageStudioCollections.$inferSelect;

export const imageStudioCollectionImages = pgTable("image_studio_collection_images", {
  id: serial("id").primaryKey(),
  collectionId: varchar("collection_id").notNull(),
  imageId: varchar("image_id").notNull(),
  addedAt: timestamp("added_at").defaultNow(),
});

export type ImageStudioCollectionImage = typeof imageStudioCollectionImages.$inferSelect;

export const dealAuditLog = pgTable("deal_audit_log", {
  id: serial("id").primaryKey(),
  dealId: varchar("deal_id").notNull(),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  changedBy: varchar("changed_by"),
  changedByName: varchar("changed_by_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDealAuditLogSchema = createInsertSchema(dealAuditLog).omit({ id: true, createdAt: true });
export type InsertDealAuditLog = z.infer<typeof insertDealAuditLogSchema>;
export type DealAuditLog = typeof dealAuditLog.$inferSelect;

// AML Compliance tables
export const amlSettings = pgTable("aml_settings", {
  id: serial("id").primaryKey(),
  nominatedOfficerId: varchar("nominated_officer_id"),
  nominatedOfficerName: text("nominated_officer_name"),
  nominatedOfficerEmail: text("nominated_officer_email"),
  nominatedOfficerAppointedAt: timestamp("nominated_officer_appointed_at"),
  firmRiskAssessment: jsonb("firm_risk_assessment"),
  firmRiskAssessmentUpdatedAt: timestamp("firm_risk_assessment_updated_at"),
  firmRiskAssessmentUpdatedBy: text("firm_risk_assessment_updated_by"),
  amlPolicyNotes: text("aml_policy_notes"),
  recheckIntervalDays: integer("recheck_interval_days").default(365),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AmlSettings = typeof amlSettings.$inferSelect;

export const amlTrainingRecords = pgTable("aml_training_records", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  userName: text("user_name").notNull(),
  trainingType: text("training_type").notNull(), // induction, annual_refresh, enhanced, bespoke
  trainingDate: timestamp("training_date").notNull(),
  completedAt: timestamp("completed_at"),
  score: integer("score"),
  topics: text("topics").array(),
  notes: text("notes"),
  certifiedBy: text("certified_by"),
  nextDueDate: timestamp("next_due_date"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AmlTrainingRecord = typeof amlTrainingRecords.$inferSelect;

export const amlRecheckReminders = pgTable("aml_recheck_reminders", {
  id: serial("id").primaryKey(),
  dealId: varchar("deal_id"),
  companyId: varchar("company_id"),
  entityName: text("entity_name").notNull(),
  recheckType: text("recheck_type").notNull(), // scheduled, triggered, annual
  dueDate: timestamp("due_date").notNull(),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AmlRecheckReminder = typeof amlRecheckReminders.$inferSelect;

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginData = z.infer<typeof loginSchema>;
