// Standard client folder tree (Delivery 5) — the canonical LOGICAL tree as
// data, shared so the server-side setup job and the client-side inventory
// report render the same structure.
//
// The `key`s are the contract (they land in account_folder_map.logical_key);
// `label`s are display data confirmed with the team at implementation time.
// Nothing here touches the physical tree: existing folders are BOUND first
// (see server/account-folder-inventory.ts), and only genuinely missing
// folders are ever created, empty, inside the already-authorised client
// root. Documents are never moved — `06 Commercial — restricted` is created
// as an EMPTY folder.

export interface ClientFolderTreeSection {
  key: string;
  label: string;
  restricted?: boolean;
  perEntity?: readonly { key: string; label: string }[];
  perProperty?: readonly { key: string; label: string }[];
}

export const CLIENT_FOLDER_TREE: readonly ClientFolderTreeSection[] = [
  { key: "01-client-relationship", label: "01 Client & relationship" },
  {
    key: "02-group-legal-entities", label: "02 Group & legal entities", perEntity: [
      { key: "kyc-onboarding", label: "KYC & onboarding" },
      { key: "entity-corporate", label: "Corporate documents" },
    ],
  },
  {
    key: "03-properties", label: "03 Properties", perProperty: [
      { key: "01-instructions", label: "01 Instructions & appointments" },
      { key: "02-letting", label: "02 Letting & marketing" },
      { key: "03-tenancy-schedules", label: "03 Tenancy schedules & units" },
      { key: "04-property-media", label: "04 Property media" },
      { key: "99-archive", label: "99 Archive" },
    ],
  },
  { key: "04-media-library", label: "04 Media library" },
  { key: "05-investment-strategy", label: "05 Investment strategy" },
  { key: "06-commercial-restricted", label: "06 Commercial — restricted", restricted: true },
  { key: "99-archive", label: "99 Archive" },
] as const;

// SharePoint folder names can't contain these characters — same rule the
// existing folder setup applies (server/microsoft.ts).
export function sanitizeFolderName(name: string): string {
  return String(name || "").trim().replace(/[\/\\<>:"|?*]/g, "_");
}

// Entity folders carry the Companies House registration ID in the label so
// same-named entities stay distinct; "no-registration" makes a missing ID
// visibly incomplete rather than silently name-only.
export function entityFolderDisplayName(name: string, companiesHouseNumber: string | null | undefined): string {
  const base = sanitizeFolderName(name);
  const reg = (companiesHouseNumber || "").trim();
  return `${base} — ${reg || "no-registration"}`;
}

// Property folders carry the first 8 chars of the stable crm_properties.id
// so same-name properties produce distinct, stable folders (renaming the
// CRM record never orphans the folder, and two "Bluewater" rows never
// collapse into one).
export function propertyFolderDisplayName(name: string, propertyId: string): string {
  return `${sanitizeFolderName(name)} — ${String(propertyId).slice(0, 8)}`;
}

export type FolderOwnerKind = "company" | "entity" | "property";

export interface ExpectedFolderEntity {
  entityKind: "company" | "trading_entity";
  entityId: string;
  name: string;
  companiesHouseNumber: string | null;
}

export interface ExpectedFolderProperty {
  propertyId: string;
  name: string;
}

// One row per logical node in the expected tree. `logicalKey`/`ownerKind`/
// `ownerId` are the account_folder_map identity; `treePath` is the display
// path from the drive root used for the bind match and (only when genuinely
// missing) the create.
export interface ExpectedFolderNode {
  logicalKey: string;
  ownerKind: FolderOwnerKind;
  ownerId: string;
  ownerLabel: string;
  displayName: string;
  treePath: string[];
  restricted: boolean;
}

export function buildExpectedFolderTree(args: {
  companyId: string;
  clientName: string;
  entities: ExpectedFolderEntity[];
  properties: ExpectedFolderProperty[];
}): ExpectedFolderNode[] {
  const rootName = sanitizeFolderName(args.clientName);
  const nodes: ExpectedFolderNode[] = [];
  const push = (node: ExpectedFolderNode) => nodes.push(node);

  // Client root — identity is the company row + logical_key 'root'.
  push({
    logicalKey: "root",
    ownerKind: "company",
    ownerId: args.companyId,
    ownerLabel: args.clientName,
    displayName: rootName,
    treePath: [rootName],
    restricted: false,
  });

  for (const section of CLIENT_FOLDER_TREE) {
    const sectionPath = [rootName, section.label];
    push({
      logicalKey: section.key,
      ownerKind: "company",
      ownerId: args.companyId,
      ownerLabel: args.clientName,
      displayName: section.label,
      treePath: sectionPath,
      restricted: !!section.restricted,
    });

    if (section.perEntity) {
      for (const entity of args.entities) {
        const entityName = entityFolderDisplayName(entity.name, entity.companiesHouseNumber);
        const entityPath = [...sectionPath, entityName];
        push({
          logicalKey: "entity",
          ownerKind: "entity",
          ownerId: entity.entityId,
          ownerLabel: entity.name,
          displayName: entityName,
          treePath: entityPath,
          restricted: false,
        });
        for (const sub of section.perEntity) {
          push({
            logicalKey: `entity:${sub.key}`,
            ownerKind: "entity",
            ownerId: entity.entityId,
            ownerLabel: entity.name,
            displayName: sub.label,
            treePath: [...entityPath, sub.label],
            restricted: false,
          });
        }
      }
    }

    if (section.perProperty) {
      for (const property of args.properties) {
        const propName = propertyFolderDisplayName(property.name, property.propertyId);
        const propPath = [...sectionPath, propName];
        push({
          logicalKey: "property",
          ownerKind: "property",
          ownerId: property.propertyId,
          ownerLabel: property.name,
          displayName: propName,
          treePath: propPath,
          restricted: false,
        });
        for (const sub of section.perProperty) {
          push({
            logicalKey: `property:${sub.key}`,
            ownerKind: "property",
            ownerId: property.propertyId,
            ownerLabel: property.name,
            displayName: sub.label,
            treePath: [...propPath, sub.label],
            restricted: false,
          });
        }
      }
    }
  }

  return nodes;
}

// The names a physical folder might already have for an expected node:
// the current display name, plus the legacy name-only variant used by the
// pre-Delivery-5 setup (which created bare property/client names).
export function expectedNameCandidates(node: Pick<ExpectedFolderNode, "displayName">): string[] {
  const names = [node.displayName];
  const legacy = node.displayName.replace(/ — [^—]+$/, "");
  if (legacy !== node.displayName && legacy.length > 0) names.push(legacy);
  return [...new Set(names)];
}
