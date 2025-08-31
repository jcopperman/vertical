# 1) High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Outeniqua Test Platform                        │
├───────────────┬───────────────────┬───────────────────┬─────────────────┤
│ Dev UX & CLI  │  Test Runners     │  Observability    │  Storage & Bus  │
│ (otp CLI)     │  (API, gRPC, E2E, │  (Metrics, Logs,  │  (DB, Object,   │
│                │   Perf, Chaos)    │   Traces, Reports)│   Event Stream) │
├───────────────┼───────────────────┼───────────────────┼─────────────────┤
│ Docker Compose / Helm deploy layer; profile-able for local/CI/k8s        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key idea:** each test type is a containerized “runner” that emits events/metrics. A thin **otp** CLI orchestrates runs locally and in CI. **Grafana** is the single glass pane, backed by Prometheus/Tempo/Loki + a small “results” DB.

---

# 2) Core components

## A. Developer & CI UX

* **otp CLI** (Node or Python):

  * `otp up` / `otp down` → spins the stack via Compose (local) or Helm (CI/k8s).
  * `otp run <suite>` → runs a suite (api, grpc, contract, e2e, perf, chaos).
  * `otp report open` → opens Grafana to pre-filtered dashboards for the last run.
  * `otp seed` / `otp fixtures` → seed/reset test data.
* **Profiles**: `local`, `ci`, `k8s` via env files (`.env.local`, `.env.ci`) and Compose/Helm values.

## B. Test runners (as containers)

* **API/HTTP (sync)**: Playwright API, RestAssured, Supertest, or pytest+requests. OpenAPI-driven cases.
* **gRPC & GraphQL**: grpcurl + test harness; GraphQL introspection tests and contract assertions.
* **Async/Messaging**: Kafka/NATS assertions (consumer simulators + contract checks).
* **Contract testing**: Pact (HTTP/gRPC). Broker optional.
* **DB/system integration**: Testcontainers for Postgres/MySQL/Redis/Kafka; migration drift checks.
* **Performance**: k6 (HTTP/gRPC/WebSocket/Kafka extensions).
* **Resilience/chaos**: Toxiproxy (latency/packet loss); optional Litmus for k8s later.
* **Security (lightweight)**: ZAP baseline scan; dependency/license SCA as separate job.

Each runner:

* writes **structured logs** (JSON) → **Loki**
* emits **metrics** (pass/fail, durations, percentiles) → **Prometheus** via a tiny sidecar/exporter
* produces **spans** (test → step → HTTP call) → **OpenTelemetry** → **Tempo**
* posts **events** (start/finish/attachments) → **Results API** (see below)

## C. Observability & reporting (single dashboard)

* **Grafana**:

  * Datasources: Prometheus (metrics), Loki (logs), Tempo (traces), Postgres (results), S3/minio (artifacts).
  * Dashboards:

    * “🟢 Test Health Overview” → pass rate, flakiness, MTTR, top failing suites/cases.
    * “⏱️ Performance (k6)” → p50/p90/p99, error rate, throughput by scenario/tag.
    * “📦 Service Matrix” → services x test types (API, gRPC, async, contract).
    * “🧭 Run Explorer” → filter by commit, branch, tag, PR, environment.
    * “🔎 Trace Explorer” → link from failed case → span waterfall (Tempo).
* **Alerting** (Prometheus Alertmanager):

  * Budget breaches (e.g., <95% pass on main), perf regressions, error spikes.
  * Routes to Slack/Email.

## D. Storage & eventing

* **Postgres** (results DB): runs, suites, cases, tags, timings, links to artifacts & traces.
* **MinIO/S3**: artifacts (HARs, screenshots, videos, JSON results).
* **(Optional) NATS**: ephemeral bus for test events → results writer (keeps runners simple).

## E. Target system harness

* **Service virtualization**: WireMock/Mountebank for 3rd-party deps.
* **Local cloud**: LocalStack (AWS mocks) as needed.
* **Data seeding**: app-provided seed endpoints or migrations + fixture loaders.
* **Env switch**: run against local (compose), dev, staging (toggle via `otp run --target=staging`).

---

# 3) Repository layout (mono-repo friendly)

```
/otp
  /cli/                      # otp CLI tool
  /deploy/
    docker-compose.yml       # base
    docker-compose.local.yml # dev profile
    docker-compose.ci.yml    # CI profile (no UI)
    helm/                    # charts for k8s
  /runners/
    api/                     # pytest / Playwright API / RestAssured etc.
    grpc/
    graphql/
    async/                   # kafka/nats tests
    contract/                # pact
    perf-k6/
    chaos/
    zap/
  /harness/
    wiremock/
    toxiproxy/
    localstack/
    testcontainers/
  /obs/
    grafana/
      dashboards/*.json
      provisioning/
    prometheus/
    loki/
    tempo/
    alertmanager/
  /results-api/              # tiny service (FastAPI/Express) to ingest run metadata
  /schemas/
    openapi/ *.yaml
    pact/    Pactfiles
    grpc/    .proto
  /fixtures/
  /docs/
  .env.example
```

---

# 4) Data model for results (Postgres)

Minimal but useful:

```
run(id, started_at, finished_at, git_sha, branch, pr_id, target_env)
suite(id, run_id, name, status, duration_ms)
case(id, suite_id, name, status, duration_ms, flakiness_score, trace_id, artifact_url)
tag(case_id, key, value)  -- e.g., service=users, type=api, owner=payments
```

Why Postgres? Lets Grafana do mixed-source panels (metrics + relational joins), and enables trend analytics (flaky detection).

---

# 5) Metrics model (Prometheus)

Emit consistent labels across runners:

* `otp_test_pass_total{suite=...,type=...,service=...,env=...,branch=...}`
* `otp_test_fail_total{...}`
* `otp_test_duration_seconds_bucket{...}` (histogram for P95 etc.)
* `otp_run_info{git_sha=...,run_id=...,env=...} 1`
* k6 exports standard metrics; re-tag with test metadata via `--tag` or OTel resource attrs.

---

# 6) Traces (OpenTelemetry → Tempo)

* Start a span for **test case**; nest spans for **steps** and **I/O** (HTTP/gRPC/DB).
* Propagate tracecontext into the SUT (if instrumented) for end-to-end visibility.
* From Grafana, clicking a failed case jumps to its trace to see where latency/errors occurred.

---

# 7) Local & CI deployment

## Docker Compose (local)

* `docker-compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml up`

  * brings up: Grafana, Prometheus, Loki, Tempo, Alertmanager, Postgres, MinIO, NATS, Results API, runners (on demand).

## CI (GitHub Actions example)

```yaml
name: test
on: [push, pull_request]
jobs:
  otp:
    runs-on: ubuntu-latest
    services:
      docker: { image: docker:dind }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Start core stack (headless)
        run: docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.ci.yml up -d prom grafana loki tempo postgres minio results-api
      - name: Run API + Contract + Perf
        run: |
          otp run api --target=staging --tags "owner=payments"
          otp run contract
          otp run perf-k6 --vus 20 --duration 2m
      - name: Publish artifacts
        if: always()
        run: otp report publish --run-id $GITHUB_RUN_ID
```

**Notes**

* CI profile avoids browsers/GUI; Playwright can run headless if needed.
* Outputs always uploaded to MinIO + linked in DB, so Grafana is the single landing page after CI.

---

# 8) Example dashboard tiles (Grafana)

* **Run summary** (Postgres): table of latest runs (status, pass%, duration, commit).
* **Pass/Fail over time** (Prometheus): stacked bar by suite over last 14 days.
* **Top flaky tests** (Postgres query using last N runs).
* **Perf trends** (k6 → Prometheus): p95 latency per endpoint by branch.
* **Hot paths** (Tempo): service map filtered to a run’s trace IDs.
* **Logs** (Loki): failed cases’ logs grouped by suite with grep for error signatures.

---

# 9) Test coverage matrix

| Area            | Tooling                           | Notes                                  |
| --------------- | --------------------------------- | -------------------------------------- |
| API/HTTP        | pytest/Playwright API/RestAssured | Schema-driven; golden assertions.      |
| gRPC            | grpcurl + harness                 | Proto contracts; reflection tests.     |
| GraphQL         | GQL introspection + scenarios     | Query/Mutation coverage & cost limits. |
| Async           | Kafka/NATS consumers/producers    | Contract, idempotency, DLQ checks.     |
| Contract        | Pact (provider/consumer)          | Broker optional.                       |
| DB              | Testcontainers + migration check  | Drift detection; seed/rollback.        |
| Performance     | k6                                | SLIs/SLOs via Prom.                    |
| Resilience      | Toxiproxy/Litmus                  | Latency/packet loss; pod kill in k8s.  |
| Security (lite) | ZAP baseline                      | Quick OWASP sanity in CI.              |

---

# 10) Developer ergonomics

* **One command start**: `otp up` → stack ready in <60s on dev laptop.
* **Self-contained runners**: each with a `Dockerfile` + `Makefile` (`make test`, `make dev`).
* **Fixtures**: fast factories; deterministic seeds; snapshot testing where helpful.
* **Service contracts**: OpenAPI & Protos kept under `/schemas`; PRs validate contracts.
* **Secrets**: Doppler/SOPS/age or GitHub OIDC → vault; no secrets in repo.
* **Languages**: runners can be polyglot; standardize the *interface* (logs/metrics/traces/events).

---

# 11) Security & governance

* **SBOM** for runner images (Syft) + vuln scan (Grype) in CI.
* **Policy**: block merges if pass% < threshold or contract tests fail on protected branches.
* **Data**: scrub PII in logs (Loki pipeline stages); anonymize prod data used in tests.

---

# 12) Scale to k8s later

* Package stack as **Helm charts**; set resource limits for heavy runners (k6).
* Use **HorizontalPodAutoscaler** for results API and broker if needed.
* Use **Tempo distributed** and **Loki microservices** if volumes grow.
* Integrate with **Argo Workflows** or **Tekton** if you want test plans as DAGs.

---

# 13) Quick start (practical path)

1. Scaffold repo as above; implement **otp CLI** minimal commands.
2. Stand up **Grafana + Prometheus + Loki + Tempo + Postgres + MinIO** via Compose.
3. Build **API runner** (pytest) that:

   * pushes metrics to Prom (simple custom exporter or pytest-prometheus),
   * logs JSON to stdout (collected by Promtail),
   * creates OTel spans via `opentelemetry-sdk`.
4. Add **Results API** (FastAPI) with `/runs` & `/cases` endpoints and Grafana Postgres datasource.
5. Add **k6** perf runner; wire into same metadata/labels.
6. Create the **Test Health** and **Run Explorer** dashboards.
7. Wire a basic **GitHub Actions** workflow that runs API + k6 and posts artifacts.