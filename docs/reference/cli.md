# `signett` CLI

The flagship `signett` package installs the `signett` executable for headless agent
testing, portable evaluation suites, and baseline regression checks.

```sh
npm install signett
npx signett --help
```

## `signett agent`

Run a natural-language task against the exact WebMCP tools exposed by a page.

```text
signett agent [suite.mjs] [options]
```

| Option               | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `--config path`      | JavaScript module or JSON agent suite; equivalent to the positional path. |
| `--task id`          | Run only the saved task with this ID.                                     |
| `--trials n`         | Run each selected task `n` times; defaults to `1`.                        |
| `--url URL`          | Page URL for an ad-hoc run. Requires `--prompt`.                          |
| `--prompt text`      | Natural-language task for an ad-hoc run. Requires `--url`.                |
| `--endpoint URL`     | Chat Completions-compatible model endpoint.                               |
| `--model name`       | Model identifier sent to the endpoint.                                    |
| `--api-key-env name` | Environment variable containing the provider key; default is              |
|                      | `SIGNETT_AGENT_API_KEY`.                                                  |
| `--output path`      | Evidence JSON file for one Trial or directory for multiple Trials.        |
| `--list`             | Print selected task IDs without opening a browser.                        |
| `-h`, `--help`       | Show command help.                                                        |

CLI provider values override values saved in the suite. The API key is read from the
selected environment variable. Signett sends it as a bearer token when it is present
and does not write it to Evidence.

### Agent suite shape

Use `defineAgentTestSuite()` from `signett/agent` to validate a JavaScript suite.
JSON suites can describe tasks and provider settings but cannot implement lifecycle
or oracle functions.

| Field or hook                    | Purpose                                                             |
| -------------------------------- | ------------------------------------------------------------------- |
| `schemaVersion`                  | Must be `1`.                                                        |
| `id`                             | Stable lower-kebab-case suite ID.                                   |
| `provider`                       | Optional `endpoint`, `model`, and `apiKeyEnv` defaults.             |
| `application.id`                 | Stable application ID.                                              |
| `application.url`                | Page URL or function returning it.                                  |
| `application.browser`            | Headless-browser options such as `chromePath` or extra Chrome args. |
| `application.prepare()`          | Start or provision dependencies before each Trial.                  |
| `application.reset()`            | Restore authoritative state before each Trial.                      |
| `application.snapshot()`         | Capture application state before and after the agent run.           |
| `application.establishSession()` | Establish fresh-profile authentication after opening the page.      |
| `application.runtimeEvidence()`  | Collect application-owned runtime evidence.                         |
| `application.grade()`            | Return the authoritative and safe-success grade.                    |
| `application.cleanup()`          | Release Trial resources even after a failed Trial.                  |
| `application.recordPayloads`     | Opt into recording tool arguments/results; defaults to `false`.     |
| `tasks`                          | One or more saved prompts, expectations, and budgets.               |
| `provenance`                     | Application-owned version or environment metadata.                  |
| `createComplete()`               | Optional custom model-completion adapter.                           |

A task may require or forbid tool names and set `maxToolErrors`. Its budgets can limit
total time, per-tool time, model steps, tool calls, and retained result characters.
Defaults are 120 seconds, 45 seconds per tool, 8 model steps, 32 calls, and 20,000
result characters.

Each Trial uses a fresh browser profile. By default, Evidence includes tool names and
event metadata but redacts tool arguments and results. Prefer an application-owned
oracle for consequential jobs; the fallback interface grade is not authoritative.

## `signett eval`

Run a portable evaluation definition with Cases, conditions, adapters, and an oracle.

```text
signett eval [evaluation.mjs] [options]
```

| Option                    | Meaning                                             |
| ------------------------- | --------------------------------------------------- |
| `--case id[,id]`          | Select Cases.                                       |
| `--condition id[,id]`     | Select conditions.                                  |
| `--trials n`              | Trials per Case and condition; defaults to `5`.     |
| `--baseline id`           | Condition used as the report baseline.              |
| `--output path`           | Evidence and report output directory.               |
| `--against report.json`   | Compare the new report with a reviewed baseline.    |
| `--max-safe-regression n` | Allowed safe-success decrease from `0` through `1`. |
| `--max-duration-ratio n`  | Optional duration regression ratio.                 |
| `--max-token-ratio n`     | Optional token regression ratio.                    |
| `--list`                  | Print selected Cases and conditions.                |
| `--dry-run`               | Print the schedule without running Trials.          |
| `-h`, `--help`            | Show command help.                                  |

## `signett check`

Compare an existing candidate report with a reviewed baseline without rerunning Trials.

```text
signett check candidate/report.json --against baseline/report.json [options]
```

`--against` is required. The command also accepts `--output`,
`--max-safe-regression`, `--max-duration-ratio`, and `--max-token-ratio`. It writes
`check.json` and `check.md`, prints the reasons for any regression, and exits
unsuccessfully when the policy fails.

Continue with the [headless agent codelab](../tutorials/headless-agent-testing) or the
[authenticated evaluation codelab](../guide/real-browser-example).
