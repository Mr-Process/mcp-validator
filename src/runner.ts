import type { TestCase, TestResult, ResourceTestResult, PromptTestResult } from "./types.js";
import type { DiscoveredTool, McpClientInterface } from "./client.js";
import { validateOutputSchema } from "./generator.js";

export interface SuiteResults {
  toolResults: TestResult[];
  resourceResults: ResourceTestResult[];
  promptResults: PromptTestResult[];
}

export async function runTests(
  client: McpClientInterface,
  tools: DiscoveredTool[],
  testCases: Map<string, TestCase[]>,
  maxTests?: number
): Promise<SuiteResults> {
  await client.connect();

  const toolResults: TestResult[] = [];
  let executedCount = 0;

  // 1. Tool Tests & Output Schema Validation
  for (const tool of tools) {
    const cases = testCases.get(tool.name) || [];
    for (const tc of cases) {
      if (maxTests !== undefined && executedCount >= maxTests) {
        break;
      }

      const start = Date.now();
      let status: TestResult["status"] = "pass";
      let output: unknown = null;
      let error: string | null = null;

      try {
        const response = await client.callTool(tool.name, tc.input);
        output = response.content;

        if (response.isError) {
          status = tc.expectSuccess ? "fail" : "pass";
        } else {
          status = tc.expectSuccess ? "pass" : "fail";

          // If execution succeeded and outputSchema is present, validate output schema
          if (status === "pass" && tool.outputSchema) {
            const schemaCheck = validateOutputSchema(response.content, tool.outputSchema);
            if (!schemaCheck.valid) {
              status = "schema_mismatch";
              error = schemaCheck.error || "Output failed outputSchema validation";
            }
          }
        }
      } catch (e) {
        status = "crash";
        error = e instanceof Error ? e.message : String(e);
      }

      const durationMs = Date.now() - start;
      toolResults.push({
        toolName: tool.name,
        category: tc.category,
        description: tc.description,
        input: tc.input,
        status,
        output,
        error,
        durationMs,
      });

      executedCount++;
      const icon = status === "pass" ? "✓" : status === "schema_mismatch" ? "⚠️" : status === "fail" ? "✗" : "💥";
      console.error(`  ${icon} [${tool.name}] ${tc.description} (${durationMs}ms)`);
    }

    if (maxTests !== undefined && executedCount >= maxTests) {
      break;
    }
  }

  // 2. Resource Discovery & Read Validation
  const resourceResults: ResourceTestResult[] = [];
  try {
    const resources = await client.discoverResources();
    for (const res of resources) {
      const start = Date.now();
      let status: TestResult["status"] = "pass";
      let contentLength: number | undefined;
      let error: string | null = null;

      try {
        const readRes = await client.readResource(res.uri);
        const contentsStr = JSON.stringify(readRes.contents || "");
        contentLength = contentsStr.length;
      } catch (e) {
        status = "fail";
        error = e instanceof Error ? e.message : String(e);
      }

      const durationMs = Date.now() - start;
      resourceResults.push({
        uri: res.uri,
        name: res.name,
        status,
        mimeType: res.mimeType,
        contentLength,
        error,
        durationMs,
      });
      console.error(`  📄 [Resource] ${res.name} (${res.uri}) (${durationMs}ms)`);
    }
  } catch (e) {
    console.error(`  ⚠️ Resource discovery error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Prompt Discovery & Get Validation
  const promptResults: PromptTestResult[] = [];
  try {
    const prompts = await client.discoverPrompts();
    for (const p of prompts) {
      const start = Date.now();
      let status: TestResult["status"] = "pass";
      let output: unknown = null;
      let error: string | null = null;

      // Generate default prompt args
      const args: Record<string, string> = {};
      if (p.arguments) {
        for (const arg of p.arguments) {
          args[arg.name] = "test";
        }
      }

      try {
        const promptRes = await client.getPrompt(p.name, args);
        output = promptRes.messages;
      } catch (e) {
        status = "fail";
        error = e instanceof Error ? e.message : String(e);
      }

      const durationMs = Date.now() - start;
      promptResults.push({
        promptName: p.name,
        description: p.description || "",
        input: args,
        status,
        output,
        error,
        durationMs,
      });
      console.error(`  💬 [Prompt] ${p.name} (${durationMs}ms)`);
    }
  } catch (e) {
    console.error(`  ⚠️ Prompt discovery error: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (client.close) {
    await client.close();
  }

  return { toolResults, resourceResults, promptResults };
}
