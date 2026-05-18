#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * 경전 본문에서 카드(인물·장소·도수·용어·시기) 이름·alias 매치를 찾아
 * wikilink 후보를 `content/_data/wikilink-review-queue.md` 로 출력.
 *
 * 사용:
 *   node scripts/scan-scripture-wikilinks.ts --scripture hwaeundang-silgi
 *   node scripts/scan-scripture-wikilinks.ts --all
 *
 * 검수자가 큐 markdown 의 체크박스를 `- [x]` 로 표시한 항목은 후속
 * `apply-wikilink-queue.ts`(미구현) 가 본문에 wikilink 박는다.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const CONTENT = join(ROOT, "content");
const SCRIPTURE_DIR = join(CONTENT, "scripture");
const OUT_FILE = join(CONTENT, "_data", "wikilink-review-queue.md");

const args = process.argv.slice(2);
const scriptureFilter = args
  .find((a) => a.startsWith("--scripture="))
  ?.slice("--scripture=".length);
const scanAll = args.includes("--all");

if (!scriptureFilter && !scanAll) {
  console.error(
    "usage: scan-scripture-wikilinks.ts --scripture=<slug> | --all",
  );
  process.exit(1);
}

type CardKind = "people" | "places" | "dosu" | "terms" | "dates";

interface CardEntry {
  kind: CardKind;
  canonical: string;
  displayLabel: string;
}

// 직책·일반어·관계어 — 카드 alias 와 매치돼도 자동 후보 ✗.
// 추가 필요한 단어는 여기에 채워가며 정밀도 올림.
const STOPWORDS = new Set([
  // 직책/지위
  "정사",
  "선사",
  "성부",
  "성모",
  "교주",
  "도주",
  "대선생",
  // 종교 일반어
  "신",
  "신명",
  "도",
  "법",
  "경",
  "교",
  "종교",
  "신앙",
  "기도",
  "치성",
  "선생",
  "선생님",
  // 가족
  "부모",
  "아버지",
  "어머니",
  "아들",
  "딸",
  "형제",
  "자매",
  "아내",
  "남편",
  "친구",
  // 일상 명사
  "하늘",
  "땅",
  "사람",
  "날",
  "물",
  "불",
  "바람",
  "집",
  "말",
  "뜻",
  // 단음절 (대부분 일반어)
  "일",
  "월",
  "년",
  "시",
  "분",
  "곳",
  "때",
  "이",
  "그",
  "저",
]);

// 한국어 조사 — 매치 직후 등장 시 단어 경계로 인정.
// 길이 DESC 정렬해서 긴 것부터 시도(예: '으로써' > '으로' > '로').
const PARTICLES = [
  "으로부터",
  "으로써",
  "으로서",
  "이라서",
  "이므로",
  "에서",
  "에게",
  "께서",
  "이며",
  "이고",
  "이라",
  "으로",
  "로부터",
  "로써",
  "로서",
  "하고",
  "랑",
  "께",
  "에",
  "와",
  "과",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "도",
  "만",
  "로",
].sort((a, b) => b.length - a.length);
const PARTICLE_PAT = PARTICLES.join("|");
const PARTICLE_RE = new RegExp(`^(${PARTICLE_PAT})`);

// 한글 음절·자모 (단어 경계 판정용)
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
  let currentKey = "";
  for (const line of block.split("\n")) {
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && currentArray) {
      currentArray.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    const kvMatch = line.match(/^([\w가-힣_]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "") {
        const arr: string[] = [];
        fm[currentKey] = arr;
        currentArray = arr;
      } else {
        fm[currentKey] = value.replace(/^["']|["']$/g, "");
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
      // dates: 신축년-1901 → 신축년 alias 자동
      if (kind === "dates") {
        const m = slug.match(/^(.+?)-\d{4}$/);
        if (m && !manifest.has(m[1])) {
          manifest.set(m[1], { kind, canonical: slug, displayLabel: m[1] });
        }
      }

      // 한자 alias (name_hanja / 호_한자) — 한자 본문 매칭용
      const nameHanja = (fm.name_hanja ?? fm["호_한자"]) as string | undefined;
      if (typeof nameHanja === "string" && nameHanja && !manifest.has(nameHanja)) {
        manifest.set(nameHanja, { kind, canonical: slug, displayLabel: nameHanja });
      }
    }
  }
  return manifest;
}

function walkMarkdown(dir: string, out: string[]) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) walkMarkdown(p, out);
    else if (n.endsWith(".md")) out.push(p);
  }
}

function findScriptureFiles(filter?: string): string[] {
  const out: string[] = [];
  for (const slug of readdirSync(SCRIPTURE_DIR)) {
    if (slug.startsWith("_")) continue;
    const dir = join(SCRIPTURE_DIR, slug);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (filter && slug !== filter) continue;
    walkMarkdown(dir, out);
  }
  return out;
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

interface Match {
  file: string;
  line: number;
  matchedText: string;
  card: CardEntry;
  contextLine: string;
  suggested: string;
}

function scanFile(filePath: string, manifest: Map<string, CardEntry>): Match[] {
  const raw = readFileSync(filePath, "utf8");
  const { bodyOffset } = parseFrontmatter(raw);
  const body = raw.slice(bodyOffset);

  // 절대 라인 번호 = frontmatter 라인 수 + body 내 라인
  const fmLines = raw.slice(0, bodyOffset).split("\n").length - 1;
  const lines = body.split("\n");

  // 매니페스트 키 정렬 — 긴 것부터 (compound 우선)
  const keys = Array.from(manifest.keys())
    .filter((k) => k.length >= 2 && !STOPWORDS.has(k))
    .sort((a, b) => b.length - a.length);

  const matches: Match[] = [];

  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    // 헤더·인용·코드 라인은 본문 의도 아님 — skip
    if (/^(#{1,6}\s|>\s|\s*```)/.test(line)) return;

    const blocked = maskedPositions(line);

    for (const key of keys) {
      let pos = 0;
      while ((pos = line.indexOf(key, pos)) >= 0) {
        const startPos = pos;
        pos = startPos + 1; // 다음 검색 시작점

        // 이미 wikilink 안이면 skip
        if (blocked.has(startPos)) continue;

        // 앞 글자가 한글이면 mid-word → skip
        if (startPos > 0 && KOREAN_CHAR.test(line[startPos - 1])) continue;

        // 뒤 — 조사 또는 비-한글이어야 단어 경계
        const after = line.slice(startPos + key.length);
        if (after.length === 0) {
          // 라인 끝 — OK
        } else if (!KOREAN_CHAR.test(after[0])) {
          // 비한글 — OK
        } else {
          // 한글 다음 — 조사여야 인정
          if (!PARTICLE_RE.test(after)) continue;
        }

        const entry = manifest.get(key)!;
        const suggested =
          entry.displayLabel === entry.canonical
            ? `[[${entry.canonical}]]`
            : `[[${entry.canonical}|${entry.displayLabel}]]`;

        matches.push({
          file: relative(ROOT, filePath),
          line: fmLines + idx + 1,
          matchedText: key,
          card: entry,
          contextLine: line.trim(),
          suggested,
        });
      }
    }
  });

  return matches;
}

// ─────────────────────── MAIN ───────────────────────

const manifest = buildManifest();
console.log(`Manifest: ${manifest.size} entries (cards + aliases)`);

const files = findScriptureFiles(scriptureFilter);
console.log(`Scanning ${files.length} scripture markdown files...`);

const allMatches: Match[] = [];
for (const f of files) {
  allMatches.push(...scanFile(f, manifest));
}

console.log(`Found ${allMatches.length} candidate matches`);

// 그룹: 파일별 → 라인 순
const byFile = new Map<string, Match[]>();
for (const m of allMatches) {
  if (!byFile.has(m.file)) byFile.set(m.file, []);
  byFile.get(m.file)!.push(m);
}
for (const arr of byFile.values()) arr.sort((a, b) => a.line - b.line);

// kind 별 카운트
const kindCount = new Map<CardKind, number>();
for (const m of allMatches) {
  kindCount.set(m.card.kind, (kindCount.get(m.card.kind) ?? 0) + 1);
}

let md = "# Wikilink Review Queue\n\n";
md += "경전 본문에서 자동 스캔된 wikilink 후보. 체크 후 별도 `apply-wikilink-queue.ts` 도구(미구현)로 일괄 적용 예정.\n\n";
md += "## 사용법\n\n";
md += "- 적용할 항목: 체크박스 `- [x]` 로 표시\n";
md += "- 그대로 둘 항목: `- [ ]` 유지 또는 줄 삭제\n";
md += "- 잘못된 후보(stopwords 누락): 줄 삭제 + 스크립트 STOPWORDS 에 추가 후 재실행\n\n";
md += `## 통계\n\n`;
md += `- 생성: ${new Date().toISOString()}\n`;
md += `- 매니페스트: ${manifest.size} entries\n`;
md += `- 스캔 파일: ${files.length}\n`;
md += `- 후보 총: ${allMatches.length} 건\n`;
for (const [k, n] of kindCount) md += `- ${k}: ${n}\n`;
md += "\n---\n\n";

for (const [file, matches] of byFile) {
  md += `## ${file}\n\n`;
  for (const m of matches) {
    md += `- [ ] L${m.line} \`${m.matchedText}\` → \`${m.suggested}\` *(${m.card.kind}/${m.card.canonical})*\n`;
    const ctx = m.contextLine.length > 140 ? m.contextLine.slice(0, 140) + "…" : m.contextLine;
    md += `  > ${ctx}\n\n`;
  }
}

writeFileSync(OUT_FILE, md);
console.log(`→ ${OUT_FILE}`);
