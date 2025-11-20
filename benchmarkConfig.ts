// benchmarkConfig.ts

export const MODELS = [
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.1",
  "anthropic/claude-opus-4.1",
  "x-ai/grok-4",
  "qwen/qwen3-max",
  "openai/gpt-5.1-codex",
  "moonshotai/kimi-k2-thinking",
];

export const SOLVER_MODELS = MODELS;

export const JUDGE_MODELS = MODELS;

export const ORIGINAL_REQUEST =
  `Generate a soccer schedule with 10 teams that has exactly 8 games per team (except Team 1 and Team 2 must only have exactly 4 games and try to have them play their games within the first 7 game weeks and Team 10 must have exactly 4 games played in any match week), playing on Sundays, starting on November 23 and continuing until February 1 (no games on 12/28 and 1/4). No team plays more than once in the same week (strictly enforced). Byes are okay. Maximum of 8 games per Match Day. Team 1 and Team 2 must play each other at least once. No byes for Team 2 in the first two game weeks. Avoid repeat opponents but 2-4 instances of repeat opponents are okay. If there are repeat opponent, try not to have them play in back-to-back weeks. Output excel file with three tabs, Match List, Byes Per Week, and Team Summary. Match List tab should have separate columns for each opponent as well as 7 rows for each Match Day (leave blank rows if necessary). Byes per Week shall include a count of Byes and dates of Byes for each team. Team summary shall have 3 columns: Team, # Games Played, Opponents (in date order but don't include dates). If possible, give Team 6 a bye on 12/21 and 1/18.`.trim();

/**
 * The exact prompt we send to models as solvers.
 */
export const SOLVER_PROMPT = `
Here is a REQUEST FROM A USER:

"""
${ORIGINAL_REQUEST}
"""

YOUR TASK:

1. Produce a solution to this request in a single HTML document.
2. Include, somewhere in the HTML, an interactive verification tool that allows users to step through and validate that your solution correctly satisfies each requirement from the original request.

Constraints:

- Output ONLY a single HTML document, starting with <!DOCTYPE html> and <html> and ending with </html>.
- Do NOT include any commentary or Markdown outside the HTML.
- Within the HTML, you are free to choose any structure, tables, or layout you like, as long as a human can see your schedule and read your explanation.
`.trim();

/**
 * Template for the judge prompt; we display this on the site, and
 * we build the actual prompt by filling in the solution HTML.
 */
export const JUDGE_PROMPT_TEMPLATE = `
You are reviewing another model's solution to a scheduling task.

Here is the FULL PROMPT the solver received:

"""
${SOLVER_PROMPT}
"""

Here is ANOTHER MODEL'S SOLUTION as HTML:

\`\`\`html
{{SOLUTION_HTML_HERE}}
\`\`\`

Is this solution correct? Why or why not?

1. On the FIRST LINE, output exactly either:
   - YES
   - NO

2. After that first line, write at most 250 words explaining WHY you gave that answer.

Format:

- First non-empty line: YES or NO
- Then a blank line
- Then your explanation (<= 250 words) as plain text.
`.trim();

/**
 * Build the actual judge prompt sent to a model for a specific solution HTML.
 */
export function buildJudgePrompt(solutionHtml: string): string {
  return JUDGE_PROMPT_TEMPLATE.replace("{{SOLUTION_HTML_HERE}}", solutionHtml);
}

/**
 * Helper for filenames / URLs.
 */
export function slugify(model: string): string {
  return model.replace(/[/:]/g, "_");
}
