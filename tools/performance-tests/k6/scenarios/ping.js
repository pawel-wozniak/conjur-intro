import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import * as conjurApi from "../modules/api.js";
import * as lib from "../modules/lib.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

/**
 * Init stage
 */
const requiredEnvVars = [
  "K6_CUSTOM_GRACEFUL_STOP",
  "K6_CUSTOM_VUS",
  "K6_CUSTOM_ITERATIONS"
];

lib.checkRequiredEnvironmentVariables(requiredEnvVars);
const env = lib.parseEnv();

export const options = {
  discardResponseBodies: true,
  scenarios: {
    individual: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "3m", target: 10 },
        { duration: "3m", target: 20 },
        { duration: "3m", target: 30 },
        { duration: "3m", target: 40 },
        { duration: "3m", target: 50 },
        { duration: "3m", target: 60 },
        { duration: "3m", target: 70 },
        { duration: "3m", target: 80 },
        { duration: "3m", target: 90 },
        { duration: "3m", target: 100 },
      ],
    },
  },
};

const stages = options.scenarios.individual.stages;

function parseDuration(str) {
  const m = str.match(/^(\d+)([smh])$/);
  if (!m) return 0;
  const v = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === "s") return v;
  if (unit === "m") return v * 60;
  if (unit === "h") return v * 3600;
  return 0;
}

const stageMeta = [];
let cumulative = 0;
for (let i = 0; i < stages.length; i++) {
  const dSec = parseDuration(stages[i].duration);
  stageMeta.push({
    index: i,
    durationSeconds: dSec,
    start: cumulative,
    end: cumulative + dSec,
    target: stages[i].target,
    raw: stages[i].duration,
  });
  cumulative += dSec;
}

// Create a Counter per stage to allow aggregation in summary.
const stageCounters = stageMeta.map(
  (s) => new Counter(`stage_${s.index}_reqs`)
);

export function setup() {
  // no-op
}

function currentStageIndex(elapsedSeconds) {
  for (const s of stageMeta) {
    if (elapsedSeconds >= s.start && elapsedSeconds < s.end) return s.index;
  }
  // If after last stage, attribute to last stage (could happen at graceful stop)
  return stageMeta.length - 1;
}

export default function () {
  // Derive elapsed time from global scenario start
  const startTime = exec.scenario.startTime; // ms
  const now = Date.now();
  const elapsedSeconds = (now - startTime) / 1000;
  const sIdx = currentStageIndex(elapsedSeconds);

  const res = conjurApi.get(http, { ...env, applianceUrl: env.applianceReadUrl }, "ping");

  stageCounters[sIdx].add(1);

  check(res, {
    "status is 200": (r) => r.status === 200,
    "status is not 404": (r) => r.status !== 404,
    "status is not 401": (r) => r.status !== 401,
    "status is not 500": (r) => r.status !== 500,
  });
}

export function handleSummary(data) {
  const lines = [];
  lines.push("");
  lines.push("Per-stage Request Rates (RPS):");
  for (const s of stageMeta) {
    const metricName = `stage_${s.index}_reqs`;
    const metric = data.metrics[metricName];
    const count = metric ? metric.values.count : 0;
    const rps = s.durationSeconds > 0 ? (count / s.durationSeconds) : 0;
    lines.push(
      `Stage ${s.index} (target=${s.target}, duration=${s.raw}): requests=${count}, rps=${rps.toFixed(2)}`
    );
  }

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }) + "\n" + lines.join("\n") + "\n",
  };
}
