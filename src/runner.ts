import type { TestCase, TestResult, ResourceTestResult, PromptTestResult } from "./types.js";
import type { DiscoveredTool, McpClientInterface } from "./client.js";
import { validateOutputSchema } from "./generator.js";

export interface SuiteResults {
  toolResults: TestResult[];
  resourceResults: ResourceTestResult[];
  promptResults: PromptTestResult[];
}

export interface RunOptions {
  /** Maximum tool cases. `0` means no tool calls. */
  maxToolTests?: number;
  /** Maximum resource reads. `0` means discover only. */
  maxResourceReads?: number;
  /** Maximum prompt gets. `0` means discover only. */
  maxPromptGets?: number;
  /** Maximum serialized result size retained in reports. */
  maxOutputBytes?: number;
  /** Per-operation timeout for the validator. This cannot cancel an uncooperative server. */
  operationTimeoutMs?: number;
  /** Explicit operator consent to call tools. Defaults to false. */
  allowToolExecution?: boolean;
  /** Explicit operator consent to send generated fuzz cases. Defaults to false. */
  allowFuzzing?: boolean;
  /** Explicit operator consent to read MCP resources. Defaults to false. */
  allowResourceReads?: boolean;
  /** Explicit operator consent to invoke MCP prompts. Defaults to false. */
  allowPromptExecution?: boolean;
}

type ResolvedRunOptions = Required<RunOptions>;

const SAFE_DEFAULTS: ResolvedRunOptions = {
  maxToolTests: 0,
  maxResourceReads: 0,
  maxPromptGets: 0,
  maxOutputBytes: 256 * 1024,
  operationTimeoutMs: 30_000,
  allowToolExecution: false,
  allowFuzzing: false,
  allowResourceReads: false,
  allowPromptExecution: false,
};

function resolveOptions(options?: number | RunOptions): ResolvedRunOptions {
  // Preserve prior library behavior only when callers use the old numeric API.
  // The CLI uses the object form and therefore starts in discovery-only mode.
  if (typeof options === "number") {
    return {
      ...SAFE_DEFAULTS,
      maxToolTests: Math.max(0, options),
      maxResourceReads: Number.MAX_SAFE_INTEGER,
      maxPromptGets: Number.MAX_SAFE_INTEGER,
      allowToolExecution: true,
      allowFuzzing: true,
      allowResourceReads: true,
      allowPromptExecution: true,
    };
  }

  return { ...SAFE_DEFAULTS, ...(options ?? {}) };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Validator operation timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

function retainBoundedOutput(value: unknown, maximumBytes: number): { value: unknown; limited: boolean } {
  if (serializedByteLength(value) <= maximumBytes) return { value, limited: false };
  return {
    value: { truncated: true, reason: `Output exceeded retained-report limit of ${maximumBytes} bytes.` },
    limited: true,
  };
}

function isFuzzCase(testCase: TestCase): boolean {
  return testCase.category.startsWith("fuzz_");
}

function toolSkipResult(tool: DiscoveredTool, testCase: TestCase, reason: string): TestResult {
  return {
    toolName: tool.name,
    category: testCase.category,
    description: testCase.description,
    input: testCase.input,
    status: "skipped",
    output: null,
    error: reason,
    durationMs: 0,
  };
}

export async function runTests(
  client: McpClientInterface,
  tools: DiscoveredTool[],
  testCases: Map<string, TestCase[]>,
  options?: number | RunOptions
): Promise<SuiteResults> {
  const policy = resolveOptions(options);
  await withTimeout(client.connect(), policy.operationTimeoutMs);

  const toolResults: TestResult[] = [];
  let executedToolCount = 0;

  for (const tool of tools) {
    for (const testCase of testCases.get(tool.name) ?? []) {
      if (!policy.allowToolExecution) {
        toolResults.push(toolSkipResult(tool, testCase, "Tool execution requires explicit operator consent."));
        continue;
      }
      if (isFuzzCase(testCase) && !policy.allowFuzzing) {
        toolResults.push(toolSkipResult(tool, testCase, "Generated fuzz cases require explicit operator consent."));
        continue;
      }
      if (executedToolCount >= policy.maxToolTests) {
        toolResults.push(toolSkipResult(tool, testCase, "Tool execution budget reached."));
        continue;
      }

      const startedAt = Date.now();
      let status: TestResult["status"] = "pass";
      let output: unknown = null;
      let error: string | null = null;

      try {
        const response = await withTimeout(
          client.callTool(tool.name, testCase.input),
          policy.operationTimeoutMs
        );
        const retained = retainBoundedOutput(response.content, policy.maxOutputBytes);
        output = retained.value;

        if (retained.limited) {
          status = "output_limited";
          error = "Tool response was too large to retain in the report.";
        } else if (response.isError) {
          status = testCase.expectSuccess ? "fail" : "pass";
        } else {
          status = testCase.expectSuccess ? "pass" : "fail";
          if (status === "pass" && tool.outputSchema) {
            const schemaCheck = validateOutputSchema(response.content, tool.outputSchema);
            if (!schemaCheck.valid) {
              status = "schema_mismatch";
              error = schemaCheck.error || "Output failed output-schema validation.";
            }
          }
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        status = message.includes("timed out") ? "timeout" : "crash";
        error = message;
      }

      toolResults.push({
        toolName: tool.name,
        category: testCase.category,
        description: testCase.description,
        input: testCase.input,
        status,
        output,
        error,
        durationMs: Date.now() - startedAt,
      });
      executedToolCount += 1;
    }
  }

  const resourceResults: ResourceTestResult[] = [];
  try {
    const resources = await withTimeout(client.discoverResources(), policy.operationTimeoutMs);
    for (const [index, resource] of resources.entries()) {
      if (!policy.allowResourceReads || index >= policy.maxResourceReads) {
        resourceResults.push({
          uri: resource.uri,
          name: resource.name,
          status: "skipped",
          mimeType: resource.mimeType,
          error: policy.allowResourceReads ? "Resource-read budget reached." : "Resource reads require explicit operator consent.",
          durationMs: 0,
        });
        continue;
      }

      const startedAt = Date.now();
      let status: ResourceTestResult["status"] = "pass";
      let contentLength: number | undefined;
      let error: string | null = null;
      try {
        const response = await withTimeout(client.readResource(resource.uri), policy.operationTimeoutMs);
        contentLength = serializedByteLength(response.contents);
        if (contentLength > policy.maxOutputBytes) {
          status = "output_limited";
          error = "Resource exceeded the retained-report size limit.";
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        status = message.includes("timed out") ? "timeout" : "fail";
        error = message;
      }

      resourceResults.push({
        uri: resource.uri,
        name: resource.name,
        status,
        mimeType: resource.mimeType,
        contentLength,
        error,
        durationMs: Date.now() - startedAt,
      });
    }
  } catch (caught) {
    console.error(`Resource discovery error: ${caught instanceof Error ? caught.message : String(caught)}`);
  }

  const promptResults: PromptTestResult[] = [];
  try {
    const prompts = await withTimeout(client.discoverPrompts(), policy.operationTimeoutMs);
    for (const [index, prompt] of prompts.entries()) {
      const defaultArguments = Object.fromEntries((prompt.arguments ?? []).map((argument) => [argument.name, "test"]));
      if (!policy.allowPromptExecution || index >= policy.maxPromptGets) {
        promptResults.push({
          promptName: prompt.name,
          description: prompt.description || "",
          input: defaultArguments,
          status: "skipped",
          output: null,
          error: policy.allowPromptExecution ? "Prompt-execution budget reached." : "Prompt execution requires explicit operator consent.",
          durationMs: 0,
        });
        continue;
      }

      const startedAt = Date.now();
      let status: PromptTestResult["status"] = "pass";
      let output: unknown = null;
      let error: string | null = null;
      try {
        const response = await withTimeout(client.getPrompt(prompt.name, defaultArguments), policy.operationTimeoutMs);
        const retained = retainBoundedOutput(response.messages, policy.maxOutputBytes);
        output = retained.value;
        if (retained.limited) {
          status = "output_limited";
          error = "Prompt response was too large to retain in the report.";
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        status = message.includes("timed out") ? "timeout" : "fail";
        error = message;
      }

      promptResults.push({
        promptName: prompt.name,
        description: prompt.description || "",
        input: defaultArguments,
        status,
        output,
        error,
        durationMs: Date.now() - startedAt,
      });
    }
  } catch (caught) {
    console.error(`Prompt discovery error: ${caught instanceof Error ? caught.message : String(caught)}`);
  } finally {
    await client.close?.();
  }

  return { toolResults, resourceResults, promptResults };
}
