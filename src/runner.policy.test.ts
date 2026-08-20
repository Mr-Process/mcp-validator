import assert from "node:assert/strict";
import { runTests } from "./runner.js";
import type { McpClientInterface, DiscoveredTool } from "./client.js";
import type { TestCase } from "./types.js";

class FakeClient implements McpClientInterface {
  calls = 0;
  resourceReads = 0;
  promptGets = 0;

  async connect(): Promise<void> {}
  async discoverTools(): Promise<DiscoveredTool[]> { return []; }
  async callTool(): Promise<{ content: unknown; isError: boolean }> {
    this.calls += 1;
    return { content: { result: "ok" }, isError: false };
  }
  async discoverResources() { return [{ uri: "test://resource", name: "resource" }]; }
  async readResource() {
    this.resourceReads += 1;
    return { contents: "resource" };
  }
  async discoverPrompts() { return [{ name: "prompt", arguments: [{ name: "input" }] }]; }
  async getPrompt() {
    this.promptGets += 1;
    return { messages: [{ role: "user", content: "prompt" }] };
  }
}

const tool: DiscoveredTool = { name: "test", inputSchema: { type: "object" } };
const cases: TestCase[] = [
  { category: "valid_minimal", description: "safe case", input: {}, expectSuccess: true },
  { category: "fuzz_xss", description: "fuzz case", input: { value: "<script>" }, expectSuccess: false },
];

async function main(): Promise<void> {
  const discoveryClient = new FakeClient();
  const discovery = await runTests(discoveryClient, [tool], new Map([[tool.name, cases]]));
  assert.equal(discoveryClient.calls, 0);
  assert.equal(discoveryClient.resourceReads, 0);
  assert.equal(discoveryClient.promptGets, 0);
  assert.ok(discovery.toolResults.every((result) => result.status === "skipped"));

  const controlledClient = new FakeClient();
  const controlled = await runTests(controlledClient, [tool], new Map([[tool.name, cases]]), {
    allowToolExecution: true,
    maxToolTests: 1,
    allowResourceReads: true,
    maxResourceReads: 1,
    allowPromptExecution: true,
    maxPromptGets: 1,
  });
  assert.equal(controlledClient.calls, 1);
  assert.equal(controlledClient.resourceReads, 1);
  assert.equal(controlledClient.promptGets, 1);
  assert.equal(controlled.toolResults[1].status, "skipped");
  assert.match(controlled.toolResults[1].error ?? "", /fuzz/i);

  console.log("PASS: MCP validator execution-policy tests completed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
