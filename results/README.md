# Results policy

Commit reviewed aggregate reports and benchmark cards here. Raw run artifacts belong
under `results/raw/` and remain ignored until they have been checked for credentials,
cookies, authorization headers, personal data, and model-provider restrictions.

Every published result must identify:

- benchmark, application, task-set, evaluator, and Signet revisions;
- exact model and parameters;
- browser, action-set, observation, and WebMCP driver versions;
- trial count, condition order, timeout, and step budget;
- task success and safe task success with confidence intervals;
- time, actions, tokens, cost, retries, and incomplete runs;
- all exclusions and evaluator changes;
- enough commands and configuration for an external reproduction.

Do not publish only a blended score. A headline may summarize a primary preregistered
metric, but the component outcomes and uncertainty must remain visible.

Reviewed aggregates currently live in `p0/`, `p1/`, `test-agent/`,
`build-vs-buy/`, and `evidence/`. Per-agent event streams, browser traces,
screenshots, and logs remain under the ignored `raw/` tree.
