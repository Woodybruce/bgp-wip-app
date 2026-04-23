/**
 * Folder-tree templates offered at Stage 5 (Investigation Board) when the user
 * chooses to materialise the virtual Stage 4 board into a SharePoint folder.
 *
 * 4 templates — Investment, Leasing, Brand Rep, Lease Advisory — aligned to
 * BGP's 4 service lines. Team to finalise folder contents (Brand Rep + Lease
 * Advisory are stubs until team replies on the review task).
 *
 * Each folder entry can carry an optional `autoFillFrom` hint so the
 * materialisation pipeline knows where to source the documents from once
 * SharePoint creation has happened:
 *   - "companies_house_kyc"  → pull filing PDFs from /api/companies-house/document/{id}
 *   - "infotrack_oc1"        → HMLR Official Copy of Register (InfoTrack order)
 *   - "infotrack_oc2"        → HMLR Title Plan (InfoTrack order)
 *   - "infotrack_leases"     → HMLR filed leases (InfoTrack order)
 *   - "pathway_planning"     → cached planning applications from Stage 4
 *   - "pathway_emails"       → emails collected at Stage 1 (copies/links)
 *   - "pathway_brochures"    → brochures collected at Stage 1
 *   - "pathway_comps"        → comparables
 *   - "pathway_rates"        → VOA rates CSV
 *   - "manual"               → empty folder; user drops files in manually
 */

export type AutoFillSource =
  | "companies_house_kyc"
  | "infotrack_oc1"
  | "infotrack_oc2"
  | "infotrack_leases"
  | "pathway_planning"
  | "pathway_emails"
  | "pathway_brochures"
  | "pathway_comps"
  | "pathway_rates"
  | "pathway_valuation"
  | "manual";

export interface FolderNode {
  name: string;
  autoFillFrom?: AutoFillSource;
  children?: FolderNode[];
}

export interface FolderTemplate {
  id: string;
  name: string;
  description: string;
  tree: FolderNode[];
}

export const FOLDER_TEMPLATES: FolderTemplate[] = [
  {
    id: "investment",
    name: "Investment",
    description: "Acquisition workflow — buying the building.",
    tree: [
      {
        name: "01 Ownership",
        children: [
          { name: "Title Register (OC1)", autoFillFrom: "infotrack_oc1" },
          { name: "Title Plan (OC2)", autoFillFrom: "infotrack_oc2" },
          { name: "Filed Leases", autoFillFrom: "infotrack_leases" },
        ],
      },
      {
        name: "02 Companies House",
        autoFillFrom: "companies_house_kyc",
      },
      {
        name: "03 Rates & Valuation",
        children: [
          { name: "VOA Assessments", autoFillFrom: "pathway_rates" },
          { name: "PropertyData Valuation", autoFillFrom: "pathway_valuation" },
        ],
      },
      { name: "04 Planning", autoFillFrom: "pathway_planning" },
      { name: "05 Correspondence", autoFillFrom: "pathway_emails" },
      { name: "06 Comparables", autoFillFrom: "pathway_comps" },
      { name: "07 Brochures", autoFillFrom: "pathway_brochures" },
      { name: "08 Financial Model", autoFillFrom: "manual" },
      { name: "09 Why Buy", autoFillFrom: "manual" },
    ],
  },
  {
    id: "leasing",
    name: "Leasing",
    description: "Letting workflow — finding a tenant for a vacant unit.",
    tree: [
      { name: "01 Marketing", autoFillFrom: "manual" },
      { name: "02 Brochures", autoFillFrom: "pathway_brochures" },
      { name: "03 Floorplans", autoFillFrom: "manual" },
      { name: "04 Leases", autoFillFrom: "infotrack_leases" },
      { name: "05 Tenant KYC", autoFillFrom: "companies_house_kyc" },
      { name: "06 Correspondence", autoFillFrom: "pathway_emails" },
      { name: "07 Viewings", autoFillFrom: "manual" },
      { name: "08 Offers", autoFillFrom: "manual" },
      { name: "09 Completion", autoFillFrom: "manual" },
    ],
  },
  {
    id: "brand_rep",
    name: "Brand Rep",
    description: "Brand representation mandate — finding a store for the brand. (Team to confirm structure.)",
    tree: [
      { name: "01 Brand Brief", autoFillFrom: "manual" },
      { name: "02 Target Pitches", autoFillFrom: "manual" },
      { name: "03 Shortlist", autoFillFrom: "manual" },
      { name: "04 Viewings", autoFillFrom: "manual" },
      { name: "05 Offers", autoFillFrom: "manual" },
      { name: "06 Correspondence", autoFillFrom: "pathway_emails" },
      { name: "07 Completion", autoFillFrom: "manual" },
    ],
  },
  {
    id: "lease_advisory",
    name: "Lease Advisory",
    description: "Advisory mandate — rent review, lease renewal, restructure. (Team to confirm structure.)",
    tree: [
      { name: "01 Lease Pack", autoFillFrom: "infotrack_leases" },
      { name: "02 Evidence", autoFillFrom: "pathway_comps" },
      { name: "03 Landlord Correspondence", autoFillFrom: "pathway_emails" },
      { name: "04 Reports & Advice", autoFillFrom: "manual" },
      { name: "05 Tenant KYC", autoFillFrom: "companies_house_kyc" },
      { name: "06 Completion", autoFillFrom: "manual" },
    ],
  },
];

export function getFolderTemplate(id: string): FolderTemplate | undefined {
  return FOLDER_TEMPLATES.find((t) => t.id === id);
}
