import { spawn, ChildProcess } from "child_process";
import type { DiscoveredResource, DiscoveredPrompt } from "./types.js";
import type { JsonSchema } from "./generator.js";

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: JsonSchema;
}

export interface McpClientInterface {
  connect(): Promise<void>;
  discoverTools(): Promise<DiscoveredTool[]>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<{ content: unknown; isError: boolean }>;
  discoverResources(): Promise<DiscoveredResource[]>;
  readResource(uri: string): Promise<{ contents: unknown }>;
  discoverPrompts(): Promise<DiscoveredPrompt[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<{ messages: unknown; description?: string }>;
  close?(): Promise<void>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Parse an SSE response body into JSON-RPC messages.
 */
async function readSseResponse(response: Response): Promise<unknown> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();

  const events = buffer.split("\n\n").filter(Boolean);
  for (const event of events) {
    const lines = event.split("\n");
    let data = "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        data += line.slice(6);
      } else if (line.startsWith("data:")) {
        data += line.slice(5);
      }
    }
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.result !== undefined || parsed.error !== undefined) {
        return parsed;
      }
    }
  }

  throw new Error("No JSON-RPC response found in SSE stream");
}

/**
 * Send a JSON-RPC request and parse the response (JSON or SSE).
 */
async function rpcRequest(
  url: string,
  message: JsonRpcRequest | JsonRpcNotification,
  sessionId: string | null,
  timeoutMs: number,
  customHeaders?: Record<string, string>
): Promise<{ body: unknown; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "User-Agent": "mcp-validator/1.0.0",
    ...customHeaders,
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });

  const newSessionId = response.headers.get("mcp-session-id") || sessionId;

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  if (response.status === 202) {
    await response.body?.cancel();
    return { body: null, sessionId: newSessionId };
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    const body = await readSseResponse(response);
    return { body, sessionId: newSessionId };
  } else {
    const body = await response.json();
    return { body, sessionId: newSessionId };
  }
}

/**
 * Raw HTTP client for streamable HTTP MCP servers.
 */
export class RawMcpClient implements McpClientInterface {
  private sessionId: string | null = null;
  private reqId = 1;

  constructor(
    private serverUrl: string,
    private timeoutMs = 30000,
    private customHeaders?: Record<string, string>
  ) {}

  async connect(): Promise<void> {
    if (this.sessionId) return;

    const initResult = await rpcRequest(
      this.serverUrl,
      {
        jsonrpc: "2.0",
        id: this.reqId++,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "mcp-validator", version: "1.0.0" },
        },
      },
      null, // Never send sessionId header during initialize
      this.timeoutMs,
      this.customHeaders
    );
    this.sessionId = initResult.sessionId;

    const notifResult = await rpcRequest(
      this.serverUrl,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      this.sessionId,
      this.timeoutMs,
      this.customHeaders
    );
    this.sessionId = notifResult.sessionId;
  }

  async discoverTools(): Promise<DiscoveredTool[]> {
    if (!this.sessionId) await this.connect();

    const listResult = await rpcRequest(
      this.serverUrl,
      { jsonrpc: "2.0", id: this.reqId++, method: "tools/list", params: {} },
      this.sessionId,
      this.timeoutMs,
      this.customHeaders
    );

    const result = listResult.body as any;
    if (result?.error) {
      throw new Error(`MCP error: ${result.error.message}`);
    }

    const tools = result?.result?.tools || [];
    return tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      outputSchema: tool.outputSchema as JsonSchema | undefined,
    }));
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: unknown; isError: boolean }> {
    if (!this.sessionId) await this.connect();

    const callResult = await rpcRequest(
      this.serverUrl,
      {
        jsonrpc: "2.0",
        id: this.reqId++,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      },
      this.sessionId,
      this.timeoutMs,
      this.customHeaders
    );

    const result = callResult.body as any;
    if (result?.error) {
      return { content: result.error, isError: true };
    }

    return {
      content: result?.result?.content,
      isError: result?.result?.isError ?? false,
    };
  }

  async discoverResources(): Promise<DiscoveredResource[]> {
    if (!this.sessionId) await this.connect();

    try {
      const res = await rpcRequest(
        this.serverUrl,
        { jsonrpc: "2.0", id: this.reqId++, method: "resources/list", params: {} },
        this.sessionId,
        this.timeoutMs,
        this.customHeaders
      );
      const result = res.body as any;
      if (result?.error) return [];
      return result?.result?.resources || [];
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<{ contents: unknown }> {
    if (!this.sessionId) await this.connect();

    const res = await rpcRequest(
      this.serverUrl,
      { jsonrpc: "2.0", id: this.reqId++, method: "resources/read", params: { uri } },
      this.sessionId,
      this.timeoutMs,
      this.customHeaders
    );
    const result = res.body as any;
    if (result?.error) {
      throw new Error(`Resource error: ${result.error.message}`);
    }
    return { contents: result?.result?.contents };
  }

  async discoverPrompts(): Promise<DiscoveredPrompt[]> {
    if (!this.sessionId) await this.connect();

    try {
      const res = await rpcRequest(
        this.serverUrl,
        { jsonrpc: "2.0", id: this.reqId++, method: "prompts/list", params: {} },
        this.sessionId,
        this.timeoutMs,
        this.customHeaders
      );
      const result = res.body as any;
      if (result?.error) return [];
      return result?.result?.prompts || [];
    } catch {
      return [];
    }
  }

  async getPrompt(name: string, args: Record<string, string> = {}): Promise<{ messages: unknown; description?: string }> {
    if (!this.sessionId) await this.connect();

    const res = await rpcRequest(
      this.serverUrl,
      { jsonrpc: "2.0", id: this.reqId++, method: "prompts/get", params: { name, arguments: args } },
      this.sessionId,
      this.timeoutMs,
      this.customHeaders
    );
    const result = res.body as any;
    if (result?.error) {
      throw new Error(`Prompt error: ${result.error.message}`);
    }
    return {
      messages: result?.result?.messages,
      description: result?.result?.description,
    };
  }
}

/**
 * Client for local Stdio MCP servers running via child_process.spawn.
 */
export class StdioMcpClient implements McpClientInterface {
  private child: ChildProcess | null = null;
  private reqId = 1;
  private pending = new Map<number, (res: any) => void>();
  private buffer = "";
  private isConnected = false;

  constructor(private command: string, private timeoutMs = 30000) {}

  async connect(): Promise<void> {
    if (this.isConnected) return;

    const parts = this.command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    this.child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });

    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.id && this.pending.has(parsed.id)) {
            const resolve = this.pending.get(parsed.id)!;
            this.pending.delete(parsed.id);
            resolve(parsed);
          }
        } catch {
          // ignore non-json log lines
        }
      }
    });

    this.isConnected = true;

    // Send initialize
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcp-validator-stdio", version: "1.0.0" },
    });

    // Send initialized notification
    this.notify("notifications/initialized", {});
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.child.stdin.write(msg);
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin?.writable) {
        return reject(new Error("Stdio process not writable"));
      }

      const id = this.reqId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Stdio request ${method} timed out`));
      }, this.timeoutMs);

      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });

      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.child.stdin.write(msg);
    });
  }

  async discoverTools(): Promise<DiscoveredTool[]> {
    await this.connect();
    const res = await this.request("tools/list", {});
    if (res.error) throw new Error(`MCP Stdio error: ${res.error.message}`);
    const tools = res.result?.tools || [];
    return tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      outputSchema: tool.outputSchema as JsonSchema | undefined,
    }));
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<{ content: unknown; isError: boolean }> {
    await this.connect();
    const res = await this.request("tools/call", { name: toolName, arguments: args });
    if (res.error) return { content: res.error, isError: true };
    return {
      content: res.result?.content,
      isError: res.result?.isError ?? false,
    };
  }

  async discoverResources(): Promise<DiscoveredResource[]> {
    await this.connect();
    try {
      const res = await this.request("resources/list", {});
      if (res.error) return [];
      return res.result?.resources || [];
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<{ contents: unknown }> {
    await this.connect();
    const res = await this.request("resources/read", { uri });
    if (res.error) throw new Error(`Resource Stdio error: ${res.error.message}`);
    return { contents: res.result?.contents };
  }

  async discoverPrompts(): Promise<DiscoveredPrompt[]> {
    await this.connect();
    try {
      const res = await this.request("prompts/list", {});
      if (res.error) return [];
      return res.result?.prompts || [];
    } catch {
      return [];
    }
  }

  async getPrompt(name: string, args: Record<string, string> = {}): Promise<{ messages: unknown; description?: string }> {
    await this.connect();
    const res = await this.request("prompts/get", { name, arguments: args });
    if (res.error) throw new Error(`Prompt Stdio error: ${res.error.message}`);
    return {
      messages: res.result?.messages,
      description: res.result?.description,
    };
  }

  async close(): Promise<void> {
    if (this.child) {
      this.child.kill();
      this.child = null;
      this.isConnected = false;
    }
  }
}

export async function discoverTools(serverUrl: string, timeoutMs = 30000): Promise<DiscoveredTool[]> {
  const client = new RawMcpClient(serverUrl, timeoutMs);
  return client.discoverTools();
}

export async function callTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 30000
): Promise<{ content: unknown; isError: boolean }> {
  const client = new RawMcpClient(serverUrl, timeoutMs);
  return client.callTool(toolName, args);
}
