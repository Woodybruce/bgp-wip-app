/** Legacy org fallback caches can be saved under a different CRM user's ID.
 * A self-mailbox operation therefore needs an identity match, not just a cache
 * row owned by the requester. Unknown identities and aliases fail closed. */
export function delegatedAccountBelongsToUser(
  user: { email?: unknown; role?: unknown; is_active?: unknown } | null | undefined,
  account: { username?: unknown } | null | undefined,
): boolean {
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
  const username = typeof account?.username === "string" ? account.username.trim().toLowerCase() : "";
  return user?.is_active !== false && String(user?.role).trim().toLowerCase() !== "client" &&
    !!email && email.endsWith("@brucegillinghampollard.com") && email === username;
}
