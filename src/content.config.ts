/**
 * Content collections for the three learning tracks.
 *
 * NOTE: the ТЗ mentions `src/content/config.ts`. Since Astro 5 the collection
 * config must live in `src/content.config.ts` (the old location was removed in
 * Astro 6), so this file is the correct place for the current stack.
 * The Markdown entries themselves stay in `src/content/<track>/` as requested.
 */
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const articleSchema = z.object({
  title: z.string(),
  excerpt: z.string(),
  /** Publication date; accepts "2026-10-02" or a full timestamp. */
  date: z.coerce.date(),
  /** Optional cover image path (files in /public or /src/assets). */
  cover: z.string().optional(),
  draft: z.boolean().default(false),
});

const trackLoader = (track: string) =>
  glob({ pattern: '**/*.md', base: `./src/content/${track}` });

export const collections = {
  scratch: defineCollection({ loader: trackLoader('scratch'), schema: articleSchema }),
  oge: defineCollection({ loader: trackLoader('oge'), schema: articleSchema }),
  ege: defineCollection({ loader: trackLoader('ege'), schema: articleSchema }),
};
