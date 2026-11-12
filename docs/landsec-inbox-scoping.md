# One Landsec email address and one WhatsApp number that read and allocate

Scoping study, 12 November 2026. Asked for by Woody: "Can we set up the Landsec
site with its own email address and WhatsApp number so that everyone can send
emails to it and WhatsApps and then it reads and allocates appropriately?"

Nothing here is built. Every claim about the app is from reading the code.
Meta's WhatsApp rules are from general knowledge and need checking in WhatsApp
Manager before anything is promised.

## 1. What exists today, and what does not

WhatsApp (server/whatsapp.ts)
- One number. `getWhatsAppConfig()` reads `WHATSAPP_PHONE_NUMBER_ID`, the token, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`.
- Inbound arrives at `POST /api/whatsapp/webhook` in `setupWhatsAppRoutes()`. It checks Meta's `x-hub-signature-256` (`verifyWebhookSignature`) and refuses when the app secret is missing.
- It handles text, documents, images, voice notes and contact cards. It does not handle video, location, or the `context` field (replies and forwards). It never reads `value.metadata.phone_number_id`, so it cannot tell which business number received a message.
- Who may use it: `resolveUserIdFromPhone()` matches the sender to `users.phone`. `runChatBgpWhatsAppReply()` then allows BGP staff only. Unknown numbers and client logins get a fixed "this number is for BGP staff" reply. So Landsec people and joint agents are refused today, by design.
- What it does with a staff message: a full ChatBGP tool session (`chatbgp.callClaude`, which follows `CHATBGP_PROVIDER`), a contact lookup lane (`tryWhatsAppContactLookup`), receipts (`tryMatchReceiptToExpense`), brochure and "import this" ingest (`tryIngestBrochure`, `ingestBytes`), and lead extraction on every message over 10 characters (`autoProcessAndPush`).
- Attachments are downloaded with `downloadWhatsAppMedia()` and saved in Postgres through `saveFile()` under `chat-media/` (server/file-storage.ts, table `file_storage`). They are not filed to a unit.
- Voice notes go to OpenAI Whisper (`transcribeWhatsAppAudio`). That breaks the Anthropic-only rule if a Landsec voice note ever arrives there.
- Storage: `wa_conversations` (keyed on the sender's number only) and `wa_messages` (shared/schema.ts). `storage.createWaMessage()` is a plain insert with no check on `wa_message_id`, so a Meta retry would be processed twice.

Email
- Staff mailbox sync: `startAutoSync()` in server/interactions.ts runs `runInteractionSync(120, 90)` every hour with an app-only Graph token (`getAppToken()` in server/shared-mailbox.ts). It reads the mailbox of every `users` row on the BGP domain (`getBgpEmails()`).
- Why the app holds only a subject and a short preview: `syncEmailsForUser()` asks Graph for `id, conversationId, subject, bodyPreview, from, toRecipients, ccRecipients, receivedDateTime` only. Graph's `bodyPreview` is capped at 255 characters and the insert trims it to 200. No body and no attachments are requested. A row is written to `crm_interactions` only when the message matches a CRM contact (`contact_id` is NOT NULL), so mail with nobody known is dropped.
- Why the log may have stopped on 24 October: the code cannot prove it, but it shows three weaknesses. (a) The sync is a bare `setInterval` with no run at boot, so the first run is one hour after each deploy. (b) `graphGet()` has no timeout, and a hung call leaves `interactionSyncState.running` true, after which every hourly tick returns silently until the next restart. (c) A failure of `getAppToken()` is only a console line ("[interactions] Auto-sync failed"); nothing is stored or alerted. docs/railway-incident-2026-10-21.md lists `AZURE_CLIENT_SECRET` and `AZURE_SECRET_V2` for rotation that week, which is the likeliest cause. Check `GET /api/interactions/sync-status`, `GET /api/interactions/sync-health` and the Railway logs.
- Offer and interest detection: `syncOfferEmails()` and `syncInterestEmails()` in server/viewing-sync.ts. Rules only, no AI. They read subject and preview, need a known outside contact linked to a brand (`loadViewingPeople`) and a tracker unit (`resolveUnit`, `resolveUnitByNameOnly`). They write unconfirmed rows to `unit_offers` and `unit_interest`, one per thread (`email_conversation_id`). `backfillActivityFromInteractions()` is the 14 August backfill behind the junk rows.
- Reading a full email on demand already exists: `loadSourceEmail()` and `POST /api/tracker/offer/:offerId/extract` in server/tracker-provenance.ts fetch the thread from Graph and ask Claude (direct Anthropic SDK) for the figures as suggestions only.
- A shared mailbox reader already exists and is switched off. server/email-processor.ts polls `chatbgp@brucegillinghampollard.com` every two minutes (`startEmailProcessor`, `processNewEmails`), fetches the full body, recovers forward-as-attachment mail (`extractForwardedMessageText`), classifies (`classifyEmail`), acts for staff senders only (`isStaffUser`, `processInstruction`), ingests attachments (`fetchAndIngestAttachments`), replies, and logs to `chatbgp_email_log` (no body kept). The call in server/index.ts line 5504 is commented out ("DISABLED - maintenance mode"); an admin can start it with `POST /api/email-processor/toggle`. The mailbox address is a hard-coded constant.
- `email_ingest` (schema.ts) already stores full body text with an `inbox_id`, filled by `GET /api/news-intel/inbox` in server/news-intelligence.ts. It is the nearest existing shape for an inbound message table.
- An inbound email webhook exists: `POST /api/public/resend-inbound` in server/routes.ts (line 4929) with `verifyResendWebhook`. It only forwards bruces.app mail to Woody.
- There are no Microsoft Graph subscriptions anywhere. Everything polls. server/agentmail.ts is an unused client.

Filing doors that exist
- Offer: `createTrackerOffer()` in server/leasing-viewings.ts, behind `POST /api/available-units/:id/offers`; confirm with `POST /api/leasing-viewings/:id/offers/:offerId/confirm`. ChatBGP tool `log_offer`.
- Viewing: `createTrackerViewing()`, behind `POST /api/available-units/:id/viewings`. ChatBGP tool `log_viewing` (`executeLeasingActivity` in server/chatbgp.ts). A viewing with no unit sits in the "needs details" queue.
- Interest: `POST /api/available-units/:id/interest`; promote to a target with `POST /api/tracker/interest/:interestId/add-target`.
- Unit file: `POST /api/available-units/:id/files` (table `unit_marketing_files`, categories brochure, floorplan, photo, other). `addUnitFile()` in server/letting-tracker-chat.ts does the same but is not exported.
- Heads of terms: `PUT /api/available-units/:id/hots` (`available_units.hots_content`); server/deal-hots-from-records.ts reads terms from a heads document into empty deal fields.
- Legal update: `PUT /api/landsec/unit/:id` in server/landsec-unit.ts writes `landsec_units.legal_progress` and `solicitor_catchups`, and the solicitor fields on the deal. `PUT /api/landsec/deal/:id/clock` writes who the deal waits on.
- Brief comment: `POST /api/unit-briefs/:id/comments` in server/unit-brief-workspace.ts (`unit_brief_comments`). Target brand: `POST /api/unit-briefs/:id/targets` in routes.ts (`unit_target_operators`). ChatBGP has `create_targeting_brief` but no tool to comment on a brief, add one target to an existing brief, or attach a file to an existing unit.
- Generic file reading: server/ingest-routes.ts and server/universal-ingest.ts (Anthropic SDK direct, preview then commit). Its targets are schedules, deals, companies, contacts, properties, comps, requirements and lease events. It has no offer, viewing or unit-file target.

Who a sender is
- `users.email` and `users.phone`; `landsec_access` (user, role, schemes, firm); `unit_brief_people` (email, role, brief; no phone); `crm_contacts` (`email`, `phone`, `phone_mobile`).

The AI lock
- `runLandsecLocked()` and `isLandsecLocked()` in server/utils/ai-provider.ts. `landsecAiLockMiddleware()` in server/landsec-access.ts applies it per `/api` request. The WhatsApp webhook and every background job run outside it, and `callClaude()` in server/utils/anthropic-client.ts follows `AI_PROVIDER`.

What does not exist
- No Landsec address or number. No table that keeps a full inbound message with its allocation. No triage list for messages. No link from an email attachment to a unit. No phone numbers for Landsec people against schemes. No general note or correspondence timeline on a unit. No file category for heads of terms or legal papers. No per-file visibility flag: a file on a unit is visible to that scheme's asset manager and joint agent (`restrictedLandsecApiDecision`).

## 2. The simplest design that works

Email: recommend a shared mailbox in BGP's Microsoft 365, for example landsec@brucegillinghampollard.com.
- It needs no new permission in code terms. The app already reads any mailbox by address with the app-only token (`getUserMailMessages()` in shared-mailbox.ts). Check in Entra that no application access policy limits the app to named mailboxes.
- Read it with a small poller modelled on `processNewEmails()`, every two minutes, with the mailbox as a parameter. Do not switch the chatbgp@ processor back on for this: that path replies and runs tools.
- Ask Graph for the full body, the attachments and the message headers. Exchange has already applied SPF, DKIM and DMARC, and the result is in the headers.
- Store each message in a new table (working name `landsec_inbox`): sender, recipients, subject, plain-text body, Graph immutable id and conversation id, received time, proposed and final allocation, status, who confirmed. Store attachments in `file_storage` under their own prefix until filed.
- Contract meaning. The mail stays in BGP's tenant, and the copy sits in the same Railway Postgres that already holds every Landsec record. That is one more thing the audit right and the return-or-delete clause cover, so the export and delete on the roadmap must include this table and its files, and the mailbox needs a retention setting. The line in docs/landsec-outside-services.md that says attachments stay in Microsoft 365 would no longer be true and must be changed.
- The alternative, an address on a subdomain through Resend's inbound webhook, is half built (`/api/public/resend-inbound`) and is push rather than poll. I do not recommend it. Full Landsec bodies and attachments would pass through and rest with another processor, the page of outside services would grow, spam and spoof checks would be ours to write, and nobody could open the mailbox in Outlook when the app is wrong.
- Graph change notifications are not needed at first. Polling every two minutes is enough and has no public endpoint to secure or subscription to renew.

WhatsApp: recommend a second number on the existing WhatsApp Business account.
- A second number gives a clean boundary: anything arriving on that number is Landsec, known before any AI sees it. The handler branches on `value.metadata.phone_number_id`, runs inside `runLandsecLocked()`, and skips the staff assistant, Whisper and lead extraction.
- A Landsec route on the existing number is the wrong way round. That number is the staff assistant: every message goes to a tool session on whichever provider is switched on. The app would have to decide "is this Landsec?" after the content had already been read.
- Do not add the number in Meta before the code branch ships. Today the webhook ignores which number received a message, so the new number would behave as ChatBGP and reply from the old one.
- What Meta requires (to confirm): a number that can take an SMS or voice code and is not registered on the ordinary WhatsApp or Business app; adding it in WhatsApp Manager under the same account; a display name that passes review (a name using "Landsec" may need Landsec's consent); registering it through the Cloud API with a PIN. The same app, webhook, token and secret serve both. Replies inside 24 hours of a person's message are free-form; anything later needs an approved template.
- Groups. The number cannot be added to the team's WhatsApp groups and cannot read them. Meta has a limited groups feature for API numbers; I have not verified eligibility and would not plan on it. So "everyone can WhatsApp it" means each person messages or forwards to the number one to one. A forwarded message carries no original author, so the forwarder is recorded as the sender.
- Voice notes: Anthropic's API does not take audio. On the Landsec number, keep the audio and put it in triage for a person, or decline it. Do not send it to Whisper.

## 3. How a message gets allocated

Step A, who sent it (rules only)
- Email: exact address against `users.email`, then `unit_brief_people.email`, then `crm_contacts.email`. Require a DMARC pass for a BGP or Landsec domain. WhatsApp: full-number match against `users.phone`, then `crm_contacts.phone_mobile`. Tighten the suffix match in `resolveUserIdFromPhone()` for this use.
- Result: BGP staff; a Landsec login with its role and schemes from `landsec_access`; a joint agent login; a known CRM contact with no login; unknown.
- Unknown senders are held unread. No AI reads them until a BGP person releases them.

Step B, what it is about (rules before AI)
- Same thread as a message already filed (Graph `conversationId`, the precedent is `unit_offers.email_conversation_id`): same unit.
- A deal reference number (`crm_deals.deal_ref`) in the subject or text.
- Scheme by the registry matchers in server/landsec-schemes.ts (`LANDSEC_SCHEMES`, `schemeForPropertyName`), limited to the sender's schemes for asset managers and joint agents.
- Unit by the existing matchers (`resolveUnit`, `resolveUnitByNameOnly`, which need exporting) plus the landlord unit code on the schedule rows (`leasing_schedule_units.unit_code`).
- Brand by `loadViewingPeople()` and the brand index, and "this brand has exactly one live deal or target on this scheme".

Step C, AI reading, Anthropic only
- One call with no tools, through the direct Anthropic client (as tracker-provenance.ts does), wrapped in `runLandsecLocked()`. It receives the message, extracted attachment text, and a short candidate list (the schemes the sender may use, the units and live deals on the matched schemes). It returns JSON: kind, scheme, unit chosen from the list only, brand, extracted fields, confidence and reasons. Code rejects any id not on the list.

Step D, where each kind is filed
- Offer: `unit_offers`, through `createTrackerOffer`, as an unconfirmed row (`source` set, `confirmed_at` empty). Figures are suggestions a person accepts. The Landsec unit page then shows it against the NER floor.
- Viewing with a date: `unit_viewings`, through `createTrackerViewing`. A request with no date: `unit_interest`.
- Heads of terms: the document to `unit_marketing_files` (needs a new category, today only "other" fits); terms offered as suggestions to the deal through `updateDeal` in server/letting-service.ts. Never sent on: the contract wants Landsec's written approval.
- Plan or photo: `unit_marketing_files` with category floorplan or photo.
- Legal update: a line in `landsec_units.solicitor_catchups` and `legal_progress`, through `PUT /api/landsec/unit/:id`; who it waits on through `PUT /api/landsec/deal/:id/clock`.
- Brief comment: `unit_brief_comments`, through `POST /api/unit-briefs/:id/comments`, only when the sender has a login (the comment is attributed to a user), and marked as received by email.
- Target-brand idea: `unit_target_operators`, through `POST /api/unit-briefs/:id/targets`. Not for joint agents, who may not change targets.
- General note: nowhere suitable exists. Keep it in the inbox table, linked to the scheme or unit, and show it as a correspondence list on the unit page for BGP staff.
- Filing should run as the sender or the confirming user (a request object carrying that user id, as `runChatBgpWhatsAppReply` builds), so the existing checks (`briefAccess`, `assertUnitInClientScope`, `landsecViewer`) still decide what is allowed.

Step E, when it is not sure
- Everything lands in a triage list on the Landsec workspace, BGP staff only, showing the message, the proposal and the reasons. A person confirms, changes or dismisses. Nothing is written on a guess. Nothing is sent to anyone. At first every item needs one click; later, only items where the rules alone pin the unit and the sender is BGP staff may file themselves as unconfirmed records with an undo.
- The raw message stays BGP-only. Joint agents never see BGP's email history.

## 4. What only the owner can do or decide
1. Create the shared mailbox and choose the address. Decide whether Exchange should accept mail only from listed senders or domains.
2. Buy or assign the WhatsApp number, add it in Meta, pass the display-name review, and agree the name with Landsec if it uses theirs.
3. Who may send: BGP staff only at first, or also Landsec leasing managers, asset managers and joint agents. Whether brands, tenants' agents and solicitors may write to it at all.
4. Whether Landsec people and joint agents are told about it, and when. Whether it is shown in the pitch as live or as roadmap.
5. Whether the sender gets a receipt ("filed to unit X, awaiting confirmation"). That is an automatic send, so it is off unless he says so.
6. Retention: how long bodies and attachments are kept in the app and in the mailbox, and that they are part of the return-or-delete at contract end.
7. Approve the new table and the new file category (the project rule is to ask before touching the shared schema).
8. Record mobile numbers for the Landsec people who will use WhatsApp.
9. Confirm the Azure secret was rotated and reset on Railway, and that `AI_PROVIDER` stays unset.

## 5. Build plan
1. Medium, the first thing worth showing. Email only, BGP staff senders only. Poll the new mailbox, store the full message and attachments, run the rules and one locked Anthropic read, show a "Landsec inbox" triage list, and file two kinds with one click: an offer (unconfirmed row on the unit) and a document (unit file). Demo: forward an "OFFER: Brand (unit)" email and watch it appear against the right unit with the NER check. There is no smaller step that includes a real address.
2. Small, and due before any demo regardless. Make the staff mailbox sync visible and robust: a stored last-success time, a run at boot, a timeout on Graph calls, an alert on failure. Find the actual cause of the 24 October stop.
3. Medium. The other kinds: viewing and interest, heads of terms (file plus suggested terms), legal update, brief comment, target idea, general note. Thread continuity. The correspondence list on the unit page.
4. Small. Open sending to Landsec logins and joint agents, with scheme limits from `landsec_access` and the role rules.
5. Medium. WhatsApp second number: branch on the receiving number, Landsec handler inside the lock, media into the same inbox, dedupe on `wa_message_id`, no Whisper, no tool session. Start Meta's number and name review early; it can take days.
6. Small. Audit and paperwork: each filing records who, what and why; include the inbox in export and delete; update docs/landsec-outside-services.md and server/chatbgp-app-map.ts.
7. Medium to large, after the pitch. Self-filing for high-confidence items with undo, a per-file visibility flag, Graph change notifications in place of polling, a decision on voice notes.

## 6. Risks
- Misfiling. Unit codes differ between sources and many units share names. A wrong unit puts an offer in front of the wrong asset manager. Mitigation: candidates from the app only, confirmation by a person, an undo.
- Confidential material on the wrong unit. A unit file is visible to that scheme's asset manager and joint agent, and there is no per-file visibility. An offer email or a fee note filed as a unit file would leak. Keep attachments BGP-only until a person chooses where they go.
- Spoofed senders. An email From line can be forged; a WhatsApp number in practice cannot. Require a DMARC pass, match exact addresses, hold unknown senders, and never let a message change access or send anything.
- Instructions hidden in a message. The reader must have no tools and may only choose from ids the code supplied.
- The AI clause. Background jobs are outside the per-request lock, so the reader must be wrapped in `runLandsecLocked()` and use the Anthropic client directly. Whisper, and any OCR outside the tenant, must not be on this path. The clause says "operated solely within your own secure environment"; Anthropic's API is an outside service, which is already the position taken in docs/landsec-outside-services.md and worth stating plainly to Landsec.
- Volume and cost. About 5,800 Landsec emails in three months already pass through staff mailboxes. If people copy the address on everything, triage becomes a second inbox nobody clears. Start with forwarding by BGP staff, and measure.
- Duplicates. The same email forwarded by three people, or a Meta retry, must make one item (immutable id, conversation id, attachment hash).
- Reliability. The existing sync failed silently for weeks. The new poller needs the same visibility as step 2 from day one.
- Expectation. Group chats cannot be read, and voice notes cannot be transcribed under the Anthropic-only rule. Say so before anyone is told "just WhatsApp it".
