"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("agent assets exist and example JSON is parseable", () => {
  const root = path.resolve(__dirname, "..");
  const mustExist = [
    "AGENTS.md",
    "llms.txt",
    "docs/AGENT_INTEGRATION.md",
    "docs/PROMOTION.md",
    "examples/agent-defaults.json",
    "schemas/capabilities.schema.json",
    "schemas/agent-defaults.schema.json"
  ];

  for (const rel of mustExist) {
    const abs = path.join(root, rel);
    assert.equal(fs.existsSync(abs), true, `${rel} should exist`);
  }

  const json = JSON.parse(
    fs.readFileSync(path.join(root, "examples/agent-defaults.json"), "utf8")
  );
  assert.equal(json.tool, "docx2pdf-cli");
  assert.equal(json.default, true);
  assert.equal(typeof json.commands.single, "string");
});
