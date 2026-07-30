# Contributing to MCP Validator

Thank you for your interest in contributing to **MCP Validator**!

## 🚀 Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Mr-Process/mcp-validator.git
   cd mcp-validator
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the TypeScript source:**
   ```bash
   npm run build
   ```

4. **Run local CLI tests:**
   ```bash
   npx tsx src/cli.ts https://acp-bridge-mcp.jonathonpowell.workers.dev/mcp --format md
   ```

---

## 🛠️ Pull Request Guidelines

- Ensure all TypeScript code compiles cleanly with `npm run build`.
- Add test coverage for new transport protocols or schema validation categories.
- Keep commits atomic and clearly described.
- Update `README.md` if adding CLI arguments or configuration options.
