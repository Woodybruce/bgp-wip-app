import type { Express, Request, Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { requireAuth } from "./auth";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayQuery(query: string, variables?: Record<string, any>) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error("MONDAY_API_TOKEN not configured");
  }

  const body: any = { query };
  if (variables) {
    body.variables = variables;
  }

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Monday.com API error:", response.status, text);
    throw new Error("Monday.com API request failed");
  }

  const data = await response.json();
  if (data.errors) {
    console.error("Monday.com GraphQL errors:", data.errors);
    throw new Error("Monday.com query failed");
  }

  return data.data;
}

function isNumericId(val: string): boolean {
  return /^\d+$/.test(val);
}

function isAlphanumericId(val: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(val);
}

const ITEMS_FIELDS = `
  cursor
  items {
    id
    name
    group { id title color }
    column_values {
      id
      text
      type
      value
    }
    created_at
    updated_at
  }
`;

const REQUIREMENTS_BOARD_ID = 5091242787;
const REQUIREMENTS_INVESTMENT_BOARD_ID = 5092572124;
const DEALS_BOARD_ID = 5090914630;
const PROPERTIES_BOARD_ID = 5090914632;
const COMPANIES_BOARD_ID = 5090914628;
const CONTACTS_BOARD_ID = 5090914633;
const COMPS_BOARD_ID = 5091242058;

function formatColumnValue(colType: string, value: string): any {
  if (!value || value.trim() === "") return undefined;
  const v = value.trim();

  switch (colType) {
    case "numbers":
    case "numeric": {
      const num = parseFloat(v.replace(/[£$€,]/g, ""));
      return isNaN(num) ? undefined : num;
    }
    case "status":
    case "color":
      return { label: v };
    case "date":
      try {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          return { date: d.toISOString().split("T")[0] };
        }
      } catch {}
      return v;
    case "email":
      return { email: v, text: v };
    case "phone":
      return { phone: v };
    case "link":
      return { url: v, text: v };
    case "text":
    case "long_text":
      return v;
    case "dropdown":
      return { labels: v.split(",").map((s: string) => s.trim()).filter(Boolean) };
    case "people":
      return v;
    default:
      return v;
  }
}

export function setupMondayRoutes(app: Express) {
  app.get("/api/monday/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.json({ connected: false });
      }

      const data = await mondayQuery("query { me { id name email } }");
      res.json({ connected: true, user: data.me });
    } catch (err: any) {
      console.error("Monday status error:", err);
      res.json({ connected: false });
    }
  });

  app.get("/api/monday/boards", requireAuth, async (_req: Request, res: Response) => {
    try {
      const data = await mondayQuery(`
        query {
          boards(limit: 50) {
            id
            name
            description
            state
            board_kind
            columns {
              id
              title
              type
            }
            groups {
              id
              title
              color
            }
            items_count
          }
        }
      `);
      const boards = (data.boards || []).filter(
        (b: any) => !b.name.startsWith("Subitems of")
      );
      res.json(boards);
    } catch (err: any) {
      console.error("Monday boards error:", err);
      res.status(500).json({ message: "Failed to fetch boards" });
    }
  });

  app.get("/api/monday/boards/:boardId", requireAuth, async (req: Request, res: Response) => {
    try {
      const boardId = req.params.boardId as string;
      if (!isNumericId(boardId)) {
        return res.status(400).json({ message: "Invalid board ID" });
      }

      const groupId = req.query.groupId as string | undefined;
      if (groupId && !isAlphanumericId(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }

      const boardIdNum = parseInt(boardId, 10);

      let query: string;
      let variables: Record<string, any> | undefined;

      if (groupId) {
        query = `
          query ($boardIds: [ID!]!, $groupId: [String!]!) {
            boards(ids: $boardIds) {
              id
              name
              description
              columns { id title type settings_str }
              groups { id title color }
              items_page(limit: 50, query_params: { rules: [{ column_id: "__group__", compare_value: $groupId }] }) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [boardIdNum], groupId: [groupId] };
      } else {
        query = `
          query ($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              description
              columns { id title type settings_str }
              groups { id title color }
              items_page(limit: 50) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [boardIdNum] };
      }

      const data = await mondayQuery(query, variables);

      const board = data.boards?.[0];
      if (!board) {
        return res.status(404).json({ message: "Board not found" });
      }
      res.json(board);
    } catch (err: any) {
      console.error("Monday board detail error:", err);
      res.status(500).json({ message: "Failed to fetch board details" });
    }
  });

  app.get("/api/monday/deals", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const groupId = req.query.groupId as string | undefined;

      let query: string;
      let variables: Record<string, any>;

      if (groupId && isAlphanumericId(groupId)) {
        query = `
          query ($boardIds: [ID!]!, $groupId: [String!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 200, query_params: { rules: [{ column_id: "__group__", compare_value: $groupId }] }) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [DEALS_BOARD_ID], groupId: [groupId] };
      } else {
        query = `
          query ($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 200) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [DEALS_BOARD_ID] };
      }

      const data = await mondayQuery(query, variables);
      const board = data.boards?.[0];
      if (!board) {
        return res.status(404).json({ message: "Deals board not found" });
      }

      res.json(board);
    } catch (err: any) {
      console.error("Monday deals error:", err);
      res.status(500).json({ message: "Failed to fetch deals from Monday.com" });
    }
  });

  app.get("/api/monday/deals/columns", requireAuth, async (_req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const data = await mondayQuery(`
        query ($boardIds: [ID!]!) {
          boards(ids: $boardIds) {
            columns { id title type settings_str }
            groups { id title color }
          }
        }
      `, { boardIds: [DEALS_BOARD_ID] });

      const board = data.boards?.[0];
      if (!board) return res.status(404).json({ message: "Deals board not found" });

      res.json({ columns: board.columns, groups: board.groups });
    } catch (err: any) {
      console.error("Monday deals columns error:", err);
      res.status(500).json({ message: "Failed to fetch deals columns" });
    }
  });

  app.post("/api/monday/deals/import", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No CSV file uploaded" });
      }

      const csvContent = file.buffer.toString("utf-8");
      let records: Record<string, string>[];
      try {
        records = parse(csvContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
        });
      } catch (parseErr: any) {
        return res.status(400).json({ message: `CSV parse error: ${parseErr.message}` });
      }

      if (records.length === 0) {
        return res.status(400).json({ message: "CSV file is empty" });
      }

      let columnMapping = null;
      if (req.body.columnMapping) {
        try {
          columnMapping = JSON.parse(req.body.columnMapping);
        } catch {
          return res.status(400).json({ message: "Invalid column mapping JSON" });
        }
      }
      const groupId = req.body.groupId || "topics";

      const boardData = await mondayQuery(`
        query ($boardIds: [ID!]!) {
          boards(ids: $boardIds) {
            columns { id title type settings_str }
          }
        }
      `, { boardIds: [DEALS_BOARD_ID] });

      const boardColumns = boardData.boards?.[0]?.columns || [];
      const columnTypes: Record<string, { type: string; title: string }> = {};
      for (const col of boardColumns) {
        columnTypes[col.id] = { type: col.type, title: col.title };
      }

      const results: { name: string; success: boolean; error?: string }[] = [];

      for (const record of records) {
        const itemName = record["Name"] || record["name"] || record["Deal Name"] || record["deal_name"] || Object.values(record)[0] || "Untitled Deal";

        const columnValues: Record<string, any> = {};

        if (columnMapping) {
          for (const [csvCol, mondayColId] of Object.entries(columnMapping)) {
            if (mondayColId === "name" || mondayColId === "__skip__" || !record[csvCol]) continue;
            const colType = columnTypes[mondayColId as string]?.type;
            const val = record[csvCol];
            if (val) {
              columnValues[mondayColId as string] = formatColumnValue(colType, val);
            }
          }
        } else {
          for (const col of boardColumns) {
            if (col.type === "name") continue;
            const csvVal = record[col.title] || record[col.title.toLowerCase()];
            if (csvVal) {
              columnValues[col.id] = formatColumnValue(col.type, csvVal);
            }
          }
        }

        try {
          const columnValuesStr = JSON.stringify(JSON.stringify(columnValues));
          await mondayQuery(`
            mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
              create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) {
                id
              }
            }
          `, {
            boardId: DEALS_BOARD_ID,
            groupId,
            itemName: String(itemName).slice(0, 255),
            columnValues: JSON.stringify(columnValues),
          });

          results.push({ name: String(itemName), success: true });
        } catch (err: any) {
          results.push({ name: String(itemName), success: false, error: err.message?.slice(0, 100) });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        message: `Imported ${successCount} deal${successCount !== 1 ? "s" : ""} successfully${failCount > 0 ? `, ${failCount} failed` : ""}`,
        total: records.length,
        success: successCount,
        failed: failCount,
        results,
      });
    } catch (err: any) {
      console.error("CSV import error:", err);
      res.status(500).json({ message: "Failed to import deals from CSV" });
    }
  });

  app.get("/api/monday/properties", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const groupId = req.query.groupId as string | undefined;

      let query: string;
      let variables: Record<string, any>;

      if (groupId && isAlphanumericId(groupId)) {
        query = `
          query ($boardIds: [ID!]!, $groupId: [String!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 200, query_params: { rules: [{ column_id: "__group__", compare_value: $groupId }] }) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [PROPERTIES_BOARD_ID], groupId: [groupId] };
      } else {
        query = `
          query ($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 200) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [PROPERTIES_BOARD_ID] };
      }

      const data = await mondayQuery(query, variables);
      const board = data.boards?.[0];
      if (!board) {
        return res.status(404).json({ message: "Properties board not found" });
      }

      res.json(board);
    } catch (err: any) {
      console.error("Monday properties error:", err);
      res.status(500).json({ message: "Failed to fetch properties from Monday.com" });
    }
  });

  app.get("/api/monday/companies", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const groupId = req.query.groupId as string | undefined;

      let query: string;
      let variables: Record<string, any>;

      if (groupId && isAlphanumericId(groupId)) {
        query = `
          query ($boardIds: [ID!]!, $groupId: [String!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 500, query_params: { rules: [{ column_id: "__group__", compare_value: $groupId }] }) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [COMPANIES_BOARD_ID], groupId: [groupId] };
      } else {
        query = `
          query ($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 500) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [COMPANIES_BOARD_ID] };
      }

      const data = await mondayQuery(query, variables);
      const board = data.boards?.[0];
      if (!board) {
        return res.status(404).json({ message: "Companies board not found" });
      }

      res.json(board);
    } catch (err: any) {
      console.error("Monday companies error:", err);
      res.status(500).json({ message: "Failed to fetch companies from Monday.com" });
    }
  });

  app.get("/api/monday/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const groupId = req.query.groupId as string | undefined;

      let query: string;
      let variables: Record<string, any>;

      if (groupId && isAlphanumericId(groupId)) {
        query = `
          query ($boardIds: [ID!]!, $groupId: [String!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 500, query_params: { rules: [{ column_id: "__group__", compare_value: $groupId }] }) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [CONTACTS_BOARD_ID], groupId: [groupId] };
      } else {
        query = `
          query ($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 500) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [CONTACTS_BOARD_ID] };
      }

      const data = await mondayQuery(query, variables);
      const board = data.boards?.[0];
      if (!board) {
        return res.status(404).json({ message: "Contacts board not found" });
      }

      res.json(board);
    } catch (err: any) {
      console.error("Monday contacts error:", err);
      res.status(500).json({ message: "Failed to fetch contacts from Monday.com" });
    }
  });

  app.get("/api/monday/comps", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const groupId = req.query.groupId as string | undefined;

      let query: string;
      let variables: Record<string, any>;

      if (groupId && isAlphanumericId(groupId)) {
        query = `
          query ($boardIds: [ID!]!, $groupId: [String!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 500, query_params: { rules: [{ column_id: "__group__", compare_value: $groupId }] }) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [COMPS_BOARD_ID], groupId: [groupId] };
      } else {
        query = `
          query ($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 500) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [COMPS_BOARD_ID] };
      }

      const data = await mondayQuery(query, variables);
      const board = data.boards?.[0];
      if (!board) {
        return res.status(404).json({ message: "Comps board not found" });
      }

      res.json(board);
    } catch (err: any) {
      console.error("Monday comps error:", err);
      res.status(500).json({ message: "Failed to fetch comps from Monday.com" });
    }
  });

  app.get("/api/monday/items/:itemId/linked", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const itemId = req.params.itemId;
      if (!isNumericId(itemId as string)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const columnId = req.query.columnId as string;
      if (!columnId) {
        return res.status(400).json({ message: "columnId query parameter required" });
      }

      const query = `
        query ($itemIds: [ID!]!) {
          items(ids: $itemIds) {
            id
            name
            column_values(ids: ["${columnId}"]) {
              id
              text
              type
              value
            }
          }
        }
      `;

      const data = await mondayQuery(query, { itemIds: [parseInt(itemId as string, 10)] });
      const item = data.items?.[0];
      if (!item) {
        return res.json({ linkedItems: [] });
      }

      const relationCol = item.column_values?.[0];
      if (!relationCol?.value) {
        return res.json({ linkedItems: [] });
      }

      let linkedIds: number[] = [];
      try {
        const parsed = JSON.parse(relationCol.value);
        linkedIds = parsed.linkedPulseIds?.map((lp: any) => lp.linkedPulseId) || [];
      } catch {
        return res.json({ linkedItems: [] });
      }

      if (linkedIds.length === 0) {
        return res.json({ linkedItems: [] });
      }

      const linkedQuery = `
        query ($itemIds: [ID!]!) {
          items(ids: $itemIds) {
            id
            name
            board { id name }
            group { id title color }
            column_values {
              id
              text
              type
              value
            }
            created_at
            updated_at
          }
        }
      `;

      const linkedData = await mondayQuery(linkedQuery, { itemIds: linkedIds });
      res.json({ linkedItems: linkedData.items || [] });
    } catch (err: any) {
      console.error("Monday linked items error:", err);
      res.status(500).json({ message: "Failed to fetch linked items" });
    }
  });

  app.get("/api/monday/requirements", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = process.env.MONDAY_API_TOKEN;
      if (!token) {
        return res.status(503).json({ message: "Monday.com not connected" });
      }

      const groupId = req.query.groupId as string | undefined;

      let query: string;
      let variables: Record<string, any>;

      if (groupId && isAlphanumericId(groupId)) {
        query = `
          query ($boardIds: [ID!]!, $groupId: [String!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 200, query_params: { rules: [{ column_id: "__group__", compare_value: $groupId }] }) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [REQUIREMENTS_BOARD_ID], groupId: [groupId] };
      } else {
        query = `
          query ($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns { id title type }
              groups { id title color }
              items_page(limit: 200) {
                ${ITEMS_FIELDS}
              }
            }
          }
        `;
        variables = { boardIds: [REQUIREMENTS_BOARD_ID] };
      }

      const data = await mondayQuery(query, variables);
      const board = data.boards?.[0];
      if (!board) {
        return res.status(404).json({ message: "Requirements board not found" });
      }

      res.json(board);
    } catch (err: any) {
      console.error("Monday requirements error:", err);
      res.status(500).json({ message: "Failed to fetch requirements from Monday.com" });
    }
  });
}
