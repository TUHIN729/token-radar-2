// Token Radar, round 2 — the entrypoint.
//
// Run from the repository root (Node 22 or later, standard library only):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// It reads the sealed snapshot, scores every pre-token protocol with the
// model in lib/radar.ts, and writes the graded artifact into /output (or
// MAKEFUN_OUTPUT_DIR outside the grader): board.json, data.js, dashboard/,
// screenshots/ and dossier.json. The run is deterministic: the same
// snapshot always writes the same bytes, so the grader's two runs agree.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRadar, boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** Where this file lives, so dashboard/ and screenshots/ are found beside it. */
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap and the screenshot caps the gate enforces. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_MAX = 4;
const SHOT_MAX_BYTES = 524_288;
/** A screenshot name: a letter, digit or underscore first, then plain characters. */
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read one `--flag value` or `--flag=value` argument, or the fallback. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return fallback;
}

/** Stop with a message on stderr and a non-zero exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

/**
 * Copy every regular file of one directory into another, skipping names
 * that start with a dot, and return the copied names in order.
 */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

function run(): void {
  const inputArg = flagValue('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, detail, multiples } = buildBoard(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  const radar = assembleRadar(snapshot, board, detail, multiples);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  const dashboardFiles = copyDirectory(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
  if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html', 1);
  if (!dashboardFiles.some((name) => name.endsWith('.css'))) fail('dashboard/ holds no .css file', 1);
  if (!dashboardFiles.some((name) => name.endsWith('.js'))) fail('dashboard/ holds no .js file', 1);

  const shots = copyDirectory(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3) {
    fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }

  // The dossier is written last: the scorer rebuilds it from this /output
  // and compares bytes, so it must see the finished dashboard and shots.
  const dossier = buildDossier(outDir, {
    text_max_bytes: TEXT_CAP_BYTES,
    screenshots: { max: SHOT_MAX, max_bytes: SHOT_MAX_BYTES },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  const dossierText = new TextDecoder('utf-8').decode(dossier);
  const dossierJson = JSON.parse(dossierText) as { schema?: unknown; images?: unknown[] };
  if (dossierJson.schema !== 'makefun/dossier/v1' || !Array.isArray(dossierJson.images) || dossierJson.images.length < 3) {
    fail('the dossier came back without its schema or its screenshots', 1);
  }
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const top = board[0]!;
  const total = board.reduce((sum, row) => sum + row.implied_value_usd, 0);
  process.stdout.write(
    `token-radar: ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows on the board\n` +
      `token-radar: top is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied, board total $${total.toLocaleString('en-US')}\n` +
      `token-radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
  );
}

run();
