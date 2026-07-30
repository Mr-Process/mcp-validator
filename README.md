# ⚡ MCP Validator

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-v1.0-blue?logo=github-actions)](https://github.com/Mr-Process/mcp-validator/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-Deployed-orange?logo=cloudflare)](https://mcp-validator.jonathonpowell.workers.dev)

An automated validation, schema testing, and security fuzzing engine for Model Context Protocol (MCP) servers. 

MCP Validator connects to any MCP server (over HTTP/SSE or local `stdio`), discovers its tools, resources, and prompts, auto-generates test suites from JSON Schemas, executes security fuzzing vectors, and reports what passes, what breaks, and what violates declared contracts.

---

## 📸 Overview & Architecture

```
                               ┌─────────────────────────┐
                               │     MCP Validator       │
                               └────────────┬────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
         ┌─────────────────────┐                         ┌─────────────────────┐
         │ HTTP / SSE Server   │                         │  Local Stdio Binary │
         │ (Streamable HTTP)   │                         │  (child_process)    │
         └──────────┬──────────┘                         └──────────┬──────────┘
                    │                                               │
                    └───────────────────────┬───────────────────────┘
                                            │
                                            ▼
                           ┌─────────────────────────────────┐
                           │      Validation Engine          │
                           ├─────────────────────────────────┤
                           │  • Tool Discovery & Execution   │
                           │  • Output Schema Validation     │
                           │  • Security Fuzzing (5 Vectors) │
                           │  • Resource & Prompt Testing    │
                           └────────────────┬────────────────┘
                                            │
                                            ▼
                           ┌─────────────────────────────────┐
                           │    Markdown / JSON Reports      │
                           └─────────────────────────────────┘
```

---

## ✨ Features

- **📡 Dual Transport Support**: Connects to remote HTTP/Streamable HTTP endpoints (`https://...`) or spawns local CLI binaries (`--command "node dist/index.js"`).
- **🛠️ Tool Schema Validation**: Generates 6 test categories per tool (`valid_minimal`, `valid_full`, `edge_empty_string`, `edge_zero`, `edge_max`, `edge_boundary`, `invalid_missing_required`, `invalid_wrong_type`, `invalid_null`).
- **🛡️ Output Schema Validation**: Validates tool response payloads against declared `outputSchema` definitions, flagging `schema_mismatch` errors.
- **💣 Security Fuzzing**: Injects 5 security attack vectors per string property:
  - **SQL Injection**: `' OR '1'='1'; DROP TABLE users; --`
  - **Path Traversal**: `../../../../etc/passwd`
  - **XSS**: `<script>alert('mcp_xss')</script>`
  - **Format String**: `%s%s%s%n%x%d`
  - **Buffer Overflow**: `50,000` character string payloads
- **📄 Resource & Prompt Testing**: Automatically discovers and tests `resources/list`, `resources/read`, `prompts/list`, and `prompts/get`.
- **🤖 GitHub Action Integration**: Ready-to-use [`action.yml`](action.yml) and workflow template for PR regression testing.
- **☁️ Cloudflare Worker Deployment**: Serverless web UI landing page and validation API deployed on Cloudflare Workers.

---

## 📦 Quick Start

### 1. Run via npx / CLI

Validate a remote HTTP/SSE MCP server:
```bash
npx tsx src/cli.ts https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp --format md
```

Validate a local stdio MCP server command:
```bash
npx tsx src/cli.ts --command "node dist/index.js" --format md
```

### 2. Standalone Build & Run

```bash
# Install & build
npm install
npm run build

# Run built CLI
npm start https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp -- --format md
```

---

## 🤖 GitHub Action Integration

Automatically validate your MCP server on every push or pull request using the built-in GitHub Action:

```yaml
name: MCP Server CI

on:
  push:
    branches: [ main, master ]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci && npm run build

      - name: Run MCP Validator
        uses: Mr-Process/mcp-validator@main
        with:
          command: "node dist/index.js"
          format: "md"
```

---

## 📖 Command Line Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `<url>` | `string` | — | HTTP/Streamable HTTP MCP server URL |
| `--command` | `string` | — | Local command to execute stdio MCP server |
| `--format` | `json` \| `md` | `json` | Report output format |
| `--timeout` | `number` | `30000` | Request timeout in milliseconds |
| `--max-tests` | `number` | — | Limit total tool test cases executed |

---

## 📊 Sample Validation Report Output

```markdown
# ⚡ MCP Server Validation Report

**Server / Command:** `https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp`
**Date:** 2026-07-30T04:59:33.730Z
**Tools Discovered:** 5
**Resources Discovered:** 0
**Prompts Discovered:** 0
**Total Tests Run:** 100

## 📊 Summary

| Status | Count |
|--------|-------|
| Pass | 100 |
| Fail | 0 |
| Crash | 0 |
| Schema Mismatch | 0 |
| Security Fuzzing Passed | 45 |

## 🛠️ Tool Validation Results

### Tool: `acp_create_job_by_name`

| Category | Description | Status | Duration | Error |
|----------|-------------|--------|----------|-------|
| valid_minimal | Only required fields with default values | pass | 103ms | |
| fuzz_sql_injection | Fuzz offeringName with SQL injection vector | pass | 95ms | |
| fuzz_overflow_string | Fuzz offeringName with Buffer Overflow (50k chars) | pass | 179ms | |
| invalid_missing_required | Missing required field: offeringName | pass | 97ms | |
| invalid_wrong_type | offeringName = number instead of string | pass | 98ms | |
```

---

## 📄 License

[MIT License](LICENSE) © 2026 Mr-Process
