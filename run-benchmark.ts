// run-benchmark.ts

import { writeFile, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MODELS,
  SOLVER_MODELS,
  JUDGE_MODELS,
  ORIGINAL_REQUEST,
  SOLVER_PROMPT,
  JUDGE_PROMPT_TEMPLATE,
  buildJudgePrompt,
  slugify,
} from "./benchmarkConfig.ts";

import {
  ensureDirs,
  fileExists,
  callOpenRouter,
  parseVerdict,
} from "./benchmarkUtils.ts";

// ---------- TYPES ----------

type SolutionRecord = { model: string; slug: string; html: string };

type Critique = {
  solverModel: string;
  solverSlug: string;
  judgeModel: string;
  verdict: string;
  explanation: string;
};

// ---------- LOGGING ----------

let logFilePath: string | null = null;

/**
 * Log to both console and file.
 */
async function logToFile(message: string) {
  console.log(message);
  if (logFilePath) {
    const timestamp = new Date().toISOString();
    await appendFile(logFilePath, `[${timestamp}] ${message}\n`, "utf8");
  }
}

async function logErrorToFile(message: string) {
  console.error(message);
  if (logFilePath) {
    const timestamp = new Date().toISOString();
    await appendFile(logFilePath, `[${timestamp}] ERROR: ${message}\n`, "utf8");
  }
}

async function logWarnToFile(message: string) {
  console.warn(message);
  if (logFilePath) {
    const timestamp = new Date().toISOString();
    await appendFile(
      logFilePath,
      `[${timestamp}] WARNING: ${message}\n`,
      "utf8"
    );
  }
}

// ---------- MAIN ----------

async function main() {
  await ensureDirs();

  // Set up log file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  logFilePath = join("logs", `benchmark-${timestamp}.log`);
  await writeFile(
    logFilePath,
    `=== Benchmark Run Started: ${new Date().toISOString()} ===\n\n`,
    "utf8"
  );
  await logToFile(`Logging to ${logFilePath}`);

  // Write meta.json so the website can show the request + prompts + model list
  const metaPath = join("data", "meta.json");
  const meta = {
    originalRequest: ORIGINAL_REQUEST,
    solverPrompt: SOLVER_PROMPT,
    judgePromptTemplate: JUDGE_PROMPT_TEMPLATE,
    models: MODELS,
    solverModels: SOLVER_MODELS,
    judgeModels: JUDGE_MODELS,
    lastRun: new Date().toISOString(),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  await logToFile(`Wrote meta prompt info to ${metaPath}`);

  // Load existing critiques if present (for resume)
  const critiquesPath = join("data", "critiques.json");
  let critiques: Critique[] = [];
  const donePairs = new Set<string>();

  if (await fileExists(critiquesPath)) {
    try {
      const existing = await readFile(critiquesPath, "utf8");
      const parsed = JSON.parse(existing);
      if (Array.isArray(parsed)) {
        critiques = parsed;
        for (const c of critiques) {
          if (c && c.solverModel && c.judgeModel) {
            donePairs.add(`${c.solverModel}|${c.judgeModel}`);
          }
        }
        await logToFile(
          `Loaded ${critiques.length} existing critiques; will skip those judge pairs.`
        );
      }
    } catch (err: any) {
      await logWarnToFile(
        `Could not parse existing critiques.json, starting fresh: ${
          err.message || err
        }`
      );
      critiques = [];
    }
  }

  // SOLVER PHASE
  const solverPrompt = SOLVER_PROMPT;
  const solutions: Record<string, SolutionRecord> = {};

  await logToFile("=== SOLVER PHASE (Bun) ===");
  for (let i = 0; i < SOLVER_MODELS.length; i++) {
    const model = SOLVER_MODELS[i];
    if (!model) continue;
    const slug = slugify(model);
    const outPath = join("solutions", `${slug}.html`);

    // Resume: if solution file exists and is valid, load it & skip API call
    if (await fileExists(outPath)) {
      const html = await readFile(outPath, "utf8");
      const trimmedHtml = html.trim();

      // Check if file is empty or invalid (no HTML tag)
      if (
        trimmedHtml.length === 0 ||
        !trimmedHtml.toLowerCase().includes("<html")
      ) {
        await logWarnToFile(
          `[${i + 1}/${
            SOLVER_MODELS.length
          }] Existing solution for ${model} is empty or invalid, regenerating...`
        );
        // Continue to generate new solution below
      } else {
        solutions[model] = { model, slug, html };
        await logToFile(
          `[${i + 1}/${
            SOLVER_MODELS.length
          }] Skipping ${model}, solution already exists at ${outPath}`
        );
        continue;
      }
    }

    await logToFile(
      `[${i + 1}/${
        SOLVER_MODELS.length
      }] Generating solution for ${model} -> ${outPath}`
    );

    try {
      const html = await callOpenRouter(model, solverPrompt, {
        maxTokens: 12000,
      });

      // Debug logging: show response details
      const responseLength = html.length;
      const previewLength = 500;
      const preview = html.slice(0, previewLength);
      const hasHtmlTag = html.toLowerCase().includes("<html");

      await logToFile(`Response length: ${responseLength} characters`);
      if (responseLength === 0) {
        await logErrorToFile(`Empty response from ${model}`);
        await logToFile(`Full response: ${JSON.stringify(html)}`);
      } else if (responseLength < 100) {
        await logWarnToFile(
          `Very short response (${responseLength} chars) from ${model}`
        );
        await logToFile(`Full response: ${JSON.stringify(html)}`);
      } else {
        await logToFile(`Response preview (first ${previewLength} chars):`);
        await logToFile("---");
        await logToFile(preview);
        if (responseLength > previewLength) {
          await logToFile(
            `... (${responseLength - previewLength} more characters)`
          );
        }
        await logToFile("---");
        // Also log full response to file for debugging
        if (logFilePath) {
          await appendFile(
            logFilePath,
            `\n=== FULL RESPONSE FROM ${model} ===\n${html}\n=== END RESPONSE ===\n\n`,
            "utf8"
          );
        }
      }

      if (!hasHtmlTag) {
        await logWarnToFile(
          `Solution from ${model} does not appear to contain <html> tag.`
        );
      }

      await writeFile(outPath, html, "utf8");
      solutions[model] = { model, slug, html };
    } catch (err: any) {
      await logErrorToFile(
        `Error generating solution for ${model}: ${err.message || err}`
      );
      if (logFilePath && err.stack) {
        await appendFile(logFilePath, `Stack trace:\n${err.stack}\n\n`, "utf8");
      }
    }
  }

  await logToFile("\n=== JUDGE PHASE (Bun) ===");
  const solverEntries = Object.entries(solutions);
  const totalPairs = solverEntries.length * JUDGE_MODELS.length;
  let pairIndex = 0;

  for (const [solverModel, { html, slug }] of solverEntries) {
    for (const judgeModel of JUDGE_MODELS) {
      const pairKey = `${solverModel}|${judgeModel}`;
      pairIndex++;

      // Resume: skip if already judged in critiques.json
      if (donePairs.has(pairKey)) {
        await logToFile(
          `[${pairIndex}/${totalPairs}] Skipping already-judged pair ${pairKey}`
        );
        continue;
      }

      await logToFile(
        `[${pairIndex}/${totalPairs}] Judge ${judgeModel} reviewing solution from ${solverModel}...`
      );

      try {
        const judgePrompt = buildJudgePrompt(html);
        const judgeRaw = await callOpenRouter(judgeModel, judgePrompt, {
          maxTokens: 4000,
        });
        const { verdict, explanation } = parseVerdict(judgeRaw);

        const record: Critique = {
          solverModel,
          solverSlug: slug,
          judgeModel,
          verdict,
          explanation,
        };
        critiques.push(record);
        donePairs.add(pairKey);

        // Intermediate save after each new critique
        await writeFile(
          critiquesPath,
          JSON.stringify(critiques, null, 2),
          "utf8"
        );
      } catch (err: any) {
        await logErrorToFile(
          `Error judging ${solverModel} with ${judgeModel}: ${
            err.message || err
          }`
        );
        if (logFilePath && err.stack) {
          await appendFile(
            logFilePath,
            `Stack trace:\n${err.stack}\n\n`,
            "utf8"
          );
        }
        const record: Critique = {
          solverModel,
          solverSlug: slug,
          judgeModel,
          verdict: "ERROR",
          explanation: String(err),
        };
        critiques.push(record);
        donePairs.add(pairKey);
        await writeFile(
          critiquesPath,
          JSON.stringify(critiques, null, 2),
          "utf8"
        );
      }
    }
  }

  await logToFile(
    `\nDone. Solutions in ./solutions, critiques in ${critiquesPath} (total ${critiques.length} records).`
  );
  if (logFilePath) {
    await appendFile(
      logFilePath,
      `\n=== Benchmark Run Completed: ${new Date().toISOString()} ===\n`,
      "utf8"
    );
  }
}

main().catch(async (err) => {
  await logErrorToFile(`Fatal error: ${err.message || err}`);
  if (logFilePath && err.stack) {
    await appendFile(logFilePath, `Stack trace:\n${err.stack}\n`, "utf8");
  }
  console.error(err);
  process.exit(1);
});
