import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(new URL("../templates/chatbox.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles/base.css", import.meta.url), "utf8");
const workspace = await readFile(new URL("../scripts/workspace.js", import.meta.url), "utf8");

test("renders the attachment control in the media bar", () => {
  assert.ok(template.indexOf("<fg-assetbar") < template.indexOf("<textarea"));
  assert.match(template, /data-chat-attachment-preview/);
  assert.match(template, /data-chat-attachment-input/);
  assert.match(template, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
});

test("matches the backend attachment constraints and payload", () => {
  assert.match(workspace, /MAX_ATTACHMENTS = 9/);
  assert.match(workspace, /MAX_ATTACHMENT_SIZE = 8 \* 1024 \* 1024/);
  assert.match(workspace, /client\.storage\.from\("asset-images"\)/);
  assert.match(workspace, /available_references: references/);
  assert.match(workspace, /reference_urls: attached\.map/);
});

test("supports preview removal and temporary-turn references", () => {
  assert.match(workspace, /new URL\("icons\/x\.svg", api\.root\(\)\)/);
  assert.match(workspace, /referenceIndex !== index/);
  assert.match(workspace, /queuePendingTurn\(prompt, references\)/);
  assert.match(workspace, /submitMessage\(pendingTurn\.message, null, pendingTurn\.references\)/);
  assert.match(styles, /fg-chatattachment:hover \.chatboxAttachmentRemove/);
});
