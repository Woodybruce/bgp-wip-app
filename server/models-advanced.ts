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

function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
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

  app.post("/api/models/templates/:id/sensitivity", requireAuth, async (req: Request, res: Response) => {
    try {
      const { variable1, variable2, baseInputs } = req.body;
      if (!variable1) return res.status(400).json({ message: "At least one variable is required" });

      const template = await storage.getExcelTemplate(req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) return res.status(500).json({ message: "AI not configured" });

      const wb = XLSX.readFile(template.filePath);
      const richContext = extractRichWorkbookContext(wb, 60);
      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");

      const var1Config = inputMapping[variable1.key];
      const var2Config = variable2 ? inputMapping[variable2.key] : null;

      let sensitivityPrompt = `You are analysing a property investment model. Given the full workbook with formulas, calculate how key outputs change when inputs are varied.

BASE INPUTS: ${JSON.stringify(baseInputs || {})}

VARIABLE 1: "${var1Config?.label || variable1.key}" (${var1Config?.type || "number"})
Values to test: ${JSON.stringify(variable1.values)}`;

      if (var2Config && variable2) {
        sensitivityPrompt += `\n\nVARIABLE 2: "${var2Config?.label || variable2.key}" (${var2Config?.type || "number"})
Values to test: ${JSON.stringify(variable2.values)}`;
      }

      const outputKeys = Object.entries(outputMapping).slice(0, 6);
      sensitivityPrompt += `\n\nFor each combination, calculate these outputs based on the model's formulas:
${outputKeys.map(([key, cfg]: [string, any]) => `- ${cfg.label} (${key})`).join("\n")}

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
        model: "claude-sonnet-4-6",
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
        outputLabels: Object.fromEntries(outputKeys.map(([k, c]: [string, any]) => [k, c.label])),
        results: parsed.results,
        insights: parsed.insights,
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
      const run = await storage.getExcelModelRun(req.params.id);
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
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: `You are a senior investment analyst at Bruce Gillingham Pollard (BGP), a London property consultancy. Write a professional investment memo. Structure it with these sections:
1. EXECUTIVE SUMMARY (2-3 sentences)
2. INVESTMENT OVERVIEW (property details, location, type)
3. KEY ASSUMPTIONS (formatted list of inputs)
4. FINANCIAL ANALYSIS (returns, yields, key metrics)
5. RISK FACTORS (3-5 specific risks)
6. RECOMMENDATION (buy/hold/pass with reasoning)

Be specific with numbers. Use professional property investment language. Keep it concise but thorough.`,
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

      const lines = memoText.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { doc.moveDown(0.3); continue; }

        if (/^\d+\.\s+[A-Z]/.test(trimmed) || /^[A-Z]{3,}/.test(trimmed)) {
          doc.moveDown(0.5);
          doc.fontSize(13).fillColor("#000000").font("Helvetica-Bold").text(trimmed);
          doc.moveDown(0.3);
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
          doc.fontSize(10).fillColor("#333333").font("Helvetica").text(trimmed, { indent: 15 });
          doc.moveDown(0.15);
        } else {
          doc.fontSize(10).fillColor("#333333").font("Helvetica").text(trimmed);
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

      const template = await storage.getExcelTemplate(req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const inputMapping = JSON.parse(template.inputMapping || "{}");
      const outputMapping = JSON.parse(template.outputMapping || "{}");
      const RUNS_DIR = path.join(process.cwd(), "ChatBGP", "runs");

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
        return res.status(500).json({ message: "AI not configured" });
      }

      const wb = XLSX.readFile(template.filePath);
      const richContext = extractRichWorkbookContext(wb, 60);
      const outputKeys = Object.entries(outputMapping).slice(0, 8);

      const anthropic = getAnthropicClient();
      const batchPrompt = `You are analysing a property investment model. Given the full workbook with formulas, calculate the outputs for each scenario below.

SCENARIOS:
${scenarios.map((s: any, i: number) => `Scenario ${i + 1} "${s.name || `Scenario ${i + 1}`}": ${JSON.stringify(s.inputs)}`).join("\n")}

For each scenario, calculate these outputs based on the model's formulas:
${outputKeys.map(([key, cfg]: [string, any]) => `- ${cfg.label} (${key}, format: ${cfg.format})`).join("\n")}

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
        model: "claude-sonnet-4-6",
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
          status: "completed",
        });

        savedRuns.push({
          id: run.id,
          name: runName,
          inputs: scenario.inputs,
          outputs: aiResult?.outputs || {},
        });
      }

      res.json({
        runs: savedRuns,
        summary: parsed.summary,
        outputLabels: Object.fromEntries(outputKeys.map(([k, c]: [string, any]) => [k, c.label])),
      });
    } catch (err: any) {
      console.error("Batch run error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to run batch scenarios" });
    }
  });

  app.get("/api/models/templates/:id/dependencies", requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await storage.getExcelTemplate(req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const wb = XLSX.readFile(template.filePath);
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
      const template = await storage.getExcelTemplate(req.params.id);
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
          isCurrent: startTemplate.id === template.id,
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
