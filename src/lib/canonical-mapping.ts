/**
 * 천지개벽경 canonical(한자 원문) ↔ 한글 매핑 헬퍼.
 *
 * v2 schema (sentence-anchor 모델):
 *   매핑 키 = 한자 sentence anchor (e.g. "1-1-3", "preface-2")
 *   매핑 값 = { hangeul: string, reviewed: boolean, confidence?: number }
 *     · hangeul은 해당 한자 문장에 짝지어진 한글 본문 텍스트 (string).
 *     · 빈 string("")이면 아직 매핑되지 않은 것.
 *
 * 매핑 JSON 위치: content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json
 */
import mapping from "../../content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json" with { type: "json" };

export type VerseMapping = {
  hangeul: string;
  reviewed?: boolean;
  confidence?: number;
};

export type MappingFile = {
  version: number;
  schema?: string;
  scripture: string;
  source_slug?: string;
  target_slug?: string;
  source_label?: string;
  target_label?: string;
  description?: string;
  verses: Record<string, VerseMapping>;
};

const MAPPING = mapping as MappingFile;

/**
 * 한자 sentence anchor에 짝지어진 한글 매핑을 반환.
 * 매핑이 없거나 hangeul이 빈 string이면 null. 호출부에서 "한글 미매핑" 표시 가능.
 */
export function getMapping(anchor: string): VerseMapping | null {
  const m = MAPPING.verses[anchor];
  if (!m) return null;
  if (!m.hangeul) return null;
  return m;
}

/** 매핑이 존재(미검수 포함)하는지만 확인 (빈 string도 entry로 침). admin 도구용. */
export function getRawMapping(anchor: string): VerseMapping | null {
  return MAPPING.verses[anchor] ?? null;
}

export function getAllMappings(): MappingFile {
  return MAPPING;
}

/** 한 장(章)의 한자 sentence anchor 묶음에 대한 매핑 통계. */
export function chapterMappingStats(
  hanjaAnchors: string[],
): { total: number; reviewed: number; mapped: number } {
  let reviewed = 0;
  let mapped = 0;
  for (const a of hanjaAnchors) {
    const m = MAPPING.verses[a];
    if (!m) continue;
    if (m.hangeul) mapped++;
    if (m.reviewed) reviewed++;
  }
  return { total: hanjaAnchors.length, reviewed, mapped };
}
