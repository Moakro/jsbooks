import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Project-relative content directory. The vault snapshot lives at ./content/
// at the repo root and is committed so the cloud build is self-contained.
// To refresh from the editing vault, run `pnpm sync:vault`.
const CONTENT = "./content";

const scripture = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: `${CONTENT}/scripture`,
  }),
  schema: z.object({
    scripture: z.string().optional(),
    scripture_hanja: z.string().optional(),
    편자: z.string().optional(),
    편자_한자: z.string().optional(),
    편자_호: z.string().optional(),
    편자_호_한자: z.string().optional(),
    편찬자_들: z.string().optional(),
    type: z.string().optional(),
    date: z.string().optional(),
    date_lunar: z.string().optional(),
    권: z.number().optional(),
    권_이름: z.string().optional(),
    권_이름_한자: z.string().optional(),
    연도: z.number().optional(),
    연도_간지: z.string().optional(),
    장: z.number().optional(),
    verse_count: z.number().optional(),
    원본_저자_수기: z.string().optional(),
    이전_출판: z.string().optional(),
  }),
});

const people = defineCollection({
  loader: glob({ pattern: "*.md", base: `${CONTENT}/people` }),
  schema: z.object({
    type: z.literal("person").optional(),
    name: z.string(),
    name_hanja: z.string().optional(),
    birth: z.string().optional(),
    birth_place: z.string().optional(),
    本貫: z.string().optional(),
    status: z.string().optional(),
  }),
});

const places = defineCollection({
  loader: glob({ pattern: "*.md", base: `${CONTENT}/places` }),
  schema: z.object({
    type: z.literal("place").optional(),
    name: z.string(),
    name_hanja: z.string().optional(),
    region: z.string().optional(),
    status: z.string().optional(),
  }),
});

const dosu = defineCollection({
  loader: glob({ pattern: "*.md", base: `${CONTENT}/dosu` }),
  schema: z.object({
    type: z.literal("dosu").optional(),
    name: z.string(),
    name_hanja: z.string().optional(),
    status: z.string().optional(),
  }),
});

const terms = defineCollection({
  loader: glob({ pattern: "*.md", base: `${CONTENT}/terms` }),
  schema: z.object({
    type: z.literal("term").optional(),
    name: z.string(),
    name_hanja: z.string().optional(),
    status: z.string().optional(),
  }),
});

const dates = defineCollection({
  loader: glob({ pattern: "*.md", base: `${CONTENT}/dates` }),
  schema: z.object({
    type: z.literal("date").optional(),
    name: z.string(),
    ganji: z.string().optional(),
    year: z.number().optional(),
    status: z.string().optional(),
  }),
});

export const collections = { scripture, people, places, dosu, terms, dates };
