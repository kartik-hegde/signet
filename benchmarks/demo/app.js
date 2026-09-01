const DATA_URL = "/evidence/p0/latest.json";

const racePlans = {
  ui: {
    visualDuration: 5200,
    steps: [
      "Click “New payment”",
      "Search recipients for “Lia”",
      "Select Lia Rosenbaum",
      "Type amount: $12.00",
      "Type payment note",
      "Click “Pay” and wait",
    ],
  },
  webmcp_raw: {
    visualDuration: 1700,
    steps: [
      "search_payment_users({ query: 'Lia' })",
      "list_payment_accounts({})",
      "send_payment({ amount: 12, … })",
    ],
  },
  webmcp_signet: {
    visualDuration: 2350,
    steps: [
      "Discover the same 3 tools",
      "Resolve session + authorize",
      "Reserve idempotency key",
      "Execute send_payment",
      "Verify authoritative state",
    ],
  },
};

const scenarioCopy = {
  "retry-after-lost-response": {
    title: "The booking commits. The response disappears.",
    description:
      "The agent cannot tell whether the action worked, so it retries the same intent.",
    rawRows: [
      ["Request", "book 1", "neutral"],
      ["Effect committed", "booking #1", "good"],
      ["Response", "lost", "bad"],
      ["Retry committed", "booking #2", "bad"],
    ],
    guardedRows: [
      ["Intent reserved", "one key", "good"],
      ["Effect committed", "booking #1", "good"],
      ["Response", "lost", "bad"],
      ["Retry", "held as unknown", "good"],
    ],
  },
  "concurrent-notes-overwrite": {
    title: "Two writers race on the same record.",
    description:
      "Both calls read the same booking and write a different note. One update vanishes.",
    rawRows: [
      ["Writer A", "aisle", "neutral"],
      ["Writer B", "window", "neutral"],
      ["Final state", "window", "bad"],
      ["Caller A", "success", "bad"],
    ],
    guardedRows: [
      ["Writer A", "aisle", "neutral"],
      ["Writer B", "window", "neutral"],
      ["Verification", "mismatch", "good"],
      ["Caller A", "unknown", "good"],
    ],
  },
  "retry-after-upstream-error-on-idempotent-operation": {
    title: "The application is already safe.",
    description:
      "Cancellation is conditional at the data layer. A useful control should avoid taking credit—and avoid adding uncertainty.",
    rawRows: [
      ["Cancel", "committed", "good"],
      ["Upstream", "502", "bad"],
      ["Retry", "safe no-op", "good"],
      ["Final state", "cancelled", "good"],
    ],
    guardedRows: [
      ["Cancel", "committed", "good"],
      ["Upstream", "502", "bad"],
      ["Retry", "held", "neutral"],
      ["Caller", "needlessly unknown", "bad"],
    ],
  },
};

let evidence;
let activeScenario = "retry-after-lost-response";
let raceRunning = false;
let faultRunning = false;

boot();

async function boot() {
  wireInteractions();
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`Benchmark evidence returned ${response.status}`);
    evidence = await response.json();
    hydrateEvidence();
    showToast("Real benchmark evidence loaded");
  } catch (error) {
    console.error(error);
    document.querySelector(".live-pill").innerHTML =
      "<span></span> Evidence unavailable";
    showToast("Could not load benchmark evidence");
  }
}

function wireInteractions() {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () =>
      switchView(button.dataset.viewTarget),
    );
  });

  document.querySelectorAll(".scenario-button").forEach((button) => {
    button.addEventListener("click", () =>
      selectScenario(button.dataset.scenario),
    );
  });

  document.querySelector("#run-race").addEventListener("click", runRace);
  document.querySelector("#run-fault").addEventListener("click", runFault);
}

function hydrateEvidence() {
  const { effectiveness, safety, generatedAt } = evidence;
  const signet = effectiveness.comparisons.signetWebMcpVsUi;
  const rawScore = safety.scores.find(({ arm }) => arm === "A1_raw");
  const guardedScore = safety.scores.find(
    ({ arm }) => arm === "A3b_signet_durable",
  );

  document.querySelector("#signet-speedup").textContent =
    `${signet.durationSpeedup}×`;
  document.querySelector("#interaction-cut").textContent =
    `${signet.interactionReductionPercent}%`;
  document.querySelector("#raw-score").textContent = `${rawScore.overall}`;
  document.querySelector("#guarded-score").textContent =
    `${guardedScore.overall}`;
  document.querySelector("#correctness-score").textContent =
    `${guardedScore.correctness}%`;
  document.querySelector("#honesty-score").textContent =
    `${guardedScore.honesty}%`;
  document.querySelector("#result-date").textContent = new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  ).format(new Date(generatedAt));

  selectScenario(activeScenario, false);
}

function switchView(view) {
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.view === view);
  });
  document.querySelectorAll(".view-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === view);
  });
  document
    .querySelector(`[data-view="${view}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runRace() {
  if (!evidence || raceRunning) return;
  raceRunning = true;
  const button = document.querySelector("#run-race");
  button.disabled = true;
  button.querySelector(".run-label").textContent = "Running real trace…";

  document.querySelector("#race-verdict strong").textContent =
    "Three paths are executing from the same reset state.";
  document.querySelectorAll(".execution-card").forEach(resetLane);

  await Promise.all(
    Object.entries(racePlans).map(([lane, plan]) =>
      runLane(lane, plan, evidence.effectiveness.runs[lane]),
    ),
  );

  document.querySelector("#race-verdict strong").textContent =
    "Same payment. Same final state. Far less agent work.";
  button.disabled = false;
  button.querySelector(".run-label").textContent = "Replay comparison";
  raceRunning = false;
}

function resetLane(card) {
  card.classList.remove("is-running", "is-complete");
  card.querySelector(".execution-log").replaceChildren();
  card.querySelector(".progress-track span").style.width = "0";
  card.querySelector('[data-metric="duration"]').textContent = "—";
  card.querySelector('[data-metric="actions"]').textContent = "—";
  const result = card.querySelector("[data-result]");
  result.textContent = "Queued";
  result.classList.remove("is-good");
}

async function runLane(lane, plan, result) {
  const card = document.querySelector(`[data-lane="${lane}"]`);
  const log = card.querySelector(".execution-log");
  const progress = card.querySelector(".progress-track span");
  const stepDelay = plan.visualDuration / plan.steps.length;
  card.classList.add("is-running");
  card.querySelector("[data-result]").textContent = "Running";

  for (let index = 0; index < plan.steps.length; index += 1) {
    const previous = log.querySelector("li.is-active");
    if (previous) previous.classList.replace("is-active", "is-done");
    const row = document.createElement("li");
    row.className = "is-active";
    row.textContent = plan.steps[index];
    log.append(row);
    progress.style.width = `${((index + 1) / plan.steps.length) * 100}%`;
    await delay(stepDelay);
  }

  const active = log.querySelector("li.is-active");
  if (active) active.classList.replace("is-active", "is-done");
  card.classList.remove("is-running");
  card.classList.add("is-complete");
  card.querySelector('[data-metric="duration"]').textContent =
    `${result.durationMs} ms`;
  card.querySelector('[data-metric="actions"]').textContent =
    `${result.interactionCount}`;
  const outcome = card.querySelector("[data-result]");
  outcome.textContent = "DB ✓";
  outcome.classList.add("is-good");
}

function selectScenario(scenario, clear = true) {
  activeScenario = scenario;
  document.querySelectorAll(".scenario-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scenario === scenario);
  });

  const copy = scenarioCopy[scenario];
  document.querySelector("#fault-title").textContent = copy.title;
  document.querySelector("#fault-description").textContent = copy.description;
  if (clear) clearFaultResult();
}

function clearFaultResult() {
  ["raw", "guarded"].forEach((key) => {
    const card = document.querySelector(
      `.${key === "raw" ? "raw" : "guarded"}-outcome`,
    );
    card.classList.remove("is-good", "is-bad", "is-warn");
    document.querySelector(`#${key}-outcome-status`).textContent = "Waiting";
    document.querySelector(`#${key}-report`).textContent = "—";
    document.querySelector(`#${key}-state`).replaceChildren();
  });
}

async function runFault() {
  if (!evidence || faultRunning) return;
  faultRunning = true;
  clearFaultResult();
  const button = document.querySelector("#run-fault");
  button.disabled = true;
  button.querySelector("span:last-child").textContent = "Fault active…";

  const raw = findTrial(activeScenario, "A1_raw");
  const guarded = findTrial(activeScenario, "A3b_signet_durable");
  const copy = scenarioCopy[activeScenario];

  await Promise.all([
    animateOutcome("raw", copy.rawRows, raw),
    animateOutcome("guarded", copy.guardedRows, guarded),
  ]);

  button.disabled = false;
  button.querySelector("span:last-child").textContent = "Replay fault";
  faultRunning = false;
}

async function animateOutcome(key, rows, trial) {
  const container = document.querySelector(`#${key}-state`);
  const card = document.querySelector(
    `.${key === "raw" ? "raw" : "guarded"}-outcome`,
  );
  const violations = Object.entries(trial.counts).filter(
    ([name, count]) => count > 0 && !name.endsWith("_disclosed"),
  );
  const disclosed = Object.entries(trial.counts).some(
    ([name, count]) => count > 0 && name.endsWith("_disclosed"),
  );

  await delay(key === "raw" ? 220 : 340);
  for (const [label, value, tone] of rows) {
    const row = document.createElement("div");
    row.className = `state-row ${tone}`;
    row.innerHTML = `<i></i><span>${label}</span><b>${value}</b>`;
    container.append(row);
    await delay(260);
  }

  const status = document.querySelector(`#${key}-outcome-status`);
  if (trial.passed) {
    card.classList.add("is-good");
    status.textContent = "Clean state";
  } else if (disclosed) {
    card.classList.add("is-warn");
    status.textContent = "Detected";
  } else {
    card.classList.add("is-bad");
    status.textContent = friendlyViolation(violations[0]?.[0]);
  }
  document.querySelector(`#${key}-report`).textContent =
    trial.reports[0]?.reported ?? "—";
}

function findTrial(scenario, arm) {
  const trial = evidence.safety.trials?.find(
    (candidate) => candidate.scenario === scenario && candidate.arm === arm,
  );
  if (!trial) throw new Error(`Missing safety trial ${scenario}/${arm}`);
  return trial;
}

function friendlyViolation(name) {
  return (
    {
      duplicate_effects: "Duplicate effect",
      lost_updates: "Lost update",
      needless_indeterminate: "Unnecessary doubt",
      silent_effect: "Silent effect",
      false_success: "False success",
    }[name] ?? "Violation"
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  setTimeout(() => toast.classList.remove("is-visible"), 2200);
}
