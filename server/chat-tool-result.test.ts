import test from "node:test";
import assert from "node:assert/strict";
import { buildChatToolResultContent, type ChatToolResultBlock } from "./chat-tool-result";
import { convertMessagesForOpenAI } from "./utils/openai-client";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=";
const page = (index = 1) => ({ index, mimeType: "image/png", base64: png });
const document = () => ({ ok: true, fileName: "sample.pdf", mimeType: "application/pdf",
  text: "A retail unit with a blue entrance. Lease plan is on page two.", pageCount: 2, pageImages: [page(), page(2)] });
const textOf = (blocks: ChatToolResultBlock[]) => blocks.filter(p => p.type === "text").map(p => p.text).join("\n");

test("document results contain readable text and real images without base64 in text", async () => {
  const original = document();
  const before = JSON.stringify(original);
  const content = await buildChatToolResultContent("read_document", original);
  assert.ok(Array.isArray(content));
  assert.match(textOf(content), /blue entrance/);
  assert.match(textOf(content), /Document page 2/);
  assert.ok(!textOf(content).includes(png));
  assert.deepEqual(content.filter(p => p.type === "image"), [
    { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
  ]);
  assert.equal(JSON.stringify(original), before, "preparing the provider result must not mutate tool data");
});

test("OpenAI conversion keeps document images with the producing function call ID", async () => {
  const content = await buildChatToolResultContent("read_document", document());
  const conversation = [
    { role: "user", content: "Read the lease plan" },
    { role: "assistant", content: null, tool_calls: [{ id: "read-plan-42", type: "function",
      function: { name: "read_document", arguments: '{"storageKey":"test/sample.pdf"}' } }] },
    { role: "tool", tool_call_id: "read-plan-42", content },
  ];
  const request = convertMessagesForOpenAI(conversation);
  const output = request.input.find(p => p.type === "function_call_output");
  assert.equal(output.call_id, "read-plan-42");
  assert.equal(output.output.filter((p: any) => p.type === "input_image").length, 2);
  assert.equal(output.output.find((p: any) => p.type === "input_image").image_url, `data:image/png;base64,${png}`);
  assert.ok(output.output.filter((p: any) => p.type === "input_text").every((p: any) => !p.text.includes(png)));
  // The same content also survives the shared Anthropic-form tool result path.
  conversation[2] = { role: "user", content: [{ type: "tool_result", tool_use_id: "read-plan-42", content }] } as any;
  const anthropicOutput = convertMessagesForOpenAI(conversation).input.find(p => p.type === "function_call_output");
  assert.deepEqual(anthropicOutput, output);
});

test("large text cannot crowd out page images and truncation is explicit", async () => {
  const content = await buildChatToolResultContent("read_document", { ...document(), text: "evidence ".repeat(20_000), textTruncated: true });
  assert.ok(Array.isArray(content));
  const textBlocks = content.filter(p => p.type === "text");
  assert.ok(textBlocks.reduce((sum, p) => sum + p.text.length, 0) <= 80_000);
  assert.match(textOf(content), /truncated/);
  assert.match(textOf(content), /omitted content has not been read/);
  assert.equal(content.filter(p => p.type === "image").length, 2);
  assert.ok(!textOf(content).includes(png));
});

test("missing or excess image pages are disclosed while extracted text remains useful", async () => {
  const content = await buildChatToolResultContent("read_document", { ...document(), pageCount: 8,
    pageImages: [page(), { ...page(2), base64: "not*base64" }, page(3), page(4), page(5)] });
  assert.ok(Array.isArray(content));
  const text = textOf(content);
  assert.match(text, /Image unavailable/);
  assert.match(text, /first 4 of 5/);
  assert.match(text, /document has 8 pages/);
  assert.match(text, /blue entrance/);
  assert.ok(!text.includes("not*base64"));
  assert.equal(content.filter(p => p.type === "image").length, 3);
});

test("unsupported image formats are decoded into provider-compatible JPEG images", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="blue"/></svg>').toString("base64");
  const content = await buildChatToolResultContent("read_document", { ok: true, fileName: "diagram.svg",
    pageImages: [{ index: 1, mimeType: "image/svg+xml", base64: svg }] });
  assert.ok(Array.isArray(content));
  const image = content.find(p => p.type === "image");
  assert.equal(image?.source.media_type, "image/jpeg");
  assert.ok(!textOf(content).includes(svg));
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(Buffer.from(image!.source.data, "base64")).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 12);
  assert.equal(metadata.height, 8);
});

test("ordinary tools and documents without visual pages keep their original text contract", async () => {
  assert.equal(await buildChatToolResultContent("find_contacts", { found: [{ name: "Example" }] }), '{"found":[{"name":"Example"}]}');
  assert.equal(await buildChatToolResultContent("query", "Already formatted text"), "Already formatted text");
  assert.equal(await buildChatToolResultContent("read_document", { ok: false, error: "File not found" }), '{"ok":false,"error":"File not found"}');
  assert.equal(await buildChatToolResultContent("read_document", { text: "Only text", pageImages: [] }), '{"text":"Only text","pageImages":[]}');
  const large = await buildChatToolResultContent("query", "x".repeat(90_000));
  assert.equal(typeof large, "string");
  assert.equal(large.length, 80_000);
  assert.match(large as string, /full text result was 90000 chars/);
  assert.equal(await buildChatToolResultContent("query", undefined), "No output");
});
