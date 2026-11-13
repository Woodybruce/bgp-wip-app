// The one door for file uploads. multer finishes on the request stream's
// own events, which run outside the async context the Landsec AI lock lives
// in (server/utils/ai-provider.ts), so a handler that ran after an upload
// was outside the lock and followed the provider switch (review, 12 Nov
// 2026: a chat attachment from a Landsec login went to OpenAI). Every
// upload middleware built here puts the handler back inside the lock when
// the request entered it. Import multer from this file, never from "multer".
import multerBase from "multer";
import type { RequestHandler } from "express";
import { isLandsecLocked, runLandsecLocked } from "./ai-provider";

function relock(mw: RequestHandler): RequestHandler {
  return (req, res, next) => mw(req, res, (err?: any) => {
    if ((req as any)._landsecLocked && !isLandsecLocked()) return runLandsecLocked(() => next(err));
    next(err);
  });
}

const BUILDERS = new Set(["single", "array", "fields", "any", "none"]);

const multer = ((options?: multerBase.Options) => {
  const instance = multerBase(options);
  return new Proxy(instance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || !BUILDERS.has(String(prop))) return value;
      return (...args: any[]) => relock(value.apply(target, args));
    },
  });
}) as typeof multerBase;
multer.memoryStorage = multerBase.memoryStorage;
multer.diskStorage = multerBase.diskStorage;
multer.MulterError = multerBase.MulterError;

export default multer;
