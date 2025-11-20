// run-benchmark.ts

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MODELS,
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

// ---------- MAIN ----------

async function main() {
  await ensureDirs();

  // Write meta.json so the website can show the request + prompts + model list
  const metaPath = join("data", "meta.json");
  const meta = {
    originalRequest: ORIGINAL_REQUEST,
    solverPrompt: SOLVER_PROMPT,
    judgePromptTemplate: JUDGE_PROMPT_TEMPLATE,
    models: MODELS,
    lastRun: new Date().toISOString(),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  console.log(`Wrote meta prompt info to ${metaPath}`);

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
        console.log(
          `Loaded ${critiques.length} existing critiques; will skip those judge pairs.`
        );
      }
    } catch (err: any) {
      console.warn(
        "Could not parse existing critiques.json, starting fresh:",
        err.message || err
      );
      critiques = [];
    }
  }

  // SOLVER PHASE
  const solverPrompt = SOLVER_PROMPT;
  const solutions: Record<string, SolutionRecord> = {};

  console.log("=== SOLVER PHASE (Bun) ===");
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    if (!model) continue;
    const slug = slugify(model);
    const outPath = join("solutions", `${slug}.html`);

    // Resume: if solution file exists, load it & skip API call
    if (await fileExists(outPath)) {
      const html = await readFile(outPath, "utf8");
      solutions[model] = { model, slug, html };
      console.log(
        `[${i + 1}/${
          MODELS.length
        }] Skipping ${model}, solution already exists at ${outPath}`
      );
      continue;
    }

    console.log(
      `[${i + 1}/${
        MODELS.length
      }] Generating solution for ${model} -> ${outPath}`
    );

    try {
      const html = await callOpenRouter(model, solverPrompt);
      if (!html.toLowerCase().includes("<html")) {
        console.warn(
          `Warning: solution from ${model} does not appear to contain <html> tag.`
        );
      }
      await writeFile(outPath, html, "utf8");
      solutions[model] = { model, slug, html };
    } catch (err: any) {
      console.error(
        `Error generating solution for ${model}:`,
        err.message || err
      );
    }
  }

  console.log("\n=== JUDGE PHASE (Bun) ===");
  const solverEntries = Object.entries(solutions);
  const totalPairs = solverEntries.length * MODELS.length;
  let pairIndex = 0;

  for (const [solverModel, { html, slug }] of solverEntries) {
    for (const judgeModel of MODELS) {
      const pairKey = `${solverModel}|${judgeModel}`;
      pairIndex++;

      // Resume: skip if already judged in critiques.json
      if (donePairs.has(pairKey)) {
        console.log(
          `[${pairIndex}/${totalPairs}] Skipping already-judged pair ${pairKey}`
        );
        continue;
      }

      console.log(
        `[${pairIndex}/${totalPairs}] Judge ${judgeModel} reviewing solution from ${solverModel}...`
      );

      try {
        const judgePrompt = buildJudgePrompt(html);
        const judgeRaw = await callOpenRouter(judgeModel, judgePrompt);
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
        console.error(
          `Error judging ${solverModel} with ${judgeModel}:`,
          err.message || err
        );
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

  console.log(
    `\nDone. Solutions in ./solutions, critiques in ${critiquesPath} (total ${critiques.length} records).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
