# MCP Validator Execution-Safety Elevation

This change set separates **discovery** from **execution**. It avoids treating every advertised MCP capability as harmless. The validator now discovers tools, resources, and prompts by default, but it does not invoke them unless the operator opts in with a bounded budget.

## Elevation Summary

| Area | Previous behavior | Elevated behavior |
|---|---|---|
| Tool calls | All generated cases ran when no maximum was supplied. | Tool execution requires `--allow-tool-execution --max-tests <n>`. |
| Fuzzing | Fuzz payloads were sent with normal generated cases. | Fuzzing requires separate `--allow-fuzzing` consent. |
| Resources | Every discovered resource was read. | Reads require `--allow-resource-reads --max-resources <n>`. |
| Prompts | Every discovered prompt was called using generated values. | Prompt invocation requires `--allow-prompt-execution --max-prompts <n>`. |
| Stdio | A supplied command launched directly. | Local process launch requires `--allow-stdio`. |
| Bounded results | Tool/prompt responses could be retained without a report-size cap. | Each result is bounded by `--max-output-bytes`; oversized output is recorded as `output_limited`. |
| Result semantics | Policy non-execution was indistinguishable from a lack of cases. | `skipped`, `timeout`, and `output_limited` are explicit statuses in JSON, Markdown, SARIF, and JUnit exports. |

## Compatibility

`runTests()` retains compatibility with prior numeric callers: a numeric fourth argument still uses the historical active-execution semantics. Calls using the new `RunOptions` object, including the CLI, default to discovery-only mode.

This preserves a migration path for existing programmatic integrations while making command-line use safe by default. A later major release should remove the numeric overload and require explicit options everywhere.

## Validation Performed

The elevated source passed strict TypeScript compilation. The deterministic `src/runner.policy.test.ts` passed and verified that:

1. Discovery-only execution makes no tool, resource, or prompt calls.
2. An explicit one-call tool budget performs exactly one approved non-fuzz call.
3. Generated fuzz cases remain skipped without separate fuzz consent.
4. Explicit resource and prompt budgets allow only their declared calls.
5. The CLI help text exposes the discovery-only contract.

## Recommended CI Invocation

Use discovery-only validation for untrusted pull requests. Add an explicit, low-budget execution stage only for reviewed test targets whose actions are known to be read-only:

```bash
npx mcp-validate https://example.test/mcp \
  --allow-tool-execution --max-tests 5 \
  --format sarif
```

Do not run fuzzing, prompts, resource reads, or stdio commands in a shared CI environment unless the target, credentials, external effects, and budgets have been reviewed deliberately.
