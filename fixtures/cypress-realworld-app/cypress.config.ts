import path from "path";
import fs from "fs";
import _ from "lodash";
import axios from "axios";
import dotenv from "dotenv";
import Promise from "bluebird";
import codeCoverageTask from "@cypress/code-coverage/task";
import { defineConfig } from "cypress";
import viteConfig from "./vite.cypress.config.ts";

dotenv.config({ path: ".env.local" });
dotenv.config();

const frontendUrl = `http://localhost:${process.env.PORT ?? "3000"}`;
const backendUrl = `http://localhost:${process.env.VITE_BACKEND_PORT ?? "3001"}`;

let awsConfig = {
  default: undefined,
};

try {
  awsConfig = require(path.join(__dirname, "./aws-exports-es5.js"));
} catch (e) {}

export default defineConfig({
  projectId: "7s5okt",
  retries: {
    runMode: 2,
  },
  env: {
    defaultPassword: process.env.SEED_DEFAULT_USER_PASSWORD,
  },
  expose: {
    apiUrl: backendUrl,
    mobileViewportWidthBreakpoint: 414,
    coverage: false,
    codeCoverage: {
      url: `${backendUrl}/__coverage__`,
      exclude: "cypress/**/*.*",
    },
    paginationPageSize: process.env.PAGINATION_PAGE_SIZE,

    // Auth0
    auth0_domain: process.env.VITE_AUTH0_DOMAIN,

    // Okta
    okta_domain: process.env.VITE_OKTA_DOMAIN,
    okta_client_id: process.env.VITE_OKTA_CLIENTID,
    okta_programmatic_login: process.env.OKTA_PROGRAMMATIC_LOGIN || false,

    // Amazon Cognito
    cognito_domain: process.env.AWS_COGNITO_DOMAIN,
    cognito_programmatic_login: false,
    awsConfig: awsConfig.default,

    // Google
    googleClientId: process.env.VITE_GOOGLE_CLIENTID,
  },
  component: {
    devServer: {
      framework: "react",
      bundler: "vite",
      viteConfig,
    },
    specPattern: "src/**/*.cy.{js,jsx,ts,tsx}",
    supportFile: "cypress/support/component.ts",
    setupNodeEvents(on, config) {
      codeCoverageTask(on, config);
      return config;
    },
  },
  e2e: {
    baseUrl: frontendUrl,
    specPattern: "cypress/tests/**/*.spec.{js,jsx,ts,tsx}",
    supportFile: "cypress/support/e2e.ts",
    viewportHeight: 1000,
    viewportWidth: 1280,
    experimentalRunAllSpecs: true,
    setupNodeEvents(on, config) {
      const testDataApiEndpoint = `${config.expose.apiUrl}/testData`;
      const referenceMetrics: Array<{
        task: string;
        mode: "ui" | "webmcp_raw" | "webmcp_signet";
        durationMs: number;
        interactionCount: number;
        toolCalls: number;
        httpRequests: number;
        mutationRequests: number;
      }> = [];
      const metricsPath = path.join(__dirname, "cypress/results/reference-comparison.json");

      const writeReferenceMetrics = () => {
        if (referenceMetrics.length === 0) return;

        const latestUi = [...referenceMetrics].reverse().find(({ mode }) => mode === "ui");
        const latestRaw = [...referenceMetrics]
          .reverse()
          .find(({ mode }) => mode === "webmcp_raw");
        const latestSignet = [...referenceMetrics]
          .reverse()
          .find(({ mode }) => mode === "webmcp_signet");
        const compareToUi = (
          candidate: (typeof referenceMetrics)[number] | undefined
        ) =>
          latestUi && candidate
            ? {
                durationDeltaMs: Number((latestUi.durationMs - candidate.durationMs).toFixed(2)),
                interactionReductionPercent: Number(
                  (
                    ((latestUi.interactionCount - candidate.interactionCount) /
                      latestUi.interactionCount) *
                    100
                  ).toFixed(2)
                ),
                uiToCandidateDurationRatio: Number(
                  (latestUi.durationMs / candidate.durationMs).toFixed(2)
                ),
              }
            : null;
        const comparisons = {
          rawVsUi: compareToUi(latestRaw),
          signetVsUi: compareToUi(latestSignet),
          signetVsRaw:
            latestRaw && latestSignet
              ? {
                  durationDeltaMs: Number(
                    (latestSignet.durationMs - latestRaw.durationMs).toFixed(2)
                  ),
                  durationRatio: Number(
                    (latestSignet.durationMs / latestRaw.durationMs).toFixed(2)
                  ),
                }
              : null,
        };

        fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
        fs.writeFileSync(
          metricsPath,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              generatedAt: new Date().toISOString(),
              note: "Deterministic driver timings are directional diagnostics, not an LLM benchmark.",
              runs: referenceMetrics,
              comparisons,
            },
            null,
            2
          )}\n`
        );
      };

      const queryDatabase = ({ entity, query }, callback) => {
        const fetchData = async (attrs) => {
          const { data } = await axios.get(`${testDataApiEndpoint}/${entity}`);
          return callback(data, attrs);
        };

        return Array.isArray(query) ? Promise.map(query, fetchData) : fetchData(query);
      };

      on("task", {
        async "db:seed"() {
          // seed database with test data
          const { data } = await axios.post(`${testDataApiEndpoint}/seed`);
          return data;
        },

        "reference:record-metric"(metric) {
          referenceMetrics.push(metric);
          writeReferenceMetrics();
          return null;
        },

        // fetch test data from a database (MySQL, PostgreSQL, etc...)
        "filter:database"(queryPayload) {
          return queryDatabase(queryPayload, (data, attrs) => _.filter(data.results, attrs));
        },
        "find:database"(queryPayload) {
          return queryDatabase(queryPayload, (data, attrs) => _.find(data.results, attrs));
        },
        getAuth0Credentials() {
          const username = process.env.AUTH0_USERNAME;
          const password = process.env.AUTH0_PASSWORD;
          if (!username || !password) {
            throw new Error("AUTH0_USERNAME and AUTH0_PASSWORD must be set");
          }
          return { username, password };
        },
        getOktaCredentials() {
          const username = process.env.OKTA_USERNAME;
          const password = process.env.OKTA_PASSWORD;
          if (!username || !password) {
            throw new Error("OKTA_USERNAME and OKTA_PASSWORD must be set");
          }
          return { username, password };
        },
        getCognitoCredentials() {
          const username = process.env.AWS_COGNITO_USERNAME;
          const password = process.env.AWS_COGNITO_PASSWORD;
          if (!username || !password) {
            throw new Error("AWS_COGNITO_USERNAME and AWS_COGNITO_PASSWORD must be set");
          }
          return { username, password };
        },
        getGoogleCredentials() {
          const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
          const clientSecret = process.env.VITE_GOOGLE_CLIENT_SECRET;
          if (!refreshToken || !clientSecret) {
            throw new Error("GOOGLE_REFRESH_TOKEN and VITE_GOOGLE_CLIENT_SECRET must be set");
          }
          return { refreshToken, clientSecret };
        },
      });

      on("after:run", writeReferenceMetrics);

      codeCoverageTask(on, config);

      // Derive the auth-provider guard flags from the fully-resolved
      // config.env so every credential source is honored (CYPRESS_* vars,
      // --env, cypress.env.json), matching the prior Cypress.env() guards.
      config.expose.auth0_configured = Boolean(config.env.auth0_username);
      config.expose.okta_configured = Boolean(config.env.okta_username);
      config.expose.cognito_configured = Boolean(config.env.cognito_username);
      // Google's gate is its public client id, which already lives in expose.
      config.expose.google_configured = Boolean(config.expose.googleClientId);

      return config;
    },
  },
});
