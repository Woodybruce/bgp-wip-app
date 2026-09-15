# Chat media ownership — proposed follow-up

Prepared 6 September 2026 after the audit. This design is not applied. Woody's requirement is to preserve full client use of authorised properties, deals and shared documents.

## Why this cannot safely be fixed with a filename check

`file_storage` has no owner or access-grant metadata. `user_upload_history` records only some upload paths and is best-effort. Generated PDF/Word/PowerPoint files, pasted images, direct ChatBGP uploads, and email/WhatsApp saves are not consistently represented there. Chat message text, attachment URLs and the caller-supplied message role cannot establish ownership. Treating an arbitrary URL pasted into a conversation as a grant would recreate the access bug. Restricting all files to upload-history owners would break legitimate generated and shared documents.

The current patch verifies active accounts on query-token downloads and prevents private media being cached after account changes. It does **not** claim to fix file-level authorization.

## Proposed change for approval

1. Add owner/generator identity to stored file metadata and a separate `file_access_grants` relation, keyed by storage key and trusted parent: conversation, property, deal or company. Direct user grants support files that have not yet been posted into a thread. Store who created each grant and when.
2. Have every upload/generation/storage entry point record provenance at the same time as the file. Background jobs must pass their requesting user and parent explicitly. Anonymous KYC uploads receive their verified upload-token parent, not a parent supplied without validation.
3. Before adding a file to a message or another entity, verify that the sender already has access to it. Only then create a parent grant. Download permission follows current thread membership or existing property/deal/company access, so shared-property users retain access and removal from a thread takes effect. Keep file permissions out of editable message text and role fields.
4. Inventory legacy files in a read-only report using upload history, generated-file records, KYC rows and trusted parent associations. Separate verified mappings from ambiguous/dangling links. Do not infer ownership from a display filename or a URL alone.
5. Apply reviewed mappings, report unresolved files for assignment, then enable enforcement after positive tests cover existing legitimate client downloads. Do not deploy a blanket owner-only restriction as a stopgap.

Acceptance tests: uploader preview before posting, generated document download, shared-thread member download, authorised shared-property/deal document download, member removal, disabled account, unrelated client, and attempting to paste an unrelated file URL into a thread. Include existing file URLs so no unnecessary link rewrite is required.

This requires a database metadata migration and a staged rollout; it is distinct from the completed application-level fixes. No production records were inspected or changed in preparing this design.
