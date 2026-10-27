// Only server-confirmed mutations may refresh a Landlord board or show a saved-record link.
export function landlordConfirmedCrmAction(message: any, companyId: string) {
  if (message?.role !== "assistant" || typeof message.id !== "string") return null;
  let action = message.actionData ?? message.action_data;
  if (typeof action === "string") { try { action = JSON.parse(action); } catch { return null; } }
  if (!action || typeof action !== "object" || Array.isArray(action)
    || !["crm_created", "crm_updated"].includes(action.type)
    || typeof action.id !== "string" || !action.id.trim() || typeof action.entityType !== "string"
    || action.success !== true || action.companyId !== companyId || action.confirmed === false || action.requiresConfirmation === true) return null;
  const entityType = action.entityType;
  const known = ["requirement", "requirement_investment", "requirement_leasing", "deal", "contact", "company", "property", "unit", "available_unit", "investment", "comp", "investment_comp", "lead"];
  if (!known.includes(entityType)) return null;
  let requirementType = entityType === "requirement_investment" ? "investment" : entityType === "requirement_leasing" ? "leasing"
    : ["investment", "leasing"].includes(action.requirementType) ? action.requirementType
    : ["Investment", "Leasing"].includes(action.category) ? action.category.toLowerCase() : null;
  let href: string | null = null;
  if (entityType.startsWith("requirement")) {
    const path = action.url || action.path;
    if (typeof path === "string" && path.startsWith("/requirements?")) {
      const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      if (params.get("requirementId") === action.id && ["investment", "leasing"].includes(params.get("type") || "")) requirementType ||= params.get("type");
    }
    if (requirementType) href = `/requirements?type=${requirementType}&requirementId=${encodeURIComponent(action.id)}`;
  }
  return { type: action.type as "crm_created" | "crm_updated", entityType, id: action.id as string,
    requirementType: requirementType as "investment" | "leasing" | null, href,
    key: JSON.stringify([companyId, message.id, action.type, entityType, action.id, requirementType]) };
}

export function landlordCrmActionQueryKeys(companyId: string, action: NonNullable<ReturnType<typeof landlordConfirmedCrmAction>>): string[][] {
  const keys = [["/api/accounts", companyId, "workspace"], ["/api/accounts", companyId, "teams"], ["/api/brand", companyId, "profile"], ["/api/brand", companyId, "ai-take"]];
  if (action.entityType.startsWith("requirement")) {
    for (const type of action.requirementType ? [action.requirementType] : ["investment", "leasing"]) keys.push([`/api/crm/requirements-${type}`]);
  } else {
    const lists: Record<string, string> = { deal: "deals", contact: "contacts", company: "companies", property: "properties", unit: "available-units", available_unit: "available-units", comp: "comps", investment_comp: "investment-comps", lead: "leads" };
    if (lists[action.entityType]) keys.push([`/api/crm/${lists[action.entityType]}`]);
    if (action.entityType === "deal") keys.push(["/api/accounts", companyId, "deals"], ["/api/crm/landlords", companyId, "team"]);
    if (action.entityType === "contact") keys.push(["/api/brand", companyId, "contacts-cascade"]);
    if (["property", "unit", "available_unit"].includes(action.entityType)) keys.push(["/api/leasing-schedule/company", companyId]);
  }
  return keys;
}

