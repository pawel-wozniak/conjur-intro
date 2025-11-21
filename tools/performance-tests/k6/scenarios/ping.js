import http from "k6/http";
import {check} from "k6";
import exec from 'k6/execution';
import {Trend, Rate} from 'k6/metrics';
import * as conjurApi from "../modules/api.js";
import * as lib from "../modules/lib.js";
import {SharedArray} from 'k6/data';
import papaparse from "../modules/papaparse.min.js";
import {htmlReport} from "https://raw.githubusercontent.com/benc-uk/k6-reporter/2.4.0/dist/bundle.js";
import {textSummary} from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import {retrieveApiKey} from "../modules/lib.js";


/**
 *  Init stage
 */
const requiredEnvVars = [
  "K6_CUSTOM_GRACEFUL_STOP",
  "K6_CUSTOM_VUS",
  "K6_CUSTOM_ITERATIONS"
];

const readSecretsIndividuallyTrend = new Trend('http_req_duration_get_secrets_individually', true);
const readSecretsIndividuallyFailRate = new Rate('http_req_failed_get_secrets_individually');

lib.checkRequiredEnvironmentVariables(requiredEnvVars);
const gracefulStop = lib.getEnvVar("K6_CUSTOM_GRACEFUL_STOP");
const vus = lib.getEnvVar("K6_CUSTOM_VUS");
const iterations = lib.getEnvVar("K6_CUSTOM_ITERATIONS");

const env = lib.parseEnv();

export const options = {
  scenarios: {
    individual: {
      executor: 'shared-iterations',
      maxDuration: "3h",
      vus: vus,
      iterations: iterations,
      gracefulStop
    },
  }, thresholds: {
    iterations: ['rate > 100'],
    checks: ['rate == 1.0']
  }
};

export function setup() {
}

export default function () {
  env.applianceUrl = env.applianceReadUrl

  const res = conjurApi.get(http, env, "ping");

  readSecretsIndividuallyTrend.add(res.timings.duration);
  readSecretsIndividuallyFailRate.add(res.status !== 200);

  check(res, {
    "status is 200": (r) => r.status === 200,
    "status is not 404": (r) => r.status !== 404,
    "status is not 401": (r) => r.status !== 401,
    "status is not 500": (r) => r.status !== 500
  });
}

export function handleSummary(data) {
  const {
    iterations: {
      values: {rate: httpReqs}
    },
    http_req_duration_get_secrets_individually: {
      values: {avg: avgResponseTime, max: maxResponseTime, min: minResponseTime}
    },
    http_req_failed: {
      values: {rate: failRate}
    },
    vus_max: {
      values: {max: vusMax}
    }
  } = data['metrics'];

  const testName = "Ping test";
  const nodeType = lib.checkNodeType(env.applianceReadUrl);

  const csv = papaparse.unparse(
    lib.generateMetricsArray(nodeType, testName, vusMax, httpReqs, avgResponseTime, maxResponseTime, minResponseTime, failRate)
  );

  return {
    "./tools/performance-tests/k6/reports/metrics.csv": csv,
    "./tools/performance-tests/k6/reports/read-individually-summary.html": htmlReport(data, {title: "Read Secrets Individually " + new Date().toISOString().slice(0, 16).replace('T', ' ')}),
    stdout: textSummary(data, {indent: " ", enableColors: true}),
  };
}
