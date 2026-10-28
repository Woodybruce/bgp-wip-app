import { isPrivateEmailRecord, isPrivateMailboxAddress } from "./private-mail";

const deniedBody = { error: { code: "ErrorItemNotFound", message: "This item is not available in the app." } };
const denied = () => jsonResponse(deniedBody, { status: 404 });
type MailKind = "messages" | "events";
export type PrivateMessageLookup = (record: Record<string, unknown>, mailbox: string | undefined, resourceType: MailKind) => Promise<boolean>;
export type PrivateMessageObserver = (record: Record<string, unknown>, mailbox: string | undefined, resourceType: MailKind) => Promise<void>;
const fieldsFor = (kind: MailKind) => kind === "messages"
  ? ["from", "sender", "toRecipients", "ccRecipients", "bccRecipients"] : ["organizer", "attendees"];
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { status: init.status, statusText: init.statusText, headers });
}

// Missing recipient metadata is not evidence that an item is safe. Request
// these fields even when callers select only a subject or message headers.
function hasAddressMetadata(value: unknown, kind: MailKind): value is Record<string, any> {
  if (!object(value)) return false;
  const person = (entry: unknown) => entry === null || (object(entry) && object(entry.emailAddress)
    && typeof entry.emailAddress.address === "string");
  return fieldsFor(kind).every(field => Object.hasOwn(value, field) && (
    field.endsWith("Recipients") || field === "attendees"
      ? Array.isArray(value[field]) && value[field].every((entry: unknown) => entry !== null && person(entry))
      : person(value[field])
  ));
}

function mailResource(url: URL) {
  const raw = url.pathname.split("/").filter(Boolean);
  const parts = raw.map(part => decodeURIComponent(part));
  const owner = parts[1]?.toLowerCase();
  const mailbox = owner === "users" ? parts[2] : undefined;
  const start = owner === "me" ? 2 : owner === "users" || owner === "groups" ? 3 : -1;
  if (start < 0 || !["messages", "mailfolders", "events", "calendar", "calendars", "calendargroups", "calendarview"].includes(parts[start]?.toLowerCase())) return { mailbox };
  const index = parts.findIndex((part, i) => i >= start && ["messages", "events", "calendarview"].includes(part.toLowerCase()));
  if (index < 0) return { mailbox };
  const name = parts[index].toLowerCase();
  const kind: MailKind = name === "messages" ? "messages" : "events";
  const tail = parts.slice(index + 1);
  const collection = !tail.length || tail[0] === "delta" || name === "calendarview";
  const parent = tail.length > 1 && tail[0] !== "delta" ? `/${raw.slice(0, index + 2).join("/")}` : undefined;
  return { mailbox, kind, collection: collection || tail[1] === "instances", parent,
    raw: !!parent && tail[1] !== "instances", count: tail.includes("$count") };
}

// A lookup can exclude known copies by internetMessageId/iCalUId. Recipient
// metadata alone cannot detect a BCC recipient hidden on another mailbox's copy.
export function privateMailGraphFetch(realFetch: typeof fetch, shouldExcludeMessage?: PrivateMessageLookup, onPrivateMessage?: PrivateMessageObserver): typeof fetch {
  const safeRecord = async (row: unknown, mailbox: string | undefined, kind: MailKind) => {
    if (!hasAddressMetadata(row, kind)) return false;
    if (isPrivateEmailRecord(row, mailbox)) {
      await onPrivateMessage?.(row, mailbox, kind);
      return false;
    }
    return !(shouldExcludeMessage && await shouldExcludeMessage(row, mailbox, kind));
  };
  const prepare = async (url: URL, init: RequestInit) => {
    let resource: ReturnType<typeof mailResource>;
    try { resource = mailResource(url); } catch { return null; }
    if (isPrivateMailboxAddress(resource.mailbox) || isPrivateMailboxAddress(new Headers(init.headers).get("X-AnchorMailbox"))) return null;
    // A parent-resource expansion must not carry an uninspected mail list.
    if (/(?:^|[,(/;])\s*(?:messages|events|calendarView)\s*(?:\(|[,/;]|$)/i.test(url.searchParams.get("$expand") || "")) return null;
    if (!resource.kind) return { url, resource };
    if (resource.count) return null;
    const fields = fieldsFor(resource.kind);
    if (resource.parent) {
      const parent = new URL(url);
      parent.pathname = resource.parent;
      parent.search = "";
      parent.searchParams.set("$select", [...fields, resource.kind === "messages" ? "internetMessageId" : "iCalUId"].join(","));
      const response = await realFetch(parent, init);
      if (!response.ok) return null;
      const record = await response.json().catch(() => null);
      if (!await safeRecord(record, resource.mailbox, resource.kind)) return null;
    }
    if (!resource.raw) {
      const select = url.searchParams.get("$select");
      if (select) url.searchParams.set("$select", [...new Set([...select.split(",").map(field => field.trim()), ...fields,
        resource.kind === "messages" ? "internetMessageId" : "iCalUId"])].join(","));
    }
    return { url, resource };
  };
  const filter = async (data: unknown, resource: ReturnType<typeof mailResource>): Promise<unknown | null> => {
    if (!resource.kind || resource.raw) return data;
    if (!object(data)) return null;
    if (resource.collection) {
      if (!Array.isArray(data.value)) return null;
      const allowed = await Promise.all(data.value.map(row => safeRecord(row, resource.mailbox, resource.kind!)));
      const result: Record<string, any> = { ...data, value: data.value.filter((_row, i) => allowed[i]) };
      delete result["@odata.count"];
      return result;
    }
    return await safeRecord(data, resource.mailbox, resource.kind) ? data : null;
  };
  return async (input, init) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : String(input)); }
    catch { return realFetch(input, init); }
    if (url.hostname !== "graph.microsoft.com") return realFetch(input, init);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const requestInit: RequestInit = { ...(input instanceof Request ? { signal: input.signal, credentials: input.credentials, cache: input.cache, redirect: input.redirect } : {}), ...init, headers };
    const readBody = async () => {
      try { return init?.body != null ? JSON.parse(String(init.body)) : input instanceof Request ? await input.clone().json() : null; }
      catch { return null; }
    };

    // Keep the contact scanner's batching. Add recipient fields to each narrow
    // selection, then inspect its matching response before returning headers.
    if (method === "POST" && /\/\$batch\/?$/i.test(url.pathname)) {
      const body = await readBody();
      if (!object(body) || !Array.isArray(body.requests) || body.requests.some((row: any) => !object(row) || typeof row.id !== "string" || typeof row.url !== "string" || typeof row.method !== "string")
        || new Set(body.requests.map((row: any) => row.id)).size !== body.requests.length) return denied();
      const prepared = new Map<string, Awaited<ReturnType<typeof prepare>>>();
      const blocked: any[] = [], requests: any[] = [];
      for (const row of body.requests) {
        // These read operations need their own body-aware guard. No current
        // caller batches them; do not let nesting skip that boundary.
        if (/\/(search\/query|calendar\/getSchedule|\$batch)(?:\?|$)/i.test(row.url)) {
          blocked.push({ id: row.id, status: 404, body: deniedBody });
          continue;
        }
        if (row.method.toUpperCase() !== "GET") { requests.push(row); continue; }
        const child = new URL(row.url, `${url.origin}/`);
        if (child.origin !== url.origin) return denied();
        if (!/^\/(?:v1\.0|beta)(?:\/|$)/i.test(child.pathname)) child.pathname = `/${url.pathname.split("/").filter(Boolean)[0]}${child.pathname}`;
        const childHeaders = new Headers(headers);
        new Headers(row.headers).forEach((value, key) => childHeaders.set(key, value));
        const checked = await prepare(child, { ...requestInit, method: "GET", body: undefined, headers: childHeaders });
        prepared.set(row.id, checked);
        if (!checked) blocked.push({ id: row.id, status: 404, body: deniedBody });
        else requests.push({ ...row, url: `${checked.url.pathname.replace(/^\/(v1\.0|beta)/, "")}${checked.url.search}` });
      }
      if (!requests.length) return jsonResponse({ responses: blocked });
      const response = await realFetch(url, { ...requestInit, method: "POST", body: JSON.stringify({ ...body, requests }) });
      if (!response.ok) return response;
      const data = await response.json().catch(() => null);
      if (!object(data) || !Array.isArray(data.responses)) return denied();
      const expected = new Set(requests.map(row => row.id));
      const responses: any[] = [...blocked];
      for (const row of data.responses) {
        if (!object(row) || typeof row.status !== "number" || !expected.delete(row.id)) return denied();
        const checked = prepared.get(row.id);
        const safe = checked && row.status >= 200 && row.status < 300 ? await filter(row.body, checked.resource) : row.body;
        responses.push(safe === null ? { id: row.id, status: 404, body: deniedBody } : { ...row, body: safe });
      }
      return jsonResponse({ ...data, responses }, response);
    }

    if (method === "POST" && /\/calendar\/getSchedule\/?$/i.test(url.pathname)) {
      const body = await readBody();
      if (!object(body) || !Array.isArray(body.schedules) || body.schedules.some(value => typeof value !== "string")) return denied();
      const schedules = body.schedules.filter(value => !isPrivateMailboxAddress(value));
      if (!schedules.length) return jsonResponse({ value: [] });
      const response = await realFetch(url, { ...requestInit, method: "POST", body: JSON.stringify({ ...body, schedules }) });
      if (!response.ok) return response;
      const data = await response.json().catch(() => null);
      if (!object(data) || !Array.isArray(data.value)) return denied();
      // Free/busy does not include participants, so another staff member's
      // copy of an excluded meeting cannot be validated here. Retain useful
      // availability without exposing its subject, location or other details.
      const value = data.value.filter(row => object(row) && typeof row.scheduleId === "string" && !isPrivateMailboxAddress(row.scheduleId))
        .map(row => ({ ...row, ...(Array.isArray(row.scheduleItems) ? { scheduleItems: row.scheduleItems.filter(object).map((item: Record<string, any>) => ({
          status: item.status,
          start: object(item.start) ? { dateTime: item.start.dateTime, timeZone: item.start.timeZone } : item.start,
          end: object(item.end) ? { dateTime: item.end.dateTime, timeZone: item.end.timeZone } : item.end,
          ...(typeof item.isPrivate === "boolean" ? { isPrivate: item.isPrivate } : {}),
        })) } : {}) }));
      return jsonResponse({ ...data, value }, response);
    }

    // File searches are unchanged. Graph mail search lacks complete recipient
    // metadata; app email search already uses the guarded messages route.
    if (method === "POST" && /\/search\/query\/?$/i.test(url.pathname)) {
      const body = await readBody();
      if (!object(body) || !Array.isArray(body.requests) || body.requests.some((row: any) => !Array.isArray(row?.entityTypes) || row.entityTypes.some((type: any) => typeof type !== "string" || /^(message|event)$/i.test(type)))) return denied();
    }
    if (method !== "GET") return realFetch(input, init);
    const prepared = await prepare(url, requestInit);
    if (!prepared) return denied();
    if (!prepared.resource.kind) return realFetch(input, init);
    const response = await realFetch(prepared.url, requestInit);
    if (!response.ok || prepared.resource.raw) return response;
    const data = await response.json().catch(() => null);
    const safe = await filter(data, prepared.resource);
    return safe === null ? denied() : jsonResponse(safe, response);
  };
}

let installed = false;
export function installPrivateMailGraphGuard(onPrivateMessage?: PrivateMessageObserver) {
  if (installed) return;
  installed = true;
  globalThis.fetch = privateMailGraphFetch(globalThis.fetch.bind(globalThis), undefined, onPrivateMessage);
}
