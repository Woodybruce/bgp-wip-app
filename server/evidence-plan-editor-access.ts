import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import { EvidencePlanShareError } from "./evidence-plan-share-policy";

export interface EvidencePlanEditorAccess { request: Request; shareId: string; planId: string; propertyId: string | null; pendingOperations?: Set<Promise<void>> }
const access = new AsyncLocalStorage<EvidencePlanEditorAccess>();
export const currentEvidencePlanEditorAccess = () => access.getStore();
export function runWithEvidencePlanEditorAccess<T>(context: EvidencePlanEditorAccess, fn: () => T): T { return access.run(context, fn); }
export const isEvidencePlanEditorRequest = (req: Request) => access.getStore()?.request === req;
export function assertEvidencePlanEditorScope(planId: string, propertyId?: string | null): void {
  const context = access.getStore();
  if (context && (context.planId !== planId || propertyId !== undefined && (propertyId || null) !== context.propertyId)) {
    throw new EvidencePlanShareError(403, "This operation is outside the shared plan");
  }
}
export function evidencePlanEditorPropertyAllowed(propertyId: string | null): boolean | undefined {
  const context = access.getStore();
  return context ? (propertyId || null) === context.propertyId : undefined;
}

/** Response close can precede the last database write. Keep the grant lock until
 * each real route handler settles, even when its browser disconnects. Detached
 * AI jobs are deliberately not registered: accepted work may finish later. */
export function trackEvidencePlanEditorOperation(req: Request, result: unknown): void {
  const context = access.getStore();
  if (context?.request !== req || !context.pendingOperations || !result || typeof (result as any).then !== "function") return;
  const settled = Promise.resolve(result).then(() => {}, () => {});
  context.pendingOperations.add(settled);
  void settled.then(() => context.pendingOperations!.delete(settled));
}
