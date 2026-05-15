/**
 * Dev-only Vite plugin: inserts a user-contribution footnote into a vault
 * markdown file when a comment is promoted to 자료 주석.
 *
 * Endpoint (POST, JSON body):
 *   /api/admin/notes/promote-md
 *     {
 *       targetFile: "people/객망리"      // 콜렉션 prefix 또는 절대 vault-상대 경로
 *                  | "places/객망리"
 *                  | "scripture/cheonjigaebyeokgyeong/01_신축편/01-01_장",
 *       anchor: "1-1-3" | null,          // 한자 sentence anchor (있으면 그 라인에 inline ref 부착)
 *       headingSlug: "명호" | null,      // 또는 heading text로 위치 지정 (anchor 미지정 시)
 *       footnoteId: "uc-2026-05-15-1",   // 호출자가 미리 결정 (collision 회피)
 *       body: "객망리는 본래 …",         // 주석 본문 (마크다운 한 줄)
 *       author: "김아무개",              // 작성자 닉네임
 *       authorDate: "2026.05.15",        // 표시용 날짜
 *       commentId: "abc123"              // 원댓글 영구 링크용
 *     }
 *
 * 동작:
 *   1) targetFile을 vault 내 .md 파일로 해석. content/<targetFile>.md
 *   2) `[^uc-...]` 중복 검사. 이미 존재하면 409.
 *   3) 파일 백업 (.bak/<ts>/<rel>)
 *   4) anchor가 주어진 경우: `^anchor` 토큰이 있는 라인을 찾아 그 토큰 직전에
 *      ` [^footnoteId]` 삽입. (sentence anchor는 한자 scripture 한정)
 *   4') anchor가 없고 headingSlug가 주어진 경우: 매칭되는 `# ...` 헤딩 라인 다음
 *       문단 끝에 ` [^footnoteId]` 추가.
 *   4'') 둘 다 없으면: 본문 마지막 비-footnote-정의 문단 끝에 추가.
 *   5) 파일 끝의 footnote 정의 블록 (`[^uc-...]: ...` 모음)에 새 정의 추가.
 *      없으면 빈 줄 + 새 블록 생성.
 *
 * 응답: { ok, footnoteId, file, lineNumber }
 */
import fs from "node:fs/promises";
import path from "node:path";

const VAULT_ROOT = process.env.VAULT_PATH || path.join(process.cwd(), "content");

const VALID_TARGET_PREFIXES = [
  "scripture/",
  "people/",
  "places/",
  "dosu/",
  "terms/",
  "dates/",
];

async function readText(p) {
  return fs.readFile(p, "utf8");
}
async function writeText(p, text) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, "utf8");
}
async function backup(p) {
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) return;
  } catch {
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(VAULT_ROOT, ".bak", ts);
  const rel = path.relative(VAULT_ROOT, p);
  const dest = rel.startsWith("..")
    ? path.join(dir, "_external", path.basename(p))
    : path.join(dir, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(p, dest);
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
function jsonRes(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function resolveTargetFile(targetFile) {
  if (!targetFile || typeof targetFile !== "string") {
    throw new Error("targetFile required");
  }
  // 절대 경로 형태로 안전 검증
  const rel = targetFile.replace(/^\/+/, "").replace(/\.md$/, "");
  const okPrefix = VALID_TARGET_PREFIXES.some((p) => rel.startsWith(p));
  if (!okPrefix) {
    throw new Error(`targetFile must start with one of: ${VALID_TARGET_PREFIXES.join(", ")}`);
  }
  const full = path.join(VAULT_ROOT, `${rel}.md`);
  // 경로 traversal 차단
  const normalized = path.normalize(full);
  if (!normalized.startsWith(VAULT_ROOT + path.sep)) {
    throw new Error("path traversal denied");
  }
  return normalized;
}

function splitFrontmatter(raw) {
  const m = raw.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/);
  if (!m) return { frontmatter: "", body: raw };
  return { frontmatter: m[1], body: m[2] ?? "" };
}

// footnote 정의 블록 (파일 끝)을 본문에서 분리.
// 정의 라인은 `[^xxx]: ...` 형식. 연속된 정의가 한 덩어리.
function splitFootnoteBlock(body) {
  const lines = body.split("\n");
  // 끝에서부터 footnote 정의 라인을 모음
  let firstDefIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (/^\s*$/.test(ln)) continue;
    if (/^\[\^[^\]]+\]:\s/.test(ln)) {
      firstDefIdx = i;
      continue;
    }
    break;
  }
  // firstDefIdx 이후를 footnote block으로 본다 (앞쪽 빈 줄 포함)
  // firstDefIdx 위 빈 줄도 분리
  while (firstDefIdx > 0 && /^\s*$/.test(lines[firstDefIdx - 1])) firstDefIdx--;
  const main = lines.slice(0, firstDefIdx).join("\n");
  const block = lines.slice(firstDefIdx).join("\n");
  return { main, block };
}

function buildFootnoteDefinition({ footnoteId, body, author, authorDate, commentId }) {
  const cleanBody = (body ?? "").trim().replace(/\s+/g, " ");
  const link = `[원댓글](/feed/comments/?id=${encodeURIComponent(commentId)})`;
  return `[^${footnoteId}]: ${cleanBody} — 사용자 ${author} (${authorDate}) ${link}`;
}

// anchor 토큰 ^X-Y-Z 가 있는 라인에서 그 토큰 직전에 ` [^id]` 삽입
function insertAtAnchor(mainBody, anchor, footnoteId) {
  const lines = mainBody.split("\n");
  const token = `^${anchor}`;
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(token);
    if (idx === -1) continue;
    // 토큰 직전에 inline ref 삽입 (공백 처리)
    const before = lines[i].slice(0, idx).replace(/\s+$/, "");
    const after = lines[i].slice(idx);
    lines[i] = `${before} [^${footnoteId}] ${after}`.replace(/\s+/g, " ").replace(/\s+$/, "");
    return { newBody: lines.join("\n"), lineNumber: i + 1 };
  }
  return null;
}

// 헤딩 slug과 부분 매칭되는 첫 `## ...` 헤딩의 직후 문단 끝에 ` [^id]` 추가
function insertUnderHeading(mainBody, headingSlug, footnoteId) {
  const lines = mainBody.split("\n");
  const needle = headingSlug.trim();
  for (let i = 0; i < lines.length; i++) {
    if (!/^#{1,6}\s/.test(lines[i])) continue;
    const text = lines[i].replace(/^#+\s+/, "").trim();
    if (!text.includes(needle)) continue;
    // 다음 비-빈줄 문단 끝 위치 찾기
    let j = i + 1;
    while (j < lines.length && /^\s*$/.test(lines[j])) j++;
    if (j >= lines.length) return null;
    // 문단 시작 j, 끝: 다음 빈 줄 또는 다음 헤딩 직전
    let end = j;
    while (end < lines.length && !/^\s*$/.test(lines[end]) && !/^#{1,6}\s/.test(lines[end])) end++;
    const last = end - 1;
    lines[last] = `${lines[last].replace(/\s+$/, "")} [^${footnoteId}]`;
    return { newBody: lines.join("\n"), lineNumber: last + 1 };
  }
  return null;
}

// 본문 마지막 일반 문단 끝에 ` [^id]` 추가
function insertAtTail(mainBody, footnoteId) {
  const lines = mainBody.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*$/.test(lines[i])) continue;
    if (/^#{1,6}\s/.test(lines[i])) continue;
    if (/^\[\^[^\]]+\]:\s/.test(lines[i])) continue;
    lines[i] = `${lines[i].replace(/\s+$/, "")} [^${footnoteId}]`;
    return { newBody: lines.join("\n"), lineNumber: i + 1 };
  }
  return null;
}

async function handlePromote(body) {
  const {
    targetFile,
    anchor,
    headingSlug,
    footnoteId,
    body: noteBody,
    author,
    authorDate,
    commentId,
  } = body || {};

  if (!footnoteId || !/^uc-\d{4}-\d{2}-\d{2}-\d+$/.test(footnoteId)) {
    throw new Error("footnoteId must match uc-YYYY-MM-DD-N");
  }
  if (!noteBody || typeof noteBody !== "string") {
    throw new Error("body required");
  }
  if (!author || !authorDate || !commentId) {
    throw new Error("author, authorDate, commentId required");
  }

  const full = resolveTargetFile(targetFile);
  const raw = await readText(full);
  if (raw.includes(`[^${footnoteId}]`)) {
    const err = new Error(`footnoteId already exists in target: ${footnoteId}`);
    err.code = 409;
    throw err;
  }
  const { frontmatter, body: rawBody } = splitFrontmatter(raw);
  const { main, block } = splitFootnoteBlock(rawBody);

  // inline ref 삽입 (위치 선택)
  let insertion = null;
  if (anchor) {
    insertion = insertAtAnchor(main, anchor, footnoteId);
  }
  if (!insertion && headingSlug) {
    insertion = insertUnderHeading(main, headingSlug, footnoteId);
  }
  if (!insertion) {
    insertion = insertAtTail(main, footnoteId);
  }
  if (!insertion) {
    throw new Error("inline reference 삽입 위치를 찾을 수 없습니다");
  }

  const definition = buildFootnoteDefinition({
    footnoteId,
    body: noteBody,
    author,
    authorDate,
    commentId,
  });

  // footnote 정의 블록 합치기 (기존 + 새)
  const newBlock = block.trim().length
    ? `${block.replace(/\n+$/, "")}\n${definition}\n`
    : `\n${definition}\n`;

  const newBody = `${insertion.newBody.replace(/\n+$/, "")}\n${newBlock}`;
  const newRaw = frontmatter ? `${frontmatter}\n${newBody}` : newBody;

  await backup(full);
  await writeText(full, newRaw.endsWith("\n") ? newRaw : `${newRaw}\n`);

  return {
    ok: true,
    file: path.relative(VAULT_ROOT, full),
    footnoteId,
    lineNumber: insertion.lineNumber,
  };
}

/** @returns {import('vite').Plugin} */
export default function notePromotionDev() {
  let viteServer = null;
  function notifyFileChange(p) {
    if (!viteServer) return;
    try {
      viteServer.watcher.emit("change", p);
    } catch {}
  }
  return {
    name: "jsbooks-note-promotion-dev",
    apply: "serve",
    configureServer(server) {
      viteServer = server;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        if (req.method !== "POST") return next();
        if (!req.url.startsWith("/api/admin/notes/promote-md")) return next();
        try {
          const body = await readBody(req);
          const out = await handlePromote(body);
          notifyFileChange(path.join(VAULT_ROOT, out.file));
          console.log(`[admin] notes/promote-md ${out.file} +${out.footnoteId} (line ${out.lineNumber})`);
          return jsonRes(res, 200, out);
        } catch (err) {
          const status = err?.code === 409 ? 409 : 400;
          return jsonRes(res, status, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
