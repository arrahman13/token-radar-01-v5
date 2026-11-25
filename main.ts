// Token Radar v5 — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), runs the admission search and the fits in lib/model.ts,
// writes the ranked board to /output/board.json, copies dashboard/ and
// screenshots/ to /output, generates the dashboard's data files beside the
// page, and writes /output/dossier.json with the kit's vendor library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// The program is deterministic: fixed seeds, no clock, no network, the same
// snapshot in gives the same bytes out. Run it twice; the outputs must match.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, boardIssue, dataScript, evidenceScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json). */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar v5: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const started = Date.now();
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = analyze(snapshot);
const issue = boardIssue(radar.board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar v5: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: radar.board })}\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// The dashboard's data is generated, not shipped: the board rows, the fitted
// model and the full search tables, so the page recomputes from the same bytes.
writeFileSync(join(out, 'dashboard', 'zz-snapshot-data.js'), dataScript(radar, snapshot));
writeFileSync(join(out, 'dashboard', 'evidence.js'), evidenceScript(radar));

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar v5: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar v5: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierCaps = { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } };
const dossierBytes = buildDossier(out, dossierCaps);
writeFileSync(join(out, 'dossier.json'), dossierBytes);

// Self-check the gate's dossier row before reporting success: rebuild the
// dossier from what was written and refuse to finish when the bytes differ.
const rebuilt = buildDossier(out, dossierCaps);
if (Buffer.compare(Buffer.from(dossierBytes), Buffer.from(rebuilt)) !== 0) {
  process.stderr.write('token radar v5: the dossier does not rebuild byte for byte from /output\n');
  process.exit(1);
}
const dossierText = JSON.parse(Buffer.from(dossierBytes).toString('utf8')).text as string;
const cutAt = dossierText.lastIndexOf('[Cut at');
const cutNote = cutAt >= 0 ? dossierText.slice(cutAt).trim() : 'no file cut: the whole dashboard source fits in the text';

const s = radar.summary;
process.stdout.write(
  `token radar v5: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${radar.board.length} rows scored\n` +
    `token radar v5: value Huber [${s.valueTerms.join(', ')}] LOO x${s.valueScores.loo.toFixed(3)} WF x${s.valueScores.wf.toFixed(3)} CV x${s.valueScores.cv.toFixed(3)} LOCO x${s.valueScores.loco.toFixed(3)}\n` +
    `token radar v5: odds logistic [${s.oddsTerms.join(', ')}] Brier CV ${s.oddsScores.cv.toFixed(4)} WF ${s.oddsScores.wf.toFixed(4)} LOCO ${s.oddsScores.loco.toFixed(4)}\n` +
    `token radar v5: conformal 80% half-width ${s.halfWidth.toFixed(3)} log units, empirical coverage ${s.coverage.toFixed(2)}, terciles ${s.terciles.map((v) => v.toFixed(2)).join('/')}\n` +
    `token radar v5: board checksum ${radar.checksum}, wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (${dashFiles.length + 2} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} in ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
    `token radar v5: dossier rebuilds byte for byte; text: ${cutNote}\n`,
);
