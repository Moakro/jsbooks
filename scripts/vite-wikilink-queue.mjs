/**
 * Dev-only Vite plugin: admin endpoints for wikilink 검수 큐.
 * Only runs in `astro dev` (apply: 'serve'); zero effect in production build.
 *
 * Endpoints (JSON):
 *   GET  /__wikilink-queue/load
 *     → { ok, queue: { generatedAt, stats, files: [{ file, slug, matches: [{ id, line, matchedText, suggested, kind, canonical, contextLine, checked }] }] } }
 *
 *   POST /__wikilink-queue/scan
 *     body: { scripture?: string }     // 없으면 --all
 *     → 큐 파일 매번 덮어쓰기 후 load 와 같은 JSON 반환
 *
 *   POST /__wikilink-queue/apply
 *     body: { ids: string[] }
 *     → 큐 파일 + 적용 대상 vault scripture 파일을 같은 .bak/<ts>/ 디렉토리에 일괄 백업한 뒤
 *       선택된 id 들의 항목만 임시 큐로 추출 → apply-wikilink-queue.ts 실행 →
 *       성공한 항목을 본 큐 markdown 에서 제거.
 *       응답: { ok, applied, skipped, reasons:{alreadyWrapped,outOfRange,other}, backupDir, removedIds, stdout, stderr }
 *     ⚠️ VAULT_PATH override(`!= cwd/content`) 환경에선 422 반환 — apply 스크립트가 cwd/content 가정.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

const REPO_ROOT = process.cwd();
const EXPECTED_VAULT = path.join(REPO_ROOT, "content");
const VAULT_ROOT = process.env.VAULT_PATH || EXPECTED_VAULT;
const QUEUE_PATH = path.join(VAULT_ROOT, "_data", "wikilink-review-queue.md");
const SCAN_SCRIPT = path.join(REPO_ROOT, "scripts", "scan-scripture-wikilinks.ts");
const APPLY_SCRIPT = path.join(REPO_ROOT, "scripts", "apply-wikilink-queue.ts");

// apply 스크립트는 process.cwd()/content/_data/... 를 하드코드하므로
// VAULT_PATH override 환경에선 admin /apply 미지원. /load·/scan 은 허용.
function vaultPathOverrideRejected() {
  return path.resolve(VAULT_ROOT) !== path.resolve(EXPECTED_VAULT);
}

/**
 * 여러 vault 파일을 같은 timestamp 디렉토리(`content/.bak/<ts>/`)에 백업.
 * canonical-mapping plugin 의 backup() 패턴을 다중 파일·단일 ts 로 확장.
 * 반환: 백업 디렉토리 절대 경로.
 */
async function backupFilesToOneDir(paths) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(VAULT_ROOT, ".bak", ts);
  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const rel = path.relative(VAULT_ROOT, p);
    const dest = rel.startsWith("..")
      ? path.join(dir, "_external", path.basename(p))
      : path.join(dir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(p, dest);
  }
  return dir;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const data = Buffer.concat(chunks).toString("utf8");
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      ["--experimental-strip-types", "--no-warnings", scriptPath, ...args],
      { cwd: REPO_ROOT, env: process.env },
    );
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

// ─── queue markdown parsing ────────────────────────────────────────────────

const FILE_HEADER_RE = /^##\s+(content\/scripture\/.+\.md)\s*$/;
const ENTRY_RE =
  /^-\s+\[([ x])\]\s+L(\d+)\s+`([^`]+)`\s+→\s+`([^`]+)`\s+\*\(([^/]+)\/([^)]+)\)\*\s*$/;
const CONTEXT_RE = /^\s+>\s+(.+)$/;
const GEN_RE = /^- 생성:\s+(.+)$/;

/** 한 줄 항목 → id 생성 (안정적이려면 file + line + matchedText + suggested 조합). */
function makeId(file, line, matchedText, suggested) {
  return `${file}|L${line}|${matchedText}|${suggested}`;
}

async function loadQueue() {
  let raw;
  try {
    raw = await fs.readFile(QUEUE_PATH, "utf8");
  } catch {
    return { generatedAt: null, stats: { total: 0 }, files: [] };
  }
  const lines = raw.split("\n");
  const files = [];
  let current = null;
  let pendingEntry = null;
  let generatedAt = null;
  const stats = { total: 0, byKind: {} };

  for (const ln of lines) {
    if (!generatedAt) {
      const g = ln.match(GEN_RE);
      if (g) generatedAt = g[1].trim();
    }
    const fm = ln.match(FILE_HEADER_RE);
    if (fm) {
      // flush pending
      if (pendingEntry && current) {
        current.matches.push(pendingEntry);
        pendingEntry = null;
      }
      const file = fm[1];
      const slug = file.match(/content\/scripture\/([^/]+)\//)?.[1] ?? "";
      current = { file, slug, matches: [] };
      files.push(current);
      continue;
    }
    const em = ln.match(ENTRY_RE);
    if (em && current) {
      if (pendingEntry) {
        current.matches.push(pendingEntry);
      }
      const [, mark, lineNum, matchedText, suggested, kind, canonical] = em;
      pendingEntry = {
        id: makeId(current.file, lineNum, matchedText, suggested),
        line: parseInt(lineNum, 10),
        matchedText,
        suggested,
        kind,
        canonical,
        contextLine: "",
        checked: mark === "x",
      };
      stats.total += 1;
      stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
      continue;
    }
    if (pendingEntry) {
      const cm = ln.match(CONTEXT_RE);
      if (cm) {
        pendingEntry.contextLine = cm[1];
        // 항목은 컨텍스트 한 줄 후 종료로 가정
        current.matches.push(pendingEntry);
        pendingEntry = null;
      }
    }
  }
  // flush trailing
  if (pendingEntry && current) current.matches.push(pendingEntry);

  return { generatedAt, stats, files };
}

/** 큐에서 주어진 id 집합과 일치하는 항목을 제거한 새 큐 markdown 작성. */
async function removeEntriesFromQueue(idSet) {
  let raw;
  try {
    raw = await fs.readFile(QUEUE_PATH, "utf8");
  } catch {
    return { removed: 0 };
  }
  const lines = raw.split("\n");
  const out = [];
  let removed = 0;
  let currentFile = null;
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const fm = ln.match(FILE_HEADER_RE);
    if (fm) {
      currentFile = fm[1];
      out.push(ln);
      i += 1;
      continue;
    }
    const em = ln.match(ENTRY_RE);
    if (em && currentFile) {
      const [, , lineNum, matchedText, suggested] = em;
      const id = makeId(currentFile, lineNum, matchedText, suggested);
      // 컨텍스트 라인 (들여쓴 >) + 빈 줄까지 함께 처리
      const nextLn = lines[i + 1] ?? "";
      const hasContext = CONTEXT_RE.test(nextLn);
      const blankLn = lines[i + (hasContext ? 2 : 1)] ?? "";
      const hasBlank = blankLn.trim() === "";
      if (idSet.has(id)) {
        removed += 1;
        const skip = 1 + (hasContext ? 1 : 0) + (hasBlank ? 1 : 0);
        i += skip;
        continue;
      }
      out.push(ln);
      if (hasContext) out.push(lines[i + 1]);
      if (hasBlank) out.push(lines[i + (hasContext ? 2 : 1)]);
      i += 1 + (hasContext ? 1 : 0) + (hasBlank ? 1 : 0);
      continue;
    }
    out.push(ln);
    i += 1;
  }
  await fs.writeFile(QUEUE_PATH, out.join("\n"), "utf8");
  return { removed };
}

/** id 집합에 해당하는 항목만 체크된 임시 큐 markdown 생성 후 경로 반환. */
async function writeTempCheckedQueue(idSet) {
  let raw;
  try {
    raw = await fs.readFile(QUEUE_PATH, "utf8");
  } catch {
    throw new Error("queue file not found");
  }
  const lines = raw.split("\n");
  const out = [];
  let currentFile = null;
  let kept = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fm = ln.match(FILE_HEADER_RE);
    if (fm) {
      currentFile = fm[1];
      out.push("");
      out.push(ln);
      out.push("");
      continue;
    }
    const em = ln.match(ENTRY_RE);
    if (em && currentFile) {
      const [, , lineNum, matchedText, suggested, kind, canonical] = em;
      const id = makeId(currentFile, lineNum, matchedText, suggested);
      if (idSet.has(id)) {
        out.push(
          `- [x] L${lineNum} \`${matchedText}\` → \`${suggested}\` *(${kind}/${canonical})*`,
        );
        // 컨텍스트 한 줄은 항상 첨부 (apply 스크립트는 안 봄)
        const nextLn = lines[i + 1] ?? "";
        if (CONTEXT_RE.test(nextLn)) out.push(nextLn);
        out.push("");
        kept += 1;
      }
    }
  }
  if (kept === 0) throw new Error("no entries matched the given ids");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wikilink-apply-"));
  const tmpPath = path.join(tmpDir, "wikilink-review-queue.md");
  // apply 스크립트는 content/_data/wikilink-review-queue.md 고정 경로를 봄.
  // 안전하게 기존 큐 백업한 후 임시 내용으로 교체 → apply 실행 → 원본 복원하는 흐름은 복잡.
  // 대신 임시 디렉토리에 동일 경로 구조를 만들고 apply 스크립트는 추가 인자 미지원.
  // → 스크립트 수정 없이 운용하려면: 본 큐 파일을 잠시 백업, 임시 내용을 본 경로에 쓴 후
  //   apply 실행 → 결과 받아 본 큐 markdown 복원 + 적용된 id 제거.
  await fs.writeFile(tmpPath, out.join("\n"), "utf8");
  return { tmpPath, kept };
}

/** apply 흐름:
 *   1) 적용 대상 vault scripture 파일 + 큐 파일 → 단일 .bak/<ts>/ 디렉토리에 일괄 백업
 *   2) 큐 파일을 임시(체크된 항목만) 내용으로 swap → apply 스크립트 실행 → 큐 원본 복원
 *   3) stdout 파싱으로 성공·실패 분류 → 성공 라인만 본 큐에서 제거
 */
async function applyCheckedEntries(idSet) {
  if (idSet.size === 0) {
    return {
      ok: true, applied: 0, skipped: 0, removedIds: [],
      stdout: "", stderr: "", reasons: { alreadyWrapped: 0, outOfRange: 0, other: 0 },
    };
  }
  const { tmpPath, kept } = await writeTempCheckedQueue(idSet);

  // 적용 대상 vault 파일 경로 집합 추출 (id 의 file 컬럼 → 절대 경로)
  const targetVaultFiles = new Set();
  for (const id of idSet) {
    const [relFile] = id.split("|");
    // 큐의 file 컬럼은 'content/scripture/...' 형식 — REPO_ROOT 기준.
    // VAULT_ROOT 가 REPO_ROOT/content 가 아닐 가능성은 사전 차단(vaultPathOverrideRejected).
    targetVaultFiles.add(path.join(REPO_ROOT, relFile));
  }

  // 큐 + 적용 대상 vault 파일을 같은 ts 디렉토리에 일괄 백업
  const backupDir = await backupFilesToOneDir([QUEUE_PATH, ...targetVaultFiles]);

  // 본 큐를 임시(체크된 것만)로 교체 → apply 스크립트 실행 → 본 큐 복원
  const originalRaw = await fs.readFile(QUEUE_PATH, "utf8");
  const tmpRaw = await fs.readFile(tmpPath, "utf8");
  await fs.writeFile(QUEUE_PATH, tmpRaw, "utf8");
  let run;
  try {
    run = await runNodeScript(APPLY_SCRIPT, []);
  } finally {
    // 원본 큐 복원
    await fs.writeFile(QUEUE_PATH, originalRaw, "utf8");
    // 임시 디렉토리 정리
    try {
      await fs.rm(path.dirname(tmpPath), { recursive: true, force: true });
    } catch {}
  }

  if (run.code !== 0) {
    return {
      ok: false,
      applied: 0,
      skipped: kept,
      removedIds: [],
      stdout: run.stdout,
      stderr: run.stderr,
      backupDir,
      reasons: { alreadyWrapped: 0, outOfRange: 0, other: kept },
    };
  }

  // stdout 파싱: "Total: N applied[, M skipped]" + 파일별 "[skip] file:line ..."
  const { applied, skipped, skippedKeys, reasons } = parseApplyStdout(run.stdout);

  // 적용 성공한 id 집합 산출: 전체 요청 id 중에서 skipped 키와 일치하지 않는 것
  const removedIds = [];
  for (const id of idSet) {
    const [file, lTag, matchedText] = id.split("|");
    const lineNum = lTag.slice(1);
    const key = `${file}:${lineNum}|${matchedText}`;
    if (!skippedKeys.has(key)) removedIds.push(id);
  }

  // 본 큐 markdown 에서 성공한 항목 라인 제거
  const removeRes = await removeEntriesFromQueue(new Set(removedIds));

  return {
    ok: true,
    applied,
    skipped,
    reasons,
    removedIds,
    removedFromQueue: removeRes.removed,
    backupDir,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}

/** apply 스크립트 stdout 에서 적용·스킵 카운트, 스킵 키 집합, 스킵 사유 분류 추출.
 *
 *  스킵 메시지(apply-wikilink-queue.ts 기준):
 *    - `  [skip] <file>:<line> "<text>" 위치 못 찾음 (이미 wikilink 됐거나 텍스트 변경됨)`
 *    - `  [skip] <file>:<line> out of range`
 */
function parseApplyStdout(stdout) {
  const totalRe = /^Total:\s+(\d+)\s+applied(?:,\s+(\d+)\s+skipped)?/m;
  const tm = stdout.match(totalRe);
  const applied = tm ? parseInt(tm[1], 10) : 0;
  const skipped = tm && tm[2] ? parseInt(tm[2], 10) : 0;
  const skipRe = /^\s*\[skip\]\s+(\S+):(\d+)\s+"([^"]+)"/gm;
  const skippedKeys = new Set();
  let m;
  while ((m = skipRe.exec(stdout))) {
    skippedKeys.add(`${m[1]}:${m[2]}|${m[3]}`);
  }
  const outOfRange = (stdout.match(/\[skip\][^\n]*out of range/g) ?? []).length;
  const alreadyWrapped = (stdout.match(/\[skip\][^\n]*위치 못 찾음/g) ?? []).length;
  const other = Math.max(0, skipped - outOfRange - alreadyWrapped);
  return { applied, skipped, skippedKeys, reasons: { alreadyWrapped, outOfRange, other } };
}

// ─── Vite plugin ────────────────────────────────────────────────────────────

/** @returns {import('vite').Plugin} */
export default function wikilinkQueueDev() {
  let viteServer = null;
  return {
    name: "jsbooks-wikilink-queue-dev",
    apply: "serve",
    configureServer(server) {
      viteServer = server;
      // 큐 파일·vault markdown 변경에 의한 full-reload 방지 — admin은 inline 갱신.
      try {
        server.watcher.unwatch([
          path.join(VAULT_ROOT, "_data", "wikilink-review-queue.md"),
        ]);
      } catch {}

      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const url = req.url.split("?")[0];
        if (req.method === "GET" && url === "/__wikilink-queue/load") {
          try {
            const queue = await loadQueue();
            return json(res, 200, { ok: true, queue });
          } catch (err) {
            return json(res, 500, { error: String(err?.message ?? err) });
          }
        }
        if (req.method === "POST" && url === "/__wikilink-queue/scan") {
          try {
            const body = await readBody(req);
            const scripture = typeof body?.scripture === "string" && body.scripture
              ? body.scripture
              : null;
            const args = scripture ? [`--scripture=${scripture}`] : ["--all"];
            const run = await runNodeScript(SCAN_SCRIPT, args);
            if (run.code !== 0) {
              return json(res, 500, {
                error: "scan script failed",
                stdout: run.stdout,
                stderr: run.stderr,
              });
            }
            const queue = await loadQueue();
            return json(res, 200, {
              ok: true,
              queue,
              stdout: run.stdout,
            });
          } catch (err) {
            return json(res, 500, { error: String(err?.message ?? err) });
          }
        }
        if (req.method === "POST" && url === "/__wikilink-queue/apply") {
          if (vaultPathOverrideRejected()) {
            return json(res, 422, {
              ok: false,
              error:
                "VAULT_PATH override 감지 — admin /apply 미지원. apply 스크립트가 cwd/content 를 가정하므로 CLI 로 직접 실행해 주세요 (pnpm tsx scripts/apply-wikilink-queue.ts).",
              vault: VAULT_ROOT,
              expected: EXPECTED_VAULT,
            });
          }
          try {
            const body = await readBody(req);
            const ids = Array.isArray(body?.ids) ? body.ids : [];
            const set = new Set(ids.filter((x) => typeof x === "string"));
            const out = await applyCheckedEntries(set);
            console.log(
              `[admin] wikilink-queue/apply requested=${ids.length} applied=${out.applied} skipped=${out.skipped} backup=${out.backupDir ?? "-"}`,
            );
            return json(res, 200, out);
          } catch (err) {
            return json(res, 500, { error: String(err?.message ?? err) });
          }
        }
        return next();
      });
    },
  };
}
