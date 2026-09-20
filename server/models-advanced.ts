import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import { excelTemplates, excelModelRuns } from "../shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import XLSX from "xlsx-js-style";
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import PDFDocument from "pdfkit";
import { createEngineFromWorkbook, applyMappedInputs, readEngineOutputs, type EngineCellError } from "./model-engine";
import { autoMapWorkbook, buildWorkbookDigest, validateProposal, type AutoMapProposal } from "./model-automap";
import { anthropicWorkspaceOptions } from "./utils/anthropic-client";
import { ensureFileOnDisk } from "./file-storage";

async function ensureTemplateFile(filePath: string): Promise<void> {
  if (fs.existsSync(filePath)) return;
  const restored = await ensureFileOnDisk(`templates/${path.basename(filePath)}`, filePath);
  if (!restored) throw new Error(`Template file not found: ${filePath}`);
}

function aiConfigured(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
      ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
      : {}),
    ...anthropicWorkspaceOptions(),
  });
}

function extractRichWorkbookContext(wb: XLSX.WorkBook, maxRowsPerSheet: number = 80): string {
  const sections: string[] = [];
  sections.push(`WORKBOOK OVERVIEW: ${wb.SheetNames.length} sheets: ${wb.SheetNames.join(", ")}`);

  if (wb.Workbook?.Names?.length) {
    const namedRanges = wb.Workbook.Names
      .filter((n: any) => n.Name && !n.Name.startsWith("_"))
      .map((n: any) => `  ${n.Name} = ${n.Ref || ""}`)
      .join("\n");
    if (namedRanges) sections.push(`NAMED RANGES:\n${namedRanges}`);
  }

  for (const sheetName of wb.SheetNames.slice(0, 15)) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const rowCount = Math.min(range.e.r + 1, maxRowsPerSheet);
    const colCount = Math.min(range.e.c + 1, 26);
    const lines: string[] = [];
    lines.push(`\n=== SHEET: "${sheetName}" (${range.e.r + 1} rows × ${range.e.c + 1} cols) ===`);

    for (let r = range.s.r; r < rowCount; r++) {
      const cellInfos: string[] = [];
      let hasContent = false;
      for (let c = range.s.c; c < colCount; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) { cellInfos.push(""); continue; }
        hasContent = true;
        let info = "";
        if (cell.f) {
          info = `=${cell.f}`;
          if (cell.v !== undefined && cell.v !== null) info += ` → ${cell.v}`;
        } else if (cell.v !== undefined && cell.v !== null) {
          info = String(cell.v);
        }
        if (cell.z && cell.z !== "General" && cell.t === "n") info += ` [fmt:${cell.z}]`;
        cellInfos.push(info);
      }
      if (hasContent) lines.push(`R${r + 1}: ${cellInfos.join(" | ")}`);
    }
    if (range.e.r + 1 > maxRowsPerSheet) lines.push(`... (${range.e.r + 1 - maxRowsPerSheet} more rows)`);
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function parseFormulaReferences(formula: string): string[] {
  const refs: string[] = [];
  const cellRefRegex = /(?:'([^']+)'|([A-Za-z_]\w*))!\$?([A-Z]+)\$?([0-9]+(?::\$?[A-Z]+\$?[0-9]+)?)|\$?([A-Z]+)\$?([0-9]+(?::\$?[A-Z]+\$?[0-9]+)?)/g;
  let match;
  while ((match = cellRefRegex.exec(formula)) !== null) {
    if (match[1] || match[2]) {
      const col = match[3].replace(/\$/g, "");
      const row = match[4].replace(/\$/g, "");
      refs.push(`${match[1] || match[2]}!${col}${row}`);
    } else if (match[5]) {
      const col = match[5].replace(/\$/g, "");
      const row = match[6].replace(/\$/g, "");
      refs.push(`${col}${row}`);
    }
  }
  return refs;
}

function safeParseAIJson(text: string): any {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch {}
    }
    throw new Error("AI returned invalid JSON. Please try again.");
  }
}

export function setupAdvancedModelsRoutes(app: Express) {

  // Propose (or persist a confirmed) input/output mapping for a template.
  // POST {} → AI proposal only. POST { apply: true } → propose + persist.
  // POST { apply: true, inputMapping, outputMapping } → persist the exact
  // client-confirmed proposal (validated against the workbook, no 2nd AI call).
  app.post("/api/models/templates/:id/auto-map", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      await ensureTemplateFile(template.filePath);
      const wb = XLSX.readFile(template.filePath, { cellFormula: true, sheetStubs: true });

      const { apply, inputMapping: clientInputs, outputMapping: clientOutputs } = req.body || {};
      let proposal: AutoMapProposal;
      if (apply && clientInputs && typeof clientInputs === "object") {
        proposal = validateProposal(buildWorkbookDigest(wb), clientInputs, clientOutputs || {});
        proposal.source = "ai";
      } else {
        proposal = await autoMapWorkbook(wb);
      }

      if (apply) {
        await db.update(excelTemplates).set({
          inputMapping: JSON.stringify(proposal.inputs),
          outputMapping: JSON.stringify(proposal.outputs),
        }).where(eq(excelTemplates.id, template.id));
      }

      res.json({ ...proposal, applied: !!apply });
    } catch (err: any) {
      console.error("[auto-map] failed:", err);
      res.status(500).json({ message: err?.message || "Auto-map failed" });
    }
  });

  app.post("/api/models/templates/:id/sensitivity", requireAuth, async (req: Request, res: Response) => {
    try {
      const { variable1, variable2, baseInputs } = req.body;
      if (!variable1) return res.status(400).json({ message: "At least one variable is required" });
      if (!Array.isArray(variable1.values) || variable1.values.length === 0) {
        return res.status(400).json({ message: "variable1.values must be a non-empty array" });
      }

      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      const var1Config = inputMapping[variable1.key];
      const var2Config = variable2 ? inputMapping[variable2.key] : null;
      if (!var1Config) return res.status(400).json({ message: `Unknown input variable: ${variable1.key}` });
      if (variable2 && !var2Config) return res.status(400).json({ message: `Unknown input variable: ${variable2.key}` });

      const combos: { v1: any; v2: any | null }[] = [];
      for (const v1 of variable1.values) {
        if (variable2 && Array.isArray(variable2.values)) {
          for (const v2 of variable2.values) combos.push({ v1, v2 });
        } else {
          combos.push({ v1, v2: null });
        }
      }
      if (combos.length > 100) {
        return res.status(400).json({ message: `Too many combinations (${combos.length}); maximum is 100` });
      }

      const outputKeys = Object.entries(outputMapping);
      const outputLabels = Object.fromEntries(outputKeys.map(([k, c]: [string, any]) => [k, c.label]));

      await ensureTemplateFile(template.filePath);
      const templateWb = XLSX.readFile(template.filePath, { cellFormula: true, sheetStubs: true });

      // ── Engine path: recalculate the workbook once per combination ──────
      let engineFailure: string | null = null;
      const engineWarnings: string[] = [];
      const results: any[] = [];
      try {
        for (const combo of combos) {
          const engine = createEngineFromWorkbook(templateWb);
          try {
            if (engine.warnings.length && engineWarnings.length < 10) {
              engineWarnings.push(...engine.warnings.slice(0, 10 - engineWarnings.length));
            }
            applyMappedInputs(engine, baseInputs || {}, inputMapping);
            const scenarioInputs: Record<string, any> = { [variable1.key]: combo.v1 };
            if (combo.v2 !== null && variable2) scenarioInputs[variable2.key] = combo.v2;
            applyMappedInputs(engine, scenarioInputs, inputMapping);
            const { outputs, errors } = readEngineOutputs(engine, outputMapping);
            const result: any = { var1Value: combo.v1, outputs };
            if (variable2) result.var2Value = combo.v2;
            if (errors.length) result.outputErrors = errors;
            results.push(result);
          } finally {
            engine.dispose();
          }
        }
      } catch (err: any) {
        engineFailure = err?.message || String(err);
        console.error("[sensitivity] engine failed, falling back to AI estimates:", engineFailure);
      }

      if (!engineFailure) {
        // Optional AI commentary on the computed numbers (never generates them).
        let insights: string | null = null;
        if (aiConfigured()) {
          try {
            const anthropic = getAnthropicClient();
            const response = await anthropic.messages.create({
              model: "claude-opus-4-6",
              max_tokens: 1024,
              system: "You are a senior property investment analyst. The sensitivity table below was produced by recalculating the Excel model with a calculation engine — the numbers are exact, not estimates. Write 2-4 sentences of commentary: which variable drives the outputs most, and any inflection points worth flagging. Do not restate every number.",
              messages: [
                { role: "user", content: `Model: ${template.name}\nVariable 1: ${var1Config?.label || variable1.key}\n${variable2 ? `Variable 2: ${var2Config?.label || variable2.key}\n` : ""}Outputs: ${Object.values(outputLabels).join(", ")}\n\nComputed results:\n${JSON.stringify(results).slice(0, 12000)}` }
              ],
            });
            insights = response.content[0]?.type === "text" ? response.content[0].text : null;
          } catch (err: any) {
            console.warn("[sensitivity] AI insights failed (results unaffected):", err?.message);
          }
        }

        return res.json({
          variable1: { key: variable1.key, label: var1Config?.label, values: variable1.values },
          variable2: variable2 ? { key: variable2.key, label: var2Config?.label, values: variable2.values } : null,
          outputLabels,
          results,
          insights,
          insightsSource: insights ? "ai-commentary" : null,
          computed: true,
          engine: "hyperformula",
          engineWarnings,
          outputsAreEstimates: false,
        });
      }

      // ── Fallback: engine could not handle this workbook — AI estimates ──
      if (!aiConfigured()) {
        return res.status(500).json({
          message: "Calculation engine failed for this workbook and AI estimation is not configured",
          engineError: engineFailure,
        });
      }

      const richContext = extractRichWorkbookContext(templateWb, 60);

      let sensitivityPrompt = `You are analysing a property investment model. Given the full workbook with formulas, calculate how key outputs change when inputs are varied.

BASE INPUTS: ${JSON.stringify(baseInputs || {})}

VARIABLE 1: "${var1Config?.label || variable1.key}" (${var1Config?.type || "number"})
Values to test: ${JSON.stringify(variable1.values)}`;

      if (var2Config && variable2) {
        sensitivityPrompt += `\n\nVARIABLE 2: "${var2Config?.label || variable2.key}" (${var2Config?.type || "number"})
Values to test: ${JSON.stringify(variable2.values)}`;
      }

      const estimateOutputKeys = outputKeys.slice(0, 6);
      sensitivityPrompt += `\n\nFor each combination, calculate these outputs based on the model's formulas:
${estimateOutputKeys.map(([key, cfg]: [string, any]) => `- ${cfg.label} (${key})`).join("\n")}

Return ONLY valid JSON:
{
  "results": [
    {
      "var1Value": <value>,
      ${variable2 ? '"var2Value": <value>,' : ''}
      "outputs": { "outputKey": "formatted value", ... }
    },
    ...
  ],
  "insights": "Brief analysis of the sensitivity patterns — what drives the returns most?"
}`;

      const anthropic = getAnthropicClient();
      const response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        system: "You are an expert property investment analyst. Analyse the Excel model's formulas and calculate how outputs change when inputs are varied. Use the actual formula logic visible in the workbook. Be precise with calculations.",
        messages: [
          { role: "user", content: `WORKBOOK:\n${richContext.slice(0, 50000)}\n\n${sensitivityPrompt}` }
        ],
      });

      const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
      const parsed = safeParseAIJson(content);

      res.json({
        variable1: { key: variable1.key, label: var1Config?.label, values: variable1.values },
        variable2: variable2 ? { key: variable2.key, label: var2Config?.label, values: variable2.values } : null,
        outputLabels: Object.fromEntries(estimateOutputKeys.map(([k, c]: [string, any]) => [k, c.label])),
        results: parsed.results,
        insights: parsed.insights,
        insightsSource: "ai-estimate",
        computed: false,
        outputsAreEstimates: true,
        engineError: engineFailure,
        estimateNote: "The calculation engine could not process this workbook, so outputs are AI estimates derived from the model's formulas — verify by running the model in Excel.",
      });
    } catch (err: any) {
      console.error("Sensitivity error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to run sensitivity analysis" });
    }
  });

  app.get("/api/models/runs/compare", requireAuth, async (req: Request, res: Response) => {
    try {
      const ids = (req.query.ids as string || "").split(",").filter(Boolean);
      if (ids.length < 2) return res.status(400).json({ message: "At least 2 run IDs required" });

      const runs = [];
      for (const id of ids.slice(0, 5)) {
        const run = await storage.getExcelModelRun(id);
        if (run) {
          const template = run.templateId ? await storage.getExcelTemplate(run.templateId) : null;
          runs.push({
            id: run.id,
            name: run.name,
            status: run.status,
            createdAt: run.createdAt,
            templateName: template?.name,
            inputValues: JSON.parse(run.inputValues || "{}"),
            outputValues: run.outputValues ? JSON.parse(run.outputValues) : {},
            inputMapping: template ? JSON.parse(template.inputMapping || "{}") : {},
            outputMapping: template ? JSON.parse(template.outputMapping || "{}") : {},
          });
        }
      }

      const allInputKeys = new Set<string>();
      const allOutputKeys = new Set<string>();
      runs.forEach(r => {
        Object.keys(r.inputValues).forEach(k => allInputKeys.add(k));
        Object.keys(r.outputValues).forEach(k => allOutputKeys.add(k));
      });

      const inputLabels: Record<string, string> = {};
      const outputLabels: Record<string, string> = {};
      runs.forEach(r => {
        Object.entries(r.inputMapping).forEach(([k, v]: [string, any]) => { if (!inputLabels[k]) inputLabels[k] = v.label; });
        Object.entries(r.outputMapping).forEach(([k, v]: [string, any]) => { if (!outputLabels[k]) outputLabels[k] = v.label; });
      });

      res.json({
        runs: runs.map(r => ({
          id: r.id,
          name: r.name,
          templateName: r.templateName,
          createdAt: r.createdAt,
          inputValues: r.inputValues,
          outputValues: r.outputValues,
        })),
        inputKeys: Array.from(allInputKeys),
        outputKeys: Array.from(allOutputKeys),
        inputLabels,
        outputLabels,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to compare runs" });
    }
  });

  app.get("/api/models/runs/:id/memo", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await storage.getExcelModelRun(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });

      const template = run.templateId ? await storage.getExcelTemplate(run.templateId) : null;
      const inputValues = JSON.parse(run.inputValues || "{}");
      const outputValues = run.outputValues ? JSON.parse(run.outputValues) : {};
      const inputMapping = template ? JSON.parse(template.inputMapping || "{}") : {};
      const outputMapping = template ? JSON.parse(template.outputMapping || "{}") : {};

      const anthropic = getAnthropicClient();
      const inputSummary = Object.entries(inputValues)
        .map(([k, v]) => `${inputMapping[k]?.label || k}: ${v}${inputMapping[k]?.type === "percent" ? "%" : ""}`)
        .join("\n");
      const outputSummary = Object.entries(outputValues)
        .filter(([_, v]) => v !== null)
        .map(([k, v]) => `${outputMapping[k]?.label || k}: ${v}`)
        .join("\n");

      const aiResponse = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        system: `You are a senior investment analyst at Bruce Gillingham Pollard (BGP), a London property consultancy. Write a professional investment memo. Today's date is ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Structure it with these sections:
1. EXECUTIVE SUMMARY (2-3 sentences)
2. INVESTMENT OVERVIEW (property details, location, type)
3. KEY ASSUMPTIONS (formatted list of inputs)
4. FINANCIAL ANALYSIS (returns, yields, key metrics)
5. RISK FACTORS (3-5 specific risks)
6. RECOMMENDATION (buy/hold/pass with reasoning)

Be specific with numbers. Use professional property investment language. Keep it concise but thorough. Write plain text: no markdown headers, tables, bold, or separators — numbered section headings and simple dash bullets only.`,
        messages: [
          { role: "user", content: `Model: ${run.name}\nTemplate: ${template?.name || "Unknown"}\n\nINPUTS:\n${inputSummary}\n\nRESULTS:\n${outputSummary}` }
        ],
      });

      const memoText = aiResponse.content[0]?.type === "text" ? aiResponse.content[0].text : "";
      const sections = memoText.split(/\n(?=\d\.\s|[A-Z]{3,})/);

      const doc = new PDFDocument({ margin: 60, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${run.name.replace(/[^a-zA-Z0-9 _-]/g, "_")}_Memo.pdf"`);
      doc.pipe(res);

      doc.fontSize(8).fillColor("#666666").text("CONFIDENTIAL", { align: "right" });
      doc.moveDown(0.5);
      doc.fontSize(22).fillColor("#000000").text("Investment Memo", { align: "left" });
      doc.fontSize(12).fillColor("#444444").text(run.name);
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#888888").text(`Prepared by BGP | ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} | Template: ${template?.name || "N/A"}`);
      doc.moveDown(0.5);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor("#cccccc").stroke();
      doc.moveDown(1);

      const stripMd = (s: string) => s
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/(?<![\w*])\*(?!\*)(.+?)(?<!\*)\*(?![\w*])/g, "$1")
        .replace(/`(.+?)`/g, "$1");

      const lines = memoText.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { doc.moveDown(0.3); continue; }

        // Markdown horizontal rules / leftover separators
        if (/^(-{2,}|_{3,}|\*{3,})$/.test(trimmed)) continue;
        // Markdown table separator rows (| --- | :--- |)
        if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;

        // Markdown headers (# … ####) and numbered/uppercase section headings
        const mdHeader = trimmed.match(/^(#{1,4})\s+(.*)$/);
        if (mdHeader) {
          doc.moveDown(0.5);
          doc.fontSize(mdHeader[1].length <= 1 ? 15 : 13).fillColor("#000000").font("Helvetica-Bold").text(stripMd(mdHeader[2]));
          doc.moveDown(0.3);
        } else if (/^\d+\.\s+[A-Z]/.test(trimmed) || /^[A-Z]{3,}/.test(trimmed)) {
          doc.moveDown(0.5);
          doc.fontSize(13).fillColor("#000000").font("Helvetica-Bold").text(stripMd(trimmed));
          doc.moveDown(0.3);
        } else if (trimmed.startsWith("|")) {
          // Markdown table row → plain aligned text
          const cells = trimmed.split("|").slice(1, -1).map(cell => stripMd(cell.trim())).filter(Boolean);
          if (cells.length) {
            doc.fontSize(9).fillColor("#333333").font("Helvetica").text(cells.join("    "), { indent: 10 });
            doc.moveDown(0.15);
          }
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ")) {
          doc.fontSize(10).fillColor("#333333").font("Helvetica").text("• " + stripMd(trimmed.slice(2)), { indent: 15 });
          doc.moveDown(0.15);
        } else {
          doc.fontSize(10).fillColor("#333333").font("Helvetica").text(stripMd(trimmed));
          doc.moveDown(0.15);
        }

        if (doc.y > 750) {
          doc.addPage();
        }
      }

      doc.moveDown(1.5);
      doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor("#cccccc").stroke();
      doc.moveDown(0.5);
      doc.fontSize(8).fillColor("#999999").font("Helvetica")
        .text("This document has been prepared by Bruce Gillingham Pollard for internal use. The analysis is based on the assumptions stated and should not be relied upon as a guarantee of future performance.", { align: "center" });

      doc.end();
    } catch (err: any) {
      console.error("Memo generation error:", err?.message);
      if (!res.headersSent) {
        res.status(500).json({ message: err?.message || "Failed to generate memo" });
      }
    }
  });

  app.post("/api/models/templates/:id/batch-run", requireAuth, async (req: Request, res: Response) => {
    try {
      const { scenarios } = req.body;
      if (!scenarios || !Array.isArray(scenarios) || scenarios.length === 0) {
        return res.status(400).json({ message: "Scenarios array is required" });
      }
      if (scenarios.length > 20) {
        return res.status(400).json({ message: "Maximum 20 scenarios per batch" });
      }

      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");
      const outputKeys = Object.entries(outputMapping);
      const outputLabels = Object.fromEntries(outputKeys.map(([k, c]: [string, any]) => [k, c.label]));

      await ensureTemplateFile(template.filePath);
      const templateWb = XLSX.readFile(template.filePath, { cellFormula: true, sheetStubs: true });

      // ── Engine path: recalculate the workbook once per scenario ─────────
      let engineFailure: string | null = null;
      const engineWarnings: string[] = [];
      const computedScenarios: { name: string; inputs: Record<string, any>; outputs: Record<string, any>; outputErrors: EngineCellError[] }[] = [];
      try {
        for (let i = 0; i < scenarios.length; i++) {
          const scenario = scenarios[i];
          const engine = createEngineFromWorkbook(templateWb);
          try {
            if (engine.warnings.length && engineWarnings.length < 10) {
              engineWarnings.push(...engine.warnings.slice(0, 10 - engineWarnings.length));
            }
            applyMappedInputs(engine, scenario.inputs || {}, inputMapping);
            const { outputs, errors } = readEngineOutputs(engine, outputMapping);
            computedScenarios.push({
              name: scenario.name || `Batch ${i + 1}`,
              inputs: scenario.inputs || {},
              outputs,
              outputErrors: errors,
            });
          } finally {
            engine.dispose();
          }
        }
      } catch (err: any) {
        engineFailure = err?.message || String(err);
        console.error("[batch-run] engine failed, falling back to AI estimates:", engineFailure);
      }

      if (!engineFailure) {
        const savedRuns = [];
        for (const scenario of computedScenarios) {
          const run = await storage.createExcelModelRun({
            templateId: template.id,
            name: scenario.name,
            inputValues: JSON.stringify(scenario.inputs),
            outputValues: JSON.stringify(scenario.outputs),
            generatedFilePath: null as any,
            status: "completed",
          });
          savedRuns.push({
            id: run.id,
            name: scenario.name,
            status: run.status,
            inputs: scenario.inputs,
            outputs: scenario.outputs,
            ...(scenario.outputErrors.length ? { outputErrors: scenario.outputErrors } : {}),
          });
        }

        // Optional AI commentary on the computed numbers (never generates them).
        let summary: string | null = null;
        if (aiConfigured()) {
          try {
            const anthropic = getAnthropicClient();
            const response = await anthropic.messages.create({
              model: "claude-opus-4-6",
              max_tokens: 1024,
              system: "You are a senior property investment analyst. The scenario results below were produced by recalculating the Excel model with a calculation engine — the numbers are exact, not estimates. Write 2-4 sentences comparing the scenarios: which performs best, and what drives the difference. Do not restate every number.",
              messages: [
                { role: "user", content: `Model: ${template.name}\n\nComputed scenario results:\n${JSON.stringify(computedScenarios.map(s => ({ name: s.name, inputs: s.inputs, outputs: s.outputs }))).slice(0, 12000)}` }
              ],
            });
            summary = response.content[0]?.type === "text" ? response.content[0].text : null;
          } catch (err: any) {
            console.warn("[batch-run] AI summary failed (results unaffected):", err?.message);
          }
        }

        return res.json({
          runs: savedRuns,
          summary,
          summarySource: summary ? "ai-commentary" : null,
          outputLabels,
          computed: true,
          engine: "hyperformula",
          engineWarnings,
          outputsAreEstimates: false,
        });
      }

      // ── Fallback: engine could not handle this workbook — AI estimates ──
      if (!aiConfigured()) {
        return res.status(500).json({
          message: "Calculation engine failed for this workbook and AI estimation is not configured",
          engineError: engineFailure,
        });
      }

      const richContext = extractRichWorkbookContext(templateWb, 60);
      const estimateOutputKeys = outputKeys.slice(0, 8);

      const anthropic = getAnthropicClient();
      const batchPrompt = `You are analysing a property investment model. Given the full workbook with formulas, calculate the outputs for each scenario below.

SCENARIOS:
${scenarios.map((s: any, i: number) => `Scenario ${i + 1} "${s.name || `Scenario ${i + 1}`}": ${JSON.stringify(s.inputs)}`).join("\n")}

For each scenario, calculate these outputs based on the model's formulas:
${estimateOutputKeys.map(([key, cfg]: [string, any]) => `- ${cfg.label} (${key}, format: ${cfg.format})`).join("\n")}

Return ONLY valid JSON:
{
  "scenarios": [
    {
      "name": "scenario name",
      "outputs": { "outputKey": "formatted value", ... }
    }
  ],
  "summary": "Brief comparison of results across scenarios"
}`;

      const response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        system: "You are an expert property investment analyst. Calculate model outputs for multiple scenarios using the Excel model's actual formulas. Be precise.",
        messages: [
          { role: "user", content: `WORKBOOK:\n${richContext.slice(0, 50000)}\n\n${batchPrompt}` }
        ],
      });

      const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
      const parsed = safeParseAIJson(content);

      if (!parsed.scenarios || parsed.scenarios.length !== scenarios.length) {
        return res.status(500).json({ message: `AI returned ${parsed.scenarios?.length || 0} results for ${scenarios.length} scenarios. Please try again.` });
      }

      const savedRuns = [];
      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        const aiResult = parsed.scenarios?.[i];
        const runName = scenario.name || `Batch ${i + 1}`;

        const run = await storage.createExcelModelRun({
          templateId: template.id,
          name: runName,
          inputValues: JSON.stringify(scenario.inputs || {}),
          outputValues: JSON.stringify(aiResult?.outputs || {}),
          generatedFilePath: null as any,
          status: "estimated",
        });

        savedRuns.push({
          id: run.id,
          name: runName,
          status: run.status,
          inputs: scenario.inputs,
          outputs: aiResult?.outputs || {},
        });
      }

      res.json({
        runs: savedRuns,
        summary: parsed.summary,
        summarySource: "ai-estimate",
        outputLabels: Object.fromEntries(estimateOutputKeys.map(([k, c]: [string, any]) => [k, c.label])),
        computed: false,
        engineError: engineFailure,
        outputsAreEstimates: true,
        estimateNote: "The calculation engine could not process this workbook, so outputs are AI estimates derived from the model's formulas. Saved with status \"estimated\" — verify by running the model in Excel.",
      });
    } catch (err: any) {
      console.error("Batch run error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to run batch scenarios" });
    }
  });

  app.get("/api/models/templates/:id/dependencies", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const wb = XLSX.readFile(template.filePath, { cellFormula: true, sheetStubs: true });
      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      const inputCells = new Map<string, string>();
      for (const [key, cfg] of Object.entries(inputMapping) as [string, any][]) {
        inputCells.set(`${cfg.sheet}!${cfg.cell}`, cfg.label || key);
      }

      const outputCells = new Map<string, string>();
      for (const [key, cfg] of Object.entries(outputMapping) as [string, any][]) {
        outputCells.set(`${cfg.sheet}!${cfg.cell}`, cfg.label || key);
      }

      const formulaMap: Record<string, { formula: string; refs: string[]; value: any }> = {};
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws || !ws["!ref"]) continue;
        const range = XLSX.utils.decode_range(ws["!ref"]);
        for (let r = range.s.r; r <= Math.min(range.e.r, 200); r++) {
          for (let c = range.s.c; c <= Math.min(range.e.c, 30); c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = ws[addr];
            if (cell?.f) {
              const fullAddr = `${sheetName}!${addr}`;
              formulaMap[fullAddr] = {
                formula: cell.f,
                refs: parseFormulaReferences(cell.f).map(ref =>
                  ref.includes("!") ? ref : `${sheetName}!${ref}`
                ),
                value: cell.v,
              };
            }
          }
        }
      }

      const dependencies: Array<{
        output: { cell: string; label: string };
        chain: Array<{ cell: string; formula: string; label?: string }>;
        inputs: Array<{ cell: string; label: string }>;
      }> = [];

      for (const [cellRef, label] of outputCells) {
        const chain: Array<{ cell: string; formula: string; label?: string }> = [];
        const foundInputs: Array<{ cell: string; label: string }> = [];
        const visited = new Set<string>();

        function traceBack(ref: string, depth: number) {
          if (depth > 5 || visited.has(ref)) return;
          visited.add(ref);

          const formula = formulaMap[ref];
          if (formula) {
            chain.push({
              cell: ref,
              formula: `=${formula.formula}`,
              label: inputCells.get(ref) || outputCells.get(ref),
            });
            for (const depRef of formula.refs) {
              if (inputCells.has(depRef)) {
                foundInputs.push({ cell: depRef, label: inputCells.get(depRef)! });
              } else {
                traceBack(depRef, depth + 1);
              }
            }
          } else if (inputCells.has(ref)) {
            foundInputs.push({ cell: ref, label: inputCells.get(ref)! });
          }
        }

        traceBack(cellRef, 0);

        dependencies.push({
          output: { cell: cellRef, label },
          chain,
          inputs: [...new Map(foundInputs.map(i => [i.cell, i])).values()],
        });
      }

      res.json({
        dependencies,
        totalFormulas: Object.keys(formulaMap).length,
        totalInputs: inputCells.size,
        totalOutputs: outputCells.size,
      });
    } catch (err: any) {
      console.error("Dependencies error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to analyse dependencies" });
    }
  });

  app.get("/api/models/templates/:id/versions", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id as string);
      if (!template) return res.status(404).json({ message: "Template not found" });

      let rootId = template.id;
      let current = template;
      while (current.previousVersionId) {
        const prev = await storage.getExcelTemplate(current.previousVersionId);
        if (!prev) break;
        rootId = prev.id;
        current = prev;
      }

      const allTemplates = await storage.getExcelTemplates();
      const versions: any[] = [];

      function collectVersions(parentId: string | null, startTemplate: any) {
        versions.push({
          id: startTemplate.id,
          name: startTemplate.name,
          version: startTemplate.version || 1,
          description: startTemplate.description,
          originalFileName: startTemplate.originalFileName,
          createdAt: startTemplate.createdAt,
          isCurrent: startTemplate.id === template!.id,
        });

        const children = allTemplates.filter(t => t.previousVersionId === startTemplate.id);
        for (const child of children) {
          collectVersions(startTemplate.id, child);
        }
      }

      collectVersions(null, current);
      versions.sort((a, b) => (a.version || 1) - (b.version || 1));

      res.json({ versions, currentId: template.id });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch versions" });
    }
  });
}
