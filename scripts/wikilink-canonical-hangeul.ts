#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * 천지개벽경 canonical-mapping JSON 의 `hangeul` 필드에 wikilink 자동 적용.
 *
 * 본문 wikilink 정책: 한자 source(.md)에는 wikilink 박지 말고, 한글 번역에 박는다.
 * (한자는 원본 그대로 보존, 사용자 인지·검색은 한글 기준)
 *
 * 동작:
 *   1. content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json 로드
 *   2. 각 anchor.hangeul 문자열에서 카드 이름·alias 매치 찾아 [[..]] wrap
 *   3. JSON 저장
 *
 * 추가로 천지개벽경 한자 .md 의 [[X|한자]] 형식 wikilink 를 plain 한자로 되돌리는
 * 옵션도 제공 — `--revert-hanja-md` 플래그.
 *
 * 사용:
 *   node scripts/wikilink-canonical-hangeul.ts                # JSON에 적용
 *   node scripts/wikilink-canonical-hangeul.ts --revert-hanja-md  # md 도 되돌림
 *   node scripts/wikilink-canonical-hangeul.ts --dry-run
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CONTENT = join(ROOT, "content");
const CANONICAL_FILE = join(
  CONTENT,
  "scripture",
  "_mappings",
  "cheonjigaebyeokgyeong-canonical.json",
);
const CJG_DIR = join(CONTENT, "scripture", "cheonjigaebyeokgyeong");

const args = process.argv.slice(2);
const revertHanjaMd = args.includes("--revert-hanja-md");
const dryRun = args.includes("--dry-run");

type CardKind = "people" | "places" | "dosu" | "terms" | "dates";

interface CardEntry {
  kind: CardKind;
  canonical: string;
  displayLabel: string;
}

const STOPWORDS = new Set([
  "정사", "선사", "성부", "성모", "교주", "도주", "대선생",
  "신", "신명", "도", "법", "경", "교", "종교", "신앙", "기도", "치성",
  "선생", "선생님",
  "부모", "아버지", "어머니", "아들", "딸", "형제", "자매", "아내", "남편", "친구",
  "하늘", "땅", "사람", "날", "물", "불", "바람", "집", "말", "뜻",
  "일", "월", "년", "시", "분", "곳", "때", "이", "그", "저",
]);

const PARTICLES = [
  "으로부터", "으로써", "으로서", "이라서", "이므로",
  "에서", "에게", "께서", "이며", "이고", "이라",
  "으로", "로부터", "로써", "로서", "하고",
  "랑", "께", "에", "와", "과",
  "은", "는", "이", "가", "을", "를", "의", "도", "만", "로",
].sort((a, b) => b.length - a.length);
const PARTICLE_RE = new RegExp(`^(${PARTICLES.join("|")})`);
const KOREAN_CHAR = /[가-힯㄰-㆏]/;

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; bodyOffset: number } {
  if (!raw.startsWith("---\n")) return { fm: {}, bodyOffset: 0 };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { fm: {}, bodyOffset: 0 };
  const block = raw.slice(4, end);
  const after = raw.indexOf("\n", end + 4);
  const bodyOffset = after < 0 ? raw.length : after + 1;
  const fm: Record<string, unknown> = {};
  let currentArray: string[] | null = null;
  for (const line of block.split("\n")) {
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && currentArray) {
      currentArray.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    const kvMatch = line.match(/^([\w가-힣_]+):\s*(.*)$/);
    if (kvMatch) {
      const value = kvMatch[2].trim();
      if (value === "") {
        const arr: string[] = [];
        fm[kvMatch[1]] = arr;
        currentArray = arr;
      } else {
        fm[kvMatch[1]] = value.replace(/^["']|["']$/g, "");
        currentArray = null;
      }
    }
  }
  return { fm, bodyOffset };
}

function buildManifest(): Map<string, CardEntry> {
  const manifest = new Map<string, CardEntry>();
  const kinds: CardKind[] = ["people", "places", "dosu", "terms", "dates"];
  for (const kind of kinds) {
    const dir = join(CONTENT, kind);
    let files: string[];
    try {
      files = readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      const slug = f.replace(/\.md$/, "");
      const raw = readFileSync(join(dir, f), "utf8");
      const { fm } = parseFrontmatter(raw);
      const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];

      if (!manifest.has(slug)) {
        manifest.set(slug, { kind, canonical: slug, displayLabel: slug });
      }
      for (const a of aliases) {
        if (!manifest.has(a)) {
          manifest.set(a, { kind, canonical: slug, displayLabel: a });
        }
      }
      if (kind === "dates") {
        const m = slug.match(/^(.+?)-\d{4}$/);
        if (m && !manifest.has(m[1])) {
          manifest.set(m[1], { kind, canonical: slug, displayLabel: m[1] });
        }
      }
      // 한자 alias는 hangeul에 매치 안 되니까 skip (한글에는 한자가 안 나옴)
    }
  }
  return manifest;
}

function maskedPositions(text: string): Set<number> {
  const blocked = new Set<number>();
  const re = /\[\[[^\]]*\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (let i = m.index; i < m.index + m[0].length; i++) blocked.add(i);
  }
  return blocked;
}

function wrapWikilinks(text: string, keys: string[], manifest: Map<string, CardEntry>): { text: string; count: number } {
  if (!text) return { text, count: 0 };
  let modified = text;
  let count = 0;

  // 키별로 순차 처리 — 긴 키 먼저
  for (const key of keys) {
    if (!modified.includes(key)) continue;
    const blocked = maskedPositions(modified);
    let pos = 0;
    let replaced = false;
    while (pos < modified.length) {
      const idx = modified.indexOf(key, pos);
      if (idx < 0) break;
      pos = idx + 1;

      if (blocked.has(idx)) continue;
      if (idx > 0 && KOREAN_CHAR.test(modified[idx - 1])) continue;
      const after = modified.slice(idx + key.length);
      if (after.length === 0) {
        // OK
      } else if (!KOREAN_CHAR.test(after[0])) {
        // OK
      } else {
        if (!PARTICLE_RE.test(after)) continue;
      }

      const entry = manifest.get(key)!;
      const suggested =
        entry.displayLabel === entry.canonical
          ? `[[${entry.canonical}]]`
          : `[[${entry.canonical}|${entry.displayLabel}]]`;
      modified = modified.slice(0, idx) + suggested + modified.slice(idx + key.length);
      count++;
      replaced = true;
      // pos 조정: suggested 끝으로 이동
      pos = idx + suggested.length;
      // blocked map 재계산
      const newBlocked = maskedPositions(modified);
      blocked.clear();
      for (const b of newBlocked) blocked.add(b);
    }
  }
  return { text: modified, count };
}

// ─────────────────────── MAIN ───────────────────────

const manifest = buildManifest();
console.log(`Manifest: ${manifest.size} entries`);

const keys = Array.from(manifest.keys())
  .filter((k) => k.length >= 2 && !STOPWORDS.has(k))
  .sort((a, b) => b.length - a.length);

// canonical-mapping.json
const rawJson = readFileSync(CANONICAL_FILE, "utf8");
const data = JSON.parse(rawJson) as {
  version: number;
  scripture: string;
  mappings: Record<string, { hangeul: string; reviewed?: boolean; confidence?: number }>;
};

let total = 0;
let anchorsTouched = 0;
for (const [anchor, entry] of Object.entries(data.mappings)) {
  if (!entry.hangeul) continue;
  const { text, count } = wrapWikilinks(entry.hangeul, keys, manifest);
  if (count > 0) {
    entry.hangeul = text;
    total += count;
    anchorsTouched++;
  }
}
console.log(`canonical-mapping: ${anchorsTouched} anchors, ${total} wikilinks added`);

if (!dryRun) {
  writeFileSync(CANONICAL_FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`→ ${CANONICAL_FILE}`);
}

// 옵션: 한자 .md 의 [[card|한자]] 형식 → plain 한자로 되돌림
if (revertHanjaMd) {
  let revertedFiles = 0;
  let revertedLinks = 0;
  function walkRevert(dir: string) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      const s = statSync(p);
      if (s.isDirectory()) {
        walkRevert(p);
        continue;
      }
      if (!n.endsWith(".md")) continue;
      const raw = readFileSync(p, "utf8");
      // [[anything|한자]] 패턴 — display label 이 한자(CJK)면 plain text로 되돌림
      // 더 안전한 매칭: [[(card-slug)|(한자)]] where 한자 is all CJK chars
      const reverted = raw.replace(/\[\[[^\]|]+\|([一-鿿]+)\]\]/g, (_w, hanja) => {
        revertedLinks++;
        return hanja;
      });
      // single-target wikilinks where target is all CJK
      const fully = reverted.replace(/\[\[([一-鿿]+)\]\]/g, (_w, hanja) => {
        revertedLinks++;
        return hanja;
      });
      if (fully !== raw) {
        if (!dryRun) writeFileSync(p, fully);
        revertedFiles++;
      }
    }
  }
  walkRevert(CJG_DIR);
  console.log(
    `revert-hanja-md: ${revertedFiles} files, ${revertedLinks} hanja-wikilinks reverted to plain text`,
  );
}

console.log(`${dryRun ? "[DRY-RUN] " : ""}done`);
