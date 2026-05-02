import fs from "fs";
import path from "path";
import {
  type User, type InsertUser,
  type Project, type InsertProject,
  type TrackerItem, type InsertTrackerItem,
  type Requirement, type InsertRequirement,
  type NewsItem, type InsertNewsItem,
  type DiaryEntry, type InsertDiaryEntry,
  type Contact, type InsertContact,
  type WaConversation, type InsertWaConversation,
  type WaMessage, type InsertWaMessage,
  type EmailIngest, type InsertEmailIngest,
  type NewsLead, type InsertNewsLead,
  type ExcelTemplate, type InsertExcelTemplate,
  type ExcelModelRun, type InsertExcelModelRun,
  type DocumentTemplate, type InsertDocumentTemplate,
  type KnowledgeBase, type InsertKnowledgeBase,
  type ChatThread, type InsertChatThread,
  type ChatMessage, type InsertChatMessage,
  type ChatThreadMember, type InsertChatThreadMember,
  type ChatbgpMemory, type InsertChatbgpMemory,
  type CrmCompany, type InsertCrmCompany,
  type CrmContact, type InsertCrmContact,
  type CrmProperty, type InsertCrmProperty,
  type CrmDeal, type InsertCrmDeal,
  type CrmRequirementsLeasing, type InsertCrmRequirementsLeasing,
  type CrmRequirementsInvestment, type InsertCrmRequirementsInvestment,
  type CrmComp, type InsertCrmComp,
  type CrmLead, type InsertCrmLead,
  type DealFeeAllocation, type InsertDealFeeAllocation,
  type AppChangeRequest, type InsertAppChangeRequest,
  type AvailableUnit, type InsertAvailableUnit,
  users, projects, trackerItems, requirements, newsItems, diaryEntries, contacts,
  waConversations, waMessages, emailIngest, newsLeads,
  excelTemplates, excelModelRuns, documentTemplates, knowledgeBase,
  chatThreads, chatMessages, chatThreadMembers, chatbgpMemories,
  crmCompanies, crmContacts, crmProperties, crmDeals,
  crmRequirementsLeasing, crmRequirementsInvestment, crmComps, crmLeads,
  crmPropertyAgents, crmPropertyTenants, crmPropertyLeads, crmDealLeads,
  crmReqInvestProperties, crmReqInvestDeals,
  crmContactProperties, crmContactRequirements,
  crmCompanyProperties, crmCompanyDeals, crmContactDeals,
  dealFeeAllocations,
  appChangeRequests,
  availableUnits,
} from "@shared/schema";
import { escapeLike } from "./utils/escape-like";
import { db, pool } from "./db";
import { eq, ne, desc, and, or, inArray, ilike, sql, notInArray, isNull } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUserDashboardWidgets(userId: string, widgets: string[]): Promise<void>;

  getProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;

  getTrackerItems(): Promise<TrackerItem[]>;
  createTrackerItem(item: InsertTrackerItem): Promise<TrackerItem>;

  getRequirements(): Promise<Requirement[]>;
  createRequirement(req: InsertRequirement): Promise<Requirement>;

  getNewsItems(): Promise<NewsItem[]>;
  createNewsItem(item: InsertNewsItem): Promise<NewsItem>;

  getDiaryEntries(): Promise<DiaryEntry[]>;
  createDiaryEntry(entry: InsertDiaryEntry): Promise<DiaryEntry>;

  getContacts(): Promise<Contact[]>;
  createContact(contact: InsertContact): Promise<Contact>;

  getWaConversations(): Promise<WaConversation[]>;
  getWaConversation(id: string): Promise<WaConversation | undefined>;
  getWaConversationByPhone(phone: string): Promise<WaConversation | undefined>;
  upsertWaConversation(phone: string, contactName: string | null, lastMessage: string): Promise<WaConversation>;
  markWaConversationRead(id: string): Promise<void>;
  getWaMessages(conversationId: string): Promise<WaMessage[]>;
  createWaMessage(message: InsertWaMessage): Promise<WaMessage>;

  getEmails(): Promise<EmailIngest[]>;
  getEmailByMessageId(messageId: string): Promise<EmailIngest | undefined>;
  createEmail(email: InsertEmailIngest): Promise<EmailIngest>;
  updateEmailStatus(id: string, status: string): Promise<void>;

  getLeads(): Promise<NewsLead[]>;
  getLeadsByEmailId(emailId: string): Promise<NewsLead[]>;
  createLead(lead: InsertNewsLead): Promise<NewsLead>;
  updateLeadStatus(id: string, status: string): Promise<void>;

  getExcelTemplates(): Promise<ExcelTemplate[]>;
  getExcelTemplate(id: string): Promise<ExcelTemplate | undefined>;
  createExcelTemplate(template: InsertExcelTemplate): Promise<ExcelTemplate>;
  updateExcelTemplate(id: string, updates: Partial<InsertExcelTemplate>): Promise<ExcelTemplate>;
  deleteExcelTemplate(id: string): Promise<void>;

  getExcelModelRuns(): Promise<ExcelModelRun[]>;
  getExcelModelRunsByTemplate(templateId: string): Promise<ExcelModelRun[]>;
  getExcelModelRun(id: string): Promise<ExcelModelRun | undefined>;
  createExcelModelRun(run: InsertExcelModelRun): Promise<ExcelModelRun>;
  updateExcelModelRun(id: string, updates: Partial<InsertExcelModelRun>): Promise<ExcelModelRun>;
  deleteExcelModelRun(id: string): Promise<void>;

  getDocumentTemplates(): Promise<DocumentTemplate[]>;
  getDocumentTemplate(id: string): Promise<DocumentTemplate | undefined>;
  createDocumentTemplate(template: InsertDocumentTemplate): Promise<DocumentTemplate>;
  updateDocumentTemplate(id: string, updates: Partial<InsertDocumentTemplate>): Promise<DocumentTemplate>;
  deleteDocumentTemplate(id: string): Promise<void>;

  getKnowledgeBaseItems(): Promise<KnowledgeBase[]>;
  getKnowledgeBaseByFile(filePath: string): Promise<KnowledgeBase | undefined>;
  upsertKnowledgeBaseItem(item: InsertKnowledgeBase): Promise<KnowledgeBase>;
  clearKnowledgeBase(): Promise<void>;

  getChatThreadsForUser(userId: string): Promise<ChatThread[]>;
  getChatThread(id: string): Promise<ChatThread | undefined>;
  createChatThread(thread: InsertChatThread): Promise<ChatThread>;
  updateChatThread(id: string, updates: Partial<InsertChatThread>): Promise<ChatThread>;
  deleteChatThread(id: string): Promise<void>;

  getChatMessages(threadId: string): Promise<ChatMessage[]>;
  getChatMessage(id: string): Promise<ChatMessage | undefined>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  updateChatMessage(id: string, content: string): Promise<ChatMessage>;
  deleteChatMessage(id: string): Promise<void>;
  searchChatMessages(userId: string, query: string): Promise<any[]>;

  getChatThreadMembers(threadId: string): Promise<ChatThreadMember[]>;
  addChatThreadMember(member: InsertChatThreadMember): Promise<ChatThreadMember>;
  removeChatThreadMember(threadId: string, userId: string): Promise<void>;
  markThreadSeen(threadId: string, userId: string): Promise<void>;
  markOtherMembersUnseen(threadId: string, senderId: string): Promise<void>;
  getUnseenThreadCount(userId: string): Promise<number>;

  getMemories(userId: string): Promise<ChatbgpMemory[]>;
  getMemoriesByCategory(userId: string, category: string): Promise<ChatbgpMemory[]>;
  createMemory(memory: InsertChatbgpMemory): Promise<ChatbgpMemory>;
  deleteMemory(id: string): Promise<void>;
  clearMemories(userId: string): Promise<void>;

  getCrmCompanies(filters?: { search?: string; groupName?: string; companyType?: string; includeBillingEntities?: boolean; page?: number; limit?: number }): Promise<{ data: CrmCompany[]; total: number } | CrmCompany[]>;
  getCrmCompany(id: string): Promise<CrmCompany | undefined>;
  createCrmCompany(company: InsertCrmCompany): Promise<CrmCompany>;
  updateCrmCompany(id: string, updates: Partial<InsertCrmCompany>): Promise<CrmCompany>;
  deleteCrmCompany(id: string): Promise<void>;

  getCrmContacts(filters?: { search?: string; groupName?: string; companyId?: string; contactType?: string; bgpAllocation?: string; page?: number; limit?: number }): Promise<{ data: CrmContact[]; total: number } | CrmContact[]>;
  getCrmContact(id: string): Promise<CrmContact | undefined>;
  createCrmContact(contact: InsertCrmContact): Promise<CrmContact>;
  updateCrmContact(id: string, updates: Partial<InsertCrmContact>): Promise<CrmContact>;
  deleteCrmContact(id: string): Promise<void>;

  getCrmProperties(filters?: { search?: string; groupName?: string; status?: string; assetClass?: string; bgpEngagement?: string; page?: number; limit?: number }): Promise<{ data: CrmProperty[]; total: number } | CrmProperty[]>;
  getCrmProperty(id: string): Promise<CrmProperty | undefined>;
  createCrmProperty(property: InsertCrmProperty): Promise<CrmProperty>;
  updateCrmProperty(id: string, updates: Partial<InsertCrmProperty>): Promise<CrmProperty>;
  deleteCrmProperty(id: string): Promise<void>;

  getCrmDeals(filters?: { search?: string; groupName?: string; status?: string; team?: string; dealType?: string; propertyId?: string; excludeTrackerDeals?: boolean; page?: number; limit?: number }): Promise<{ data: CrmDeal[]; total: number } | CrmDeal[]>;
  getCrmDeal(id: string): Promise<CrmDeal | undefined>;
  createCrmDeal(deal: InsertCrmDeal): Promise<CrmDeal>;
  updateCrmDeal(id: string, updates: Partial<InsertCrmDeal>): Promise<CrmDeal>;
  deleteCrmDeal(id: string): Promise<void>;

  getDealFeeAllocations(dealId: string): Promise<DealFeeAllocation[]>;
  setDealFeeAllocations(dealId: string, allocations: InsertDealFeeAllocation[]): Promise<DealFeeAllocation[]>;

  getCrmRequirementsLeasing(filters?: { search?: string; groupName?: string; status?: string }): Promise<CrmRequirementsLeasing[]>;
  getCrmRequirementLeasing(id: string): Promise<CrmRequirementsLeasing | undefined>;
  createCrmRequirementLeasing(req: InsertCrmRequirementsLeasing): Promise<CrmRequirementsLeasing>;
  updateCrmRequirementLeasing(id: string, updates: Partial<InsertCrmRequirementsLeasing>): Promise<CrmRequirementsLeasing>;
  deleteCrmRequirementLeasing(id: string): Promise<void>;

  getCrmRequirementsInvestment(filters?: { search?: string; groupName?: string }): Promise<CrmRequirementsInvestment[]>;
  getCrmRequirementInvestment(id: string): Promise<CrmRequirementsInvestment | undefined>;
  createCrmRequirementInvestment(req: InsertCrmRequirementsInvestment): Promise<CrmRequirementsInvestment>;
  updateCrmRequirementInvestment(id: string, updates: Partial<InsertCrmRequirementsInvestment>): Promise<CrmRequirementsInvestment>;
  deleteCrmRequirementInvestment(id: string): Promise<void>;

  getCrmComps(filters?: { search?: string; groupName?: string; dealType?: string }): Promise<CrmComp[]>;
  getCrmComp(id: string): Promise<CrmComp | undefined>;
  createCrmComp(comp: InsertCrmComp): Promise<CrmComp>;
  updateCrmComp(id: string, updates: Partial<InsertCrmComp>): Promise<CrmComp>;
  deleteCrmComp(id: string): Promise<void>;

  getCrmLeads(filters?: { search?: string; groupName?: string; status?: string; leadType?: string }): Promise<CrmLead[]>;
  getCrmLead(id: string): Promise<CrmLead | undefined>;
  createCrmLead(lead: InsertCrmLead): Promise<CrmLead>;
  updateCrmLead(id: string, updates: Partial<InsertCrmLead>): Promise<CrmLead>;
  deleteCrmLead(id: string): Promise<void>;

  crmSearchAll(query: string): Promise<{ type: string; id: string; name: string; detail?: string }[]>;
  getCrmStats(): Promise<{ properties: number; deals: number; companies: number; contacts: number; leads: number; comps: number; requirementsLeasing: number; requirementsInvestment: number }>;

  getAppChangeRequests(): Promise<AppChangeRequest[]>;
  getAppChangeRequest(id: string): Promise<AppChangeRequest | undefined>;
  createAppChangeRequest(request: InsertAppChangeRequest): Promise<AppChangeRequest>;
  updateAppChangeRequest(id: string, updates: Partial<InsertAppChangeRequest & { reviewedAt?: Date; approvedAt?: Date }>): Promise<AppChangeRequest>;

  getAvailableUnits(filters?: { propertyId?: string; marketingStatus?: string }): Promise<AvailableUnit[]>;
  getAvailableUnit(id: string): Promise<AvailableUnit | undefined>;
  createAvailableUnit(unit: InsertAvailableUnit): Promise<AvailableUnit>;
  updateAvailableUnit(id: string, updates: Partial<InsertAvailableUnit>): Promise<AvailableUnit>;
  deleteAvailableUnit(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async updateUserDashboardWidgets(userId: string, widgets: string[]): Promise<void> {
    await db.update(users).set({ dashboardWidgets: widgets }).where(eq(users.id, userId));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getProjects(): Promise<Project[]> {
    return db.select().from(projects);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [created] = await db.insert(projects).values(project).returning();
    return created;
  }

  async getTrackerItems(): Promise<TrackerItem[]> {
    return db.select().from(trackerItems);
  }

  async createTrackerItem(item: InsertTrackerItem): Promise<TrackerItem> {
    const [created] = await db.insert(trackerItems).values(item).returning();
    return created;
  }

  async getRequirements(): Promise<Requirement[]> {
    return db.select().from(requirements);
  }

  async createRequirement(req: InsertRequirement): Promise<Requirement> {
    const [created] = await db.insert(requirements).values(req).returning();
    return created;
  }

  async getNewsItems(): Promise<NewsItem[]> {
    return db.select().from(newsItems);
  }

  async createNewsItem(item: InsertNewsItem): Promise<NewsItem> {
    const [created] = await db.insert(newsItems).values(item).returning();
    return created;
  }

  async getDiaryEntries(): Promise<DiaryEntry[]> {
    return db.select().from(diaryEntries);
  }

  async createDiaryEntry(entry: InsertDiaryEntry): Promise<DiaryEntry> {
    const [created] = await db.insert(diaryEntries).values(entry).returning();
    return created;
  }

  async getContacts(): Promise<Contact[]> {
    return db.select().from(contacts);
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [created] = await db.insert(contacts).values(contact).returning();
    return created;
  }

  async getWaConversations(): Promise<WaConversation[]> {
    return db.select().from(waConversations).orderBy(desc(waConversations.lastMessageAt));
  }

  async getWaConversation(id: string): Promise<WaConversation | undefined> {
    const [conv] = await db.select().from(waConversations).where(eq(waConversations.id, id));
    return conv;
  }

  async getWaConversationByPhone(phone: string): Promise<WaConversation | undefined> {
    const [conv] = await db.select().from(waConversations).where(eq(waConversations.waPhoneNumber, phone));
    return conv;
  }

  async upsertWaConversation(phone: string, contactName: string | null, lastMessage: string): Promise<WaConversation> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT * FROM wa_conversations WHERE wa_phone_number = $1 FOR UPDATE",
        [phone]
      );
      let result;
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        result = await client.query(
          `UPDATE wa_conversations SET contact_name = COALESCE($1, contact_name), last_message_at = NOW(), last_message_preview = $2, unread_count = COALESCE(unread_count, 0) + 1 WHERE id = $3 RETURNING *`,
          [contactName, lastMessage.slice(0, 100), row.id]
        );
      } else {
        result = await client.query(
          `INSERT INTO wa_conversations (wa_phone_number, contact_name, last_message_at, last_message_preview, unread_count) VALUES ($1, $2, NOW(), $3, 1) RETURNING *`,
          [phone, contactName, lastMessage.slice(0, 100)]
        );
      }
      await client.query("COMMIT");
      return result.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async markWaConversationRead(id: string): Promise<void> {
    await db.update(waConversations)
      .set({ unreadCount: 0 })
      .where(eq(waConversations.id, id));
  }

  async getWaMessages(conversationId: string): Promise<WaMessage[]> {
    return db.select().from(waMessages)
      .where(eq(waMessages.conversationId, conversationId))
      .orderBy(waMessages.timestamp);
  }

  async createWaMessage(message: InsertWaMessage): Promise<WaMessage> {
    const [created] = await db.insert(waMessages).values(message).returning();
    return created;
  }

  async getEmails(): Promise<EmailIngest[]> {
    return db.select().from(emailIngest).orderBy(desc(emailIngest.receivedAt));
  }

  async getEmailByMessageId(messageId: string): Promise<EmailIngest | undefined> {
    const [email] = await db.select().from(emailIngest).where(eq(emailIngest.messageId, messageId));
    return email;
  }

  async createEmail(email: InsertEmailIngest): Promise<EmailIngest> {
    const [created] = await db.insert(emailIngest).values(email).returning();
    return created;
  }

  async updateEmailStatus(id: string, status: string): Promise<void> {
    const updates: any = { status };
    if (status === "processed") {
      updates.processedAt = new Date();
    }
    await db.update(emailIngest).set(updates).where(eq(emailIngest.id, id));
  }

  async getLeads(): Promise<NewsLead[]> {
    return db.select().from(newsLeads).orderBy(desc(newsLeads.createdAt));
  }

  async getLeadsByEmailId(emailId: string): Promise<NewsLead[]> {
    return db.select().from(newsLeads).where(eq(newsLeads.emailId, emailId));
  }

  async createLead(lead: InsertNewsLead): Promise<NewsLead> {
    const [created] = await db.insert(newsLeads).values(lead).returning();
    return created;
  }

  async updateLeadStatus(id: string, status: string): Promise<void> {
    await db.update(newsLeads).set({ status }).where(eq(newsLeads.id, id));
  }

  async getExcelTemplates(): Promise<ExcelTemplate[]> {
    return db.select().from(excelTemplates).orderBy(desc(excelTemplates.createdAt));
  }

  async getExcelTemplate(id: string): Promise<ExcelTemplate | undefined> {
    const [template] = await db.select().from(excelTemplates).where(eq(excelTemplates.id, id));
    return template;
  }

  async createExcelTemplate(template: InsertExcelTemplate): Promise<ExcelTemplate> {
    const [created] = await db.insert(excelTemplates).values(template).returning();
    return created;
  }

  async updateExcelTemplate(id: string, updates: Partial<InsertExcelTemplate>): Promise<ExcelTemplate> {
    const [updated] = await db.update(excelTemplates).set(updates).where(eq(excelTemplates.id, id)).returning();
    return updated;
  }

  async deleteExcelTemplate(id: string): Promise<void> {
    await db.delete(excelTemplates).where(eq(excelTemplates.id, id));
  }

  async getExcelModelRuns(): Promise<ExcelModelRun[]> {
    return db.select().from(excelModelRuns).orderBy(desc(excelModelRuns.createdAt));
  }

  async getExcelModelRunsByTemplate(templateId: string): Promise<ExcelModelRun[]> {
    return db.select().from(excelModelRuns).where(eq(excelModelRuns.templateId, templateId)).orderBy(desc(excelModelRuns.createdAt));
  }

  async getExcelModelRun(id: string): Promise<ExcelModelRun | undefined> {
    const [run] = await db.select().from(excelModelRuns).where(eq(excelModelRuns.id, id));
    return run;
  }

  async createExcelModelRun(run: InsertExcelModelRun): Promise<ExcelModelRun> {
    const [created] = await db.insert(excelModelRuns).values(run).returning();
    return created;
  }

  async updateExcelModelRun(id: string, updates: Partial<InsertExcelModelRun>): Promise<ExcelModelRun> {
    const [updated] = await db.update(excelModelRuns).set(updates).where(eq(excelModelRuns.id, id)).returning();
    return updated;
  }

  async deleteExcelModelRun(id: string): Promise<void> {
    await db.delete(excelModelRuns).where(eq(excelModelRuns.id, id));
  }

  async getDocumentTemplates(): Promise<DocumentTemplate[]> {
    return db.select().from(documentTemplates).orderBy(desc(documentTemplates.createdAt));
  }

  async getDocumentTemplate(id: string): Promise<DocumentTemplate | undefined> {
    const [template] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, id));
    return template;
  }

  async createDocumentTemplate(template: InsertDocumentTemplate): Promise<DocumentTemplate> {
    const [created] = await db.insert(documentTemplates).values(template).returning();
    return created;
  }

  async updateDocumentTemplate(id: string, updates: Partial<InsertDocumentTemplate>): Promise<DocumentTemplate> {
    const [updated] = await db.update(documentTemplates).set({ ...updates, updatedAt: new Date() }).where(eq(documentTemplates.id, id)).returning();
    return updated;
  }

  async deleteDocumentTemplate(id: string): Promise<void> {
    await db.delete(documentTemplates).where(eq(documentTemplates.id, id));
  }

  async listDocumentRuns(): Promise<any[]> {
    const result = await db.execute(sql`SELECT * FROM document_runs ORDER BY created_at DESC`);
    return result.rows as any[];
  }

  async getDocumentRun(id: string): Promise<any | undefined> {
    const result = await db.execute(sql`SELECT * FROM document_runs WHERE id = ${id}`);
    return (result.rows as any[])[0];
  }

  async createDocumentRun(run: { name: string; documentType?: string; description?: string; content: string; sourceFiles?: string[]; canvaDesignId?: string; canvaEditUrl?: string; canvaViewUrl?: string; design?: string }): Promise<any> {
    const filesArray = run.sourceFiles && run.sourceFiles.length > 0
      ? "{" + run.sourceFiles.map(f => '"' + f.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(",") + "}"
      : null;
    const result = await db.execute(sql`INSERT INTO document_runs (name, document_type, description, content, source_files, canva_design_id, canva_edit_url, canva_view_url, design) VALUES (${run.name}, ${run.documentType || null}, ${run.description || null}, ${run.content}, ${filesArray}, ${run.canvaDesignId || null}, ${run.canvaEditUrl || null}, ${run.canvaViewUrl || null}, ${run.design || null}) RETURNING *`);
    return (result.rows as any[])[0];
  }

  async updateDocumentRun(id: string, updates: { name?: string; content?: string; status?: string; design?: string }): Promise<any> {
    const setClauses: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { setClauses.push("name = $" + (values.length + 1)); values.push(updates.name); }
    if (updates.content !== undefined) { setClauses.push("content = $" + (values.length + 1)); values.push(updates.content); }
    if (updates.status !== undefined) { setClauses.push("status = $" + (values.length + 1)); values.push(updates.status); }
    if (updates.design !== undefined) { setClauses.push("design = $" + (values.length + 1)); values.push(updates.design); }
    if (setClauses.length === 0) return this.getDocumentRun(id);
    values.push(id);
    const result = await pool.query(`UPDATE document_runs SET ${setClauses.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    return result.rows[0];
  }

  async deleteDocumentRun(id: string): Promise<void> {
    await db.execute(sql`DELETE FROM document_runs WHERE id = ${id}`);
  }

  async getKnowledgeBaseItems(): Promise<KnowledgeBase[]> {
    return db.select().from(knowledgeBase).orderBy(desc(knowledgeBase.indexedAt));
  }

  async getKnowledgeBaseByFile(filePath: string): Promise<KnowledgeBase | undefined> {
    const [item] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.filePath, filePath));
    return item;
  }

  async upsertKnowledgeBaseItem(item: InsertKnowledgeBase): Promise<KnowledgeBase> {
    const existing = await this.getKnowledgeBaseByFile(item.filePath);
    if (existing) {
      const [updated] = await db.update(knowledgeBase)
        .set({ ...item, indexedAt: new Date() })
        .where(eq(knowledgeBase.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(knowledgeBase).values(item).returning();
    return created;
  }

  async clearKnowledgeBase(): Promise<void> {
    await db.delete(knowledgeBase);
  }

  async getChatThreadsForUser(userId: string): Promise<ChatThread[]> {
    const memberRows = await db.select({ threadId: chatThreadMembers.threadId })
      .from(chatThreadMembers)
      .where(eq(chatThreadMembers.userId, userId));
    const memberThreadIds = memberRows.map(r => r.threadId);

    const ownedThreads = await db.select().from(chatThreads)
      .where(eq(chatThreads.createdBy, userId));
    const ownedIds = ownedThreads.map(t => t.id);

    const allIds = Array.from(new Set([...ownedIds, ...memberThreadIds]));
    if (allIds.length === 0) return [];

    return db.select().from(chatThreads)
      .where(inArray(chatThreads.id, allIds))
      .orderBy(desc(chatThreads.updatedAt));
  }

  async getChatThread(id: string): Promise<ChatThread | undefined> {
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
    return thread;
  }

  async createChatThread(thread: InsertChatThread): Promise<ChatThread> {
    const [created] = await db.insert(chatThreads).values(thread).returning();
    return created;
  }

  async updateChatThread(id: string, updates: Partial<InsertChatThread>): Promise<ChatThread> {
    const [updated] = await db.update(chatThreads)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(chatThreads.id, id))
      .returning();
    return updated;
  }

  async deleteChatThread(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(chatMessages).where(eq(chatMessages.threadId, id));
      await tx.delete(chatThreadMembers).where(eq(chatThreadMembers.threadId, id));
      await tx.delete(chatThreads).where(eq(chatThreads.id, id));
    });
  }

  async getChatMessages(threadId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(chatMessages.createdAt);
  }

  async getChatMessage(id: string): Promise<ChatMessage | undefined> {
    const [msg] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return msg;
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [created] = await db.insert(chatMessages).values(message).returning();
    await db.update(chatThreads)
      .set({ updatedAt: new Date() })
      .where(eq(chatThreads.id, message.threadId));
    return created;
  }

  async updateChatMessage(id: string, content: string): Promise<ChatMessage> {
    const [updated] = await db.update(chatMessages)
      .set({ content })
      .where(eq(chatMessages.id, id))
      .returning();
    return updated;
  }

  async deleteChatMessage(id: string): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.id, id));
  }

  async searchChatMessages(userId: string, query: string): Promise<any[]> {
    const searchTerm = `%${query}%`;
    const results = await db
      .select({
        id: chatMessages.id,
        threadId: chatMessages.threadId,
        content: chatMessages.content,
        role: chatMessages.role,
        createdAt: chatMessages.createdAt,
        threadTitle: chatThreads.title,
      })
      .from(chatMessages)
      .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
      .leftJoin(chatThreadMembers, eq(chatThreads.id, chatThreadMembers.threadId))
      .where(
        and(
          ilike(chatMessages.content, searchTerm),
          or(
            eq(chatThreads.createdBy, userId),
            eq(chatThreadMembers.userId, userId),
          )
        )
      )
      .orderBy(chatMessages.createdAt)
      .limit(50);
    return results;
  }

  async getChatThreadMembers(threadId: string): Promise<ChatThreadMember[]> {
    return db.select().from(chatThreadMembers)
      .where(eq(chatThreadMembers.threadId, threadId));
  }

  async addChatThreadMember(member: InsertChatThreadMember): Promise<ChatThreadMember> {
    const existing = await db.select().from(chatThreadMembers)
      .where(and(
        eq(chatThreadMembers.threadId, member.threadId),
        eq(chatThreadMembers.userId, member.userId),
      ));
    if (existing.length > 0) return existing[0];
    const [created] = await db.insert(chatThreadMembers).values(member).returning();
    return created;
  }

  async removeChatThreadMember(threadId: string, userId: string): Promise<void> {
    await db.delete(chatThreadMembers)
      .where(and(
        eq(chatThreadMembers.threadId, threadId),
        eq(chatThreadMembers.userId, userId),
      ));
  }

  async markThreadSeen(threadId: string, userId: string): Promise<void> {
    await db.update(chatThreadMembers)
      .set({ seen: true })
      .where(and(
        eq(chatThreadMembers.threadId, threadId),
        eq(chatThreadMembers.userId, userId),
      ));
  }

  async markOtherMembersUnseen(threadId: string, senderId: string): Promise<void> {
    await db.update(chatThreadMembers)
      .set({ seen: false })
      .where(and(
        eq(chatThreadMembers.threadId, threadId),
        ne(chatThreadMembers.userId, senderId)
      ));
  }

  async getUnseenThreadCount(userId: string): Promise<number> {
    const rows = await db.select().from(chatThreadMembers)
      .where(and(
        eq(chatThreadMembers.userId, userId),
        eq(chatThreadMembers.seen, false),
      ));
    return rows.length;
  }

  async getMemories(userId: string): Promise<ChatbgpMemory[]> {
    return db.select().from(chatbgpMemories)
      .where(eq(chatbgpMemories.userId, userId))
      .orderBy(desc(chatbgpMemories.updatedAt));
  }

  async getMemoriesByCategory(userId: string, category: string): Promise<ChatbgpMemory[]> {
    return db.select().from(chatbgpMemories)
      .where(and(
        eq(chatbgpMemories.userId, userId),
        eq(chatbgpMemories.category, category),
      ))
      .orderBy(desc(chatbgpMemories.updatedAt));
  }

  async createMemory(memory: InsertChatbgpMemory): Promise<ChatbgpMemory> {
    const [created] = await db.insert(chatbgpMemories).values(memory).returning();
    return created;
  }

  async deleteMemory(id: string): Promise<void> {
    await db.delete(chatbgpMemories).where(eq(chatbgpMemories.id, id));
  }

  async clearMemories(userId: string): Promise<void> {
    await db.delete(chatbgpMemories).where(eq(chatbgpMemories.userId, userId));
  }

  async getCrmCompanies(filters?: { search?: string; groupName?: string; companyType?: string; includeBillingEntities?: boolean; page?: number; limit?: number }): Promise<{ data: CrmCompany[]; total: number } | CrmCompany[]> {
    // Hide companies that have been merged into another — they shouldn't
    // appear in any list view. Their FK references have been rewritten so
    // nothing depends on them any more.
    const conditions: any[] = [isNull(crmCompanies.mergedIntoId)];
    if (filters?.search) conditions.push(ilike(crmCompanies.name, `%${escapeLike(filters.search)}%`));
    if (filters?.groupName) conditions.push(eq(crmCompanies.groupName, filters.groupName));
    if (filters?.companyType) conditions.push(eq(crmCompanies.companyType, filters.companyType));
    // Hide invoicing/billing entities (Sage-imported SPVs, shell cos used for
    // invoicing) from the main CRM list by default. They're still resolvable
    // by ID for the deal page billing-entity link and KYC checks. Pass
    // includeBillingEntities=true or filter explicitly by companyType to see them.
    else if (!filters?.includeBillingEntities) {
      conditions.push(sql`(${crmCompanies.companyType} IS NULL OR ${crmCompanies.companyType} NOT IN ('Billing','Billing Entity'))`);
    }
    const where = and(...conditions);
    if (filters?.page && filters?.limit) {
      const offset = (filters.page - 1) * filters.limit;
      const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(crmCompanies).where(where);
      const data = await db.select().from(crmCompanies).where(where).orderBy(crmCompanies.name).limit(filters.limit).offset(offset);
      return { data, total: countResult.count };
    }
    return db.select().from(crmCompanies).where(where).orderBy(crmCompanies.name);
  }

  async getCrmCompany(id: string): Promise<CrmCompany | undefined> {
    const [c] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, id));
    return c;
  }

  async createCrmCompany(company: InsertCrmCompany): Promise<CrmCompany> {
    const [c] = await db.insert(crmCompanies).values(company).returning();
    return c;
  }

  async updateCrmCompany(id: string, updates: Partial<InsertCrmCompany>): Promise<CrmCompany> {
    const [c] = await db.update(crmCompanies).set({ ...updates, updatedAt: new Date() }).where(eq(crmCompanies.id, id)).returning();
    return c;
  }

  async deleteCrmCompany(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(crmDeals).set({ landlordId: null }).where(eq(crmDeals.landlordId, id));
      await tx.update(crmDeals).set({ tenantId: null }).where(eq(crmDeals.tenantId, id));
      await tx.update(crmDeals).set({ invoicingEntityId: null }).where(eq(crmDeals.invoicingEntityId, id));
      await tx.update(crmProperties).set({ landlordId: null }).where(eq(crmProperties.landlordId, id));
      await tx.update(crmProperties).set({ freeholderId: null }).where(eq(crmProperties.freeholderId, id));
      await tx.update(crmProperties).set({ longLeaseholderId: null }).where(eq(crmProperties.longLeaseholderId, id));
      await tx.update(crmProperties).set({ seniorLenderId: null }).where(eq(crmProperties.seniorLenderId, id));
      await tx.update(crmProperties).set({ juniorLenderId: null }).where(eq(crmProperties.juniorLenderId, id));
      await tx.update(crmContacts).set({ companyId: null }).where(eq(crmContacts.companyId, id));
      await tx.update(crmRequirementsLeasing).set({ companyId: null }).where(eq(crmRequirementsLeasing.companyId, id));
      await tx.delete(crmCompanyProperties).where(eq(crmCompanyProperties.companyId, id));
      await tx.delete(crmCompanyDeals).where(eq(crmCompanyDeals.companyId, id));
      await tx.delete(crmPropertyTenants).where(eq(crmPropertyTenants.companyId, id));
      await tx.delete(crmCompanies).where(eq(crmCompanies.id, id));
    });
  }

  async getCompanyProperties(companyId: string): Promise<CrmProperty[]> {
    const links = await db.select().from(crmCompanyProperties).where(eq(crmCompanyProperties.companyId, companyId));
    if (links.length === 0) return [];
    const propertyIds = links.map(l => l.propertyId);
    return db.select().from(crmProperties).where(inArray(crmProperties.id, propertyIds));
  }

  async linkCompanyProperty(companyId: string, propertyId: string): Promise<void> {
    const existing = await db.select().from(crmCompanyProperties).where(
      and(eq(crmCompanyProperties.companyId, companyId), eq(crmCompanyProperties.propertyId, propertyId))
    );
    if (existing.length === 0) {
      await db.insert(crmCompanyProperties).values({ companyId, propertyId });
    }
  }

  async unlinkCompanyProperty(companyId: string, propertyId: string): Promise<void> {
    await db.delete(crmCompanyProperties).where(
      and(eq(crmCompanyProperties.companyId, companyId), eq(crmCompanyProperties.propertyId, propertyId))
    );
  }

  async getAllCompanyPropertyLinks(): Promise<{ companyId: string; propertyId: string }[]> {
    return db.select({ companyId: crmCompanyProperties.companyId, propertyId: crmCompanyProperties.propertyId }).from(crmCompanyProperties);
  }

  async getCompanyDeals(companyId: string): Promise<CrmDeal[]> {
    const links = await db.select().from(crmCompanyDeals).where(eq(crmCompanyDeals.companyId, companyId));
    if (links.length === 0) return [];
    const dealIds = links.map(l => l.dealId);
    return db.select().from(crmDeals).where(inArray(crmDeals.id, dealIds));
  }

  async linkCompanyDeal(companyId: string, dealId: string): Promise<void> {
    const existing = await db.select().from(crmCompanyDeals).where(
      and(eq(crmCompanyDeals.companyId, companyId), eq(crmCompanyDeals.dealId, dealId))
    );
    if (existing.length === 0) {
      await db.insert(crmCompanyDeals).values({ companyId, dealId });
    }
  }

  async unlinkCompanyDeal(companyId: string, dealId: string): Promise<void> {
    await db.delete(crmCompanyDeals).where(
      and(eq(crmCompanyDeals.companyId, companyId), eq(crmCompanyDeals.dealId, dealId))
    );
  }

  async getAllCompanyDealLinks(): Promise<{ companyId: string; dealId: string }[]> {
    return db.select({ companyId: crmCompanyDeals.companyId, dealId: crmCompanyDeals.dealId }).from(crmCompanyDeals);
  }

  async getCrmContacts(filters?: { search?: string; groupName?: string; companyId?: string; contactType?: string; bgpAllocation?: string; page?: number; limit?: number }): Promise<{ data: CrmContact[]; total: number } | CrmContact[]> {
    const conditions: any[] = [];
    if (filters?.search) conditions.push(or(ilike(crmContacts.name, `%${escapeLike(filters.search)}%`), ilike(crmContacts.email, `%${escapeLike(filters.search)}%`)));
    if (filters?.groupName) conditions.push(eq(crmContacts.groupName, filters.groupName));
    if (filters?.companyId) conditions.push(eq(crmContacts.companyId, filters.companyId));
    if (filters?.contactType) conditions.push(eq(crmContacts.contactType, filters.contactType));
    if (filters?.bgpAllocation) conditions.push(sql`${crmContacts.bgpAllocation} LIKE ${'%' + escapeLike(filters.bgpAllocation) + '%'}`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    if (filters?.page && filters?.limit) {
      const offset = (filters.page - 1) * filters.limit;
      const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(crmContacts).where(where);
      const data = await db.select().from(crmContacts).where(where).orderBy(crmContacts.name).limit(filters.limit).offset(offset);
      return { data, total: countResult.count };
    }
    const rows = await db.select().from(crmContacts).where(where).orderBy(crmContacts.name);
    // Deduplicate within a company scope: keep the most-recently-updated row per (name, companyId).
    if (filters?.companyId) {
      const seen = new Map<string, typeof rows[0]>();
      for (const r of rows) {
        const key = `${(r.name || "").toLowerCase()}__${r.companyId || ""}`;
        const existing = seen.get(key);
        if (!existing || (r.updatedAt && (!existing.updatedAt || r.updatedAt > existing.updatedAt))) seen.set(key, r);
      }
      return Array.from(seen.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    return rows;
  }

  async getCrmContact(id: string): Promise<CrmContact | undefined> {
    const [c] = await db.select().from(crmContacts).where(eq(crmContacts.id, id));
    return c;
  }

  async createCrmContact(contact: InsertCrmContact): Promise<CrmContact> {
    const [c] = await db.insert(crmContacts).values(contact).returning();
    return c;
  }

  async updateCrmContact(id: string, updates: Partial<InsertCrmContact>): Promise<CrmContact> {
    const [c] = await db.update(crmContacts).set({ ...updates, updatedAt: new Date() }).where(eq(crmContacts.id, id)).returning();
    return c;
  }

  async deleteCrmContact(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(crmDeals).set({ clientContactId: null }).where(eq(crmDeals.clientContactId, id));
      await tx.update(crmDeals).set({ vendorAgentId: null }).where(eq(crmDeals.vendorAgentId, id));
      await tx.update(crmDeals).set({ acquisitionAgentId: null }).where(eq(crmDeals.acquisitionAgentId, id));
      await tx.update(crmDeals).set({ purchaserAgentId: null }).where(eq(crmDeals.purchaserAgentId, id));
      await tx.update(crmDeals).set({ leasingAgentId: null }).where(eq(crmDeals.leasingAgentId, id));
      await tx.update(crmRequirementsLeasing).set({ principalContactId: null }).where(eq(crmRequirementsLeasing.principalContactId, id));
      await tx.update(crmRequirementsLeasing).set({ agentContactId: null }).where(eq(crmRequirementsLeasing.agentContactId, id));
      await tx.delete(crmContactProperties).where(eq(crmContactProperties.contactId, id));
      await tx.delete(crmContactRequirements).where(eq(crmContactRequirements.contactId, id));
      await tx.delete(crmContactDeals).where(eq(crmContactDeals.contactId, id));
      await tx.delete(crmContacts).where(eq(crmContacts.id, id));
    });
  }

  async getCrmProperties(filters?: { search?: string; groupName?: string; status?: string; assetClass?: string; bgpEngagement?: string; page?: number; limit?: number }): Promise<{ data: CrmProperty[]; total: number } | CrmProperty[]> {
    const conditions: any[] = [];
    if (filters?.search) conditions.push(ilike(crmProperties.name, `%${escapeLike(filters.search)}%`));
    if (filters?.groupName) conditions.push(eq(crmProperties.groupName, filters.groupName));
    if (filters?.status) conditions.push(eq(crmProperties.status, filters.status));
    if (filters?.assetClass) conditions.push(sql`${crmProperties.assetClass} @> ARRAY[${filters.assetClass}]::text[]`);
    if (filters?.bgpEngagement) conditions.push(sql`${crmProperties.bgpEngagement} @> ARRAY[${filters.bgpEngagement}]::text[]`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    if (filters?.page && filters?.limit) {
      const offset = (filters.page - 1) * filters.limit;
      const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(crmProperties).where(where);
      const data = await db.select().from(crmProperties).where(where).orderBy(crmProperties.name).limit(filters.limit).offset(offset);
      return { data, total: countResult.count };
    }
    return db.select().from(crmProperties).where(where).orderBy(crmProperties.name);
  }

  async getCrmProperty(id: string): Promise<CrmProperty | undefined> {
    const [p] = await db.select().from(crmProperties).where(eq(crmProperties.id, id));
    return p;
  }

  async createCrmProperty(property: InsertCrmProperty): Promise<CrmProperty> {
    const [p] = await db.insert(crmProperties).values(property).returning();
    return p;
  }

  async updateCrmProperty(id: string, updates: Partial<InsertCrmProperty>): Promise<CrmProperty> {
    const [p] = await db.update(crmProperties).set({ ...updates, updatedAt: new Date() }).where(eq(crmProperties.id, id)).returning();
    return p;
  }

  async deleteCrmProperty(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(crmDeals).set({ propertyId: null }).where(eq(crmDeals.propertyId, id));
      await tx.delete(crmPropertyAgents).where(eq(crmPropertyAgents.propertyId, id));
      await tx.delete(crmPropertyTenants).where(eq(crmPropertyTenants.propertyId, id));
      await tx.delete(crmPropertyLeads).where(eq(crmPropertyLeads.propertyId, id));
      await tx.delete(crmContactProperties).where(eq(crmContactProperties.propertyId, id));
      await tx.delete(crmCompanyProperties).where(eq(crmCompanyProperties.propertyId, id));
      await tx.delete(crmReqInvestProperties).where(eq(crmReqInvestProperties.propertyId, id));
      await tx.delete(crmProperties).where(eq(crmProperties.id, id));
    });
  }

  async getCrmDeals(filters?: { search?: string; groupName?: string; status?: string; team?: string; dealType?: string; propertyId?: string; excludeTrackerDeals?: boolean; page?: number; limit?: number }): Promise<{ data: CrmDeal[]; total: number } | CrmDeal[]> {
    const conditions: any[] = [];
    if (filters?.search) conditions.push(ilike(crmDeals.name, `%${escapeLike(filters.search)}%`));
    if (filters?.groupName) conditions.push(eq(crmDeals.groupName, filters.groupName));
    if (filters?.status) conditions.push(eq(crmDeals.status, filters.status));
    if (filters?.team) conditions.push(eq(crmDeals.team, filters.team));
    if (filters?.dealType) conditions.push(eq(crmDeals.dealType, filters.dealType));
    if (filters?.propertyId) conditions.push(eq(crmDeals.propertyId, filters.propertyId));
    if (filters?.excludeTrackerDeals) {
      const trackerDealIds = await db
        .select({ dealId: availableUnits.dealId })
        .from(availableUnits)
        .where(sql`${availableUnits.dealId} IS NOT NULL`);
      const ids = trackerDealIds.map(r => r.dealId).filter(Boolean) as string[];
      if (ids.length > 0) {
        conditions.push(sql`${crmDeals.id} NOT IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
      }
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    if (filters?.page && filters?.limit) {
      const offset = (filters.page - 1) * filters.limit;
      const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(crmDeals).where(where);
      const data = await db.select().from(crmDeals).where(where).orderBy(desc(crmDeals.updatedAt)).limit(filters.limit).offset(offset);
      return { data, total: countResult.count };
    }
    return db.select().from(crmDeals).where(where).orderBy(desc(crmDeals.updatedAt));
  }

  async getCrmDeal(id: string): Promise<CrmDeal | undefined> {
    const [d] = await db.select().from(crmDeals).where(eq(crmDeals.id, id));
    return d;
  }

  async createCrmDeal(deal: InsertCrmDeal): Promise<CrmDeal> {
    const [d] = await db.insert(crmDeals).values(deal).returning();
    return d;
  }

  async updateCrmDeal(id: string, updates: Partial<InsertCrmDeal>): Promise<CrmDeal> {
    // Coerce any date-string values to Date objects for Drizzle timestamp columns
    const tsFields = ["kycApprovedAt", "targetDate", "exchangedAt", "completedAt", "invoicedAt", "amlEddCompletedAt", "amlIdVerifiedAt", "amlSarFiledAt"];
    const coerced: any = { ...updates };
    for (const f of tsFields) {
      if (coerced[f] && typeof coerced[f] === "string") {
        coerced[f] = new Date(coerced[f]);
      }
    }
    const [d] = await db.update(crmDeals).set({ ...coerced, updatedAt: new Date() }).where(eq(crmDeals.id, id)).returning();
    return d;
  }

  async deleteCrmDeal(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(crmRequirementsLeasing).set({ dealId: null }).where(eq(crmRequirementsLeasing.dealId, id));
      await tx.delete(crmDealLeads).where(eq(crmDealLeads.dealId, id));
      await tx.delete(crmCompanyDeals).where(eq(crmCompanyDeals.dealId, id));
      await tx.delete(crmContactDeals).where(eq(crmContactDeals.dealId, id));
      await tx.delete(crmReqInvestDeals).where(eq(crmReqInvestDeals.dealId, id));
      await tx.delete(dealFeeAllocations).where(eq(dealFeeAllocations.dealId, id));
      await tx.delete(crmDeals).where(eq(crmDeals.id, id));
    });
  }

  async getDealFeeAllocations(dealId: string): Promise<DealFeeAllocation[]> {
    return db.select().from(dealFeeAllocations).where(eq(dealFeeAllocations.dealId, dealId)).orderBy(dealFeeAllocations.createdAt);
  }

  async setDealFeeAllocations(dealId: string, allocations: InsertDealFeeAllocation[]): Promise<DealFeeAllocation[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(dealFeeAllocations).where(eq(dealFeeAllocations.dealId, dealId));
      if (allocations.length === 0) return [];
      const rows = allocations.map(a => ({ ...a, dealId }));
      return tx.insert(dealFeeAllocations).values(rows).returning();
    });
  }

  async getCrmRequirementsLeasing(filters?: { search?: string; groupName?: string; status?: string }): Promise<CrmRequirementsLeasing[]> {
    const conditions: any[] = [];
    if (filters?.search) conditions.push(ilike(crmRequirementsLeasing.name, `%${escapeLike(filters.search)}%`));
    if (filters?.groupName) conditions.push(eq(crmRequirementsLeasing.groupName, filters.groupName));
    if (filters?.status) conditions.push(eq(crmRequirementsLeasing.status, filters.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(crmRequirementsLeasing).where(where).orderBy(crmRequirementsLeasing.name);
  }

  async getCrmRequirementLeasing(id: string): Promise<CrmRequirementsLeasing | undefined> {
    const [r] = await db.select().from(crmRequirementsLeasing).where(eq(crmRequirementsLeasing.id, id));
    return r;
  }

  async createCrmRequirementLeasing(req: InsertCrmRequirementsLeasing): Promise<CrmRequirementsLeasing> {
    const [r] = await db.insert(crmRequirementsLeasing).values(req).returning();
    return r;
  }

  async updateCrmRequirementLeasing(id: string, updates: Partial<InsertCrmRequirementsLeasing>): Promise<CrmRequirementsLeasing> {
    const [r] = await db.update(crmRequirementsLeasing).set({ ...updates, updatedAt: new Date() }).where(eq(crmRequirementsLeasing.id, id)).returning();
    return r;
  }

  async deleteCrmRequirementLeasing(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(crmContactRequirements).where(eq(crmContactRequirements.requirementId, id));
      await tx.delete(crmRequirementsLeasing).where(eq(crmRequirementsLeasing.id, id));
    });
  }

  async getCrmRequirementsInvestment(filters?: { search?: string; groupName?: string }): Promise<CrmRequirementsInvestment[]> {
    const conditions: any[] = [];
    if (filters?.search) conditions.push(ilike(crmRequirementsInvestment.name, `%${escapeLike(filters.search)}%`));
    if (filters?.groupName) conditions.push(eq(crmRequirementsInvestment.groupName, filters.groupName));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(crmRequirementsInvestment).where(where).orderBy(crmRequirementsInvestment.name);
  }

  async getCrmRequirementInvestment(id: string): Promise<CrmRequirementsInvestment | undefined> {
    const [r] = await db.select().from(crmRequirementsInvestment).where(eq(crmRequirementsInvestment.id, id));
    return r;
  }

  async createCrmRequirementInvestment(req: InsertCrmRequirementsInvestment): Promise<CrmRequirementsInvestment> {
    const [r] = await db.insert(crmRequirementsInvestment).values(req).returning();
    return r;
  }

  async updateCrmRequirementInvestment(id: string, updates: Partial<InsertCrmRequirementsInvestment>): Promise<CrmRequirementsInvestment> {
    const now = new Date();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentMonthYear = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    const [r] = await db.update(crmRequirementsInvestment).set({ ...updates, requirementDate: currentMonthYear, updatedAt: now }).where(eq(crmRequirementsInvestment.id, id)).returning();
    return r;
  }

  async deleteCrmRequirementInvestment(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(crmReqInvestProperties).where(eq(crmReqInvestProperties.requirementId, id));
      await tx.delete(crmReqInvestDeals).where(eq(crmReqInvestDeals.requirementId, id));
      await tx.delete(crmRequirementsInvestment).where(eq(crmRequirementsInvestment.id, id));
    });
  }

  async getCrmComps(filters?: { search?: string; groupName?: string; dealType?: string }): Promise<CrmComp[]> {
    const conditions: any[] = [];
    if (filters?.search) conditions.push(ilike(crmComps.name, `%${escapeLike(filters.search)}%`));
    if (filters?.groupName) conditions.push(eq(crmComps.groupName, filters.groupName));
    if (filters?.dealType) conditions.push(eq(crmComps.dealType, filters.dealType));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(crmComps).where(where).orderBy(crmComps.name);
  }

  async getCrmComp(id: string): Promise<CrmComp | undefined> {
    const [c] = await db.select().from(crmComps).where(eq(crmComps.id, id));
    return c;
  }

  async createCrmComp(comp: InsertCrmComp): Promise<CrmComp> {
    const [c] = await db.insert(crmComps).values(comp).returning();
    return c;
  }

  async updateCrmComp(id: string, updates: Partial<InsertCrmComp>): Promise<CrmComp> {
    const [c] = await db.update(crmComps).set({ ...updates, updatedAt: new Date() }).where(eq(crmComps.id, id)).returning();
    return c;
  }

  async deleteCrmComp(id: string): Promise<void> {
    await db.delete(crmComps).where(eq(crmComps.id, id));
  }

  async getCrmLeads(filters?: { search?: string; groupName?: string; status?: string; leadType?: string }): Promise<CrmLead[]> {
    const conditions: any[] = [];
    if (filters?.search) conditions.push(or(ilike(crmLeads.name, `%${escapeLike(filters.search)}%`), ilike(crmLeads.email, `%${escapeLike(filters.search)}%`)));
    if (filters?.groupName) conditions.push(eq(crmLeads.groupName, filters.groupName));
    if (filters?.status) conditions.push(eq(crmLeads.status, filters.status));
    if (filters?.leadType) conditions.push(eq(crmLeads.leadType, filters.leadType));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(crmLeads).where(where).orderBy(desc(crmLeads.createdAt));
  }

  async getCrmLead(id: string): Promise<CrmLead | undefined> {
    const [l] = await db.select().from(crmLeads).where(eq(crmLeads.id, id));
    return l;
  }

  async createCrmLead(lead: InsertCrmLead): Promise<CrmLead> {
    const [l] = await db.insert(crmLeads).values(lead).returning();
    return l;
  }

  async updateCrmLead(id: string, updates: Partial<InsertCrmLead>): Promise<CrmLead> {
    const [l] = await db.update(crmLeads).set({ ...updates, updatedAt: new Date() }).where(eq(crmLeads.id, id)).returning();
    return l;
  }

  async deleteCrmLead(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(crmPropertyLeads).where(eq(crmPropertyLeads.leadId, id));
      await tx.delete(crmDealLeads).where(eq(crmDealLeads.leadId, id));
      await tx.delete(crmLeads).where(eq(crmLeads.id, id));
    });
  }

  async crmSearchAll(query: string): Promise<{ type: string; id: string; name: string; detail?: string }[]> {
    const results: { type: string; id: string; name: string; detail?: string }[] = [];
    const q = `%${query}%`;
    const [props, deals, companies, contactsR, leads, comps] = await Promise.all([
      db.select().from(crmProperties).where(ilike(crmProperties.name, q)).limit(10),
      db.select({
        deal: crmDeals,
        propertyName: crmProperties.name,
      }).from(crmDeals)
        .leftJoin(crmProperties, eq(crmDeals.propertyId, crmProperties.id))
        .where(or(ilike(crmDeals.name, q), ilike(crmProperties.name, q)))
        .limit(10),
      db.select().from(crmCompanies).where(ilike(crmCompanies.name, q)).limit(10),
      db.select().from(crmContacts).where(or(ilike(crmContacts.name, q), ilike(crmContacts.email, q))).limit(10),
      db.select().from(crmLeads).where(ilike(crmLeads.name, q)).limit(10),
      db.select().from(crmComps).where(ilike(crmComps.name, q)).limit(10),
    ]);
    props.forEach(p => results.push({ type: "property", id: p.id, name: p.name, detail: p.status || undefined }));
    deals.forEach(({ deal: d, propertyName }) => results.push({ type: "deal", id: d.id, name: propertyName || d.name, detail: d.groupName || undefined }));
    companies.forEach(c => results.push({ type: "company", id: c.id, name: c.name, detail: c.companyType || undefined }));
    contactsR.forEach(c => results.push({ type: "contact", id: c.id, name: c.name, detail: c.email || undefined }));
    leads.forEach(l => results.push({ type: "lead", id: l.id, name: l.name, detail: l.status || undefined }));
    comps.forEach(c => results.push({ type: "comp", id: c.id, name: c.name }));
    return results;
  }

  async getCrmStats(): Promise<{ properties: number; deals: number; companies: number; contacts: number; leads: number; comps: number; requirementsLeasing: number; requirementsInvestment: number }> {
    const [[p], [d], [co], [ct], [l], [cm], [rl], [ri]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(crmProperties),
      db.select({ count: sql<number>`count(*)` }).from(crmDeals),
      db.select({ count: sql<number>`count(*)` }).from(crmCompanies),
      db.select({ count: sql<number>`count(*)` }).from(crmContacts),
      db.select({ count: sql<number>`count(*)` }).from(crmLeads),
      db.select({ count: sql<number>`count(*)` }).from(crmComps),
      db.select({ count: sql<number>`count(*)` }).from(crmRequirementsLeasing),
      db.select({ count: sql<number>`count(*)` }).from(crmRequirementsInvestment),
    ]);
    return {
      properties: Number(p.count), deals: Number(d.count), companies: Number(co.count),
      contacts: Number(ct.count), leads: Number(l.count), comps: Number(cm.count),
      requirementsLeasing: Number(rl.count), requirementsInvestment: Number(ri.count),
    };
  }

  async getAppChangeRequests(): Promise<AppChangeRequest[]> {
    return db.select().from(appChangeRequests).orderBy(desc(appChangeRequests.createdAt));
  }

  async getAppChangeRequest(id: string): Promise<AppChangeRequest | undefined> {
    const [request] = await db.select().from(appChangeRequests).where(eq(appChangeRequests.id, id));
    return request;
  }

  async createAppChangeRequest(request: InsertAppChangeRequest): Promise<AppChangeRequest> {
    const [created] = await db.insert(appChangeRequests).values(request).returning();
    return created;
  }

  async updateAppChangeRequest(id: string, updates: Partial<InsertAppChangeRequest & { reviewedAt?: Date; approvedAt?: Date }>): Promise<AppChangeRequest> {
    const [updated] = await db.update(appChangeRequests).set(updates).where(eq(appChangeRequests.id, id)).returning();
    return updated;
  }

  async getAvailableUnits(filters?: { propertyId?: string; marketingStatus?: string }): Promise<AvailableUnit[]> {
    const conditions: any[] = [];
    if (filters?.propertyId) conditions.push(eq(availableUnits.propertyId, filters.propertyId));
    if (filters?.marketingStatus) conditions.push(eq(availableUnits.marketingStatus, filters.marketingStatus));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(availableUnits).where(where).orderBy(desc(availableUnits.createdAt));
  }

  async getAvailableUnit(id: string): Promise<AvailableUnit | undefined> {
    const [unit] = await db.select().from(availableUnits).where(eq(availableUnits.id, id));
    return unit;
  }

  async createAvailableUnit(unit: InsertAvailableUnit): Promise<AvailableUnit> {
    const [created] = await db.insert(availableUnits).values(unit).returning();
    return created;
  }

  async updateAvailableUnit(id: string, updates: Partial<InsertAvailableUnit>): Promise<AvailableUnit> {
    const [updated] = await db.update(availableUnits).set({ ...updates, updatedAt: new Date() }).where(eq(availableUnits.id, id)).returning();
    return updated;
  }

  async deleteAvailableUnit(id: string): Promise<void> {
    const { unitMarketingFiles } = await import("@shared/schema");
    const files = await db.select().from(unitMarketingFiles).where(eq(unitMarketingFiles.unitId, id));
    await db.transaction(async (tx) => {
      await tx.delete(unitMarketingFiles).where(eq(unitMarketingFiles.unitId, id));
      await tx.delete(availableUnits).where(eq(availableUnits.id, id));
    });
    for (const f of files) {
      const fullPath = path.join(process.cwd(), f.filePath);
      try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (err) {
        console.warn(`[deleteAvailableUnit] Failed to delete file ${fullPath}:`, err);
      }
    }
  }
}

export const storage = new DatabaseStorage();
