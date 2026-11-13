import type { Request } from "express";

// The one staff test for contact boards: a BGP staff login with no client
// scope sees BGP's own contact history; everyone else (client logins, staff
// viewing as a client, a session scoped to a company) gets the client shape.
export async function contactViewer(req: Request): Promise<{ staff: boolean }> {
  const { canReadLandlordMeetings } = await import("./landlord-meetings");
  return { staff: await canReadLandlordMeetings(req) };
}
