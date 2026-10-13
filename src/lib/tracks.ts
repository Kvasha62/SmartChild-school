/**
 * Shared metadata for the three learning tracks.
 *
 * NOTE: this small module is an addition to the structure from the ТЗ. It is
 * needed because `getStaticPaths()` is compiled into a separate module, so it
 * cannot read constants declared in the frontmatter of the page — and because
 * the track labels/icons are used by both `ArticleCard` and the track pages.
 */
export type TrackId = 'scratch' | 'oge' | 'ege';

export interface TrackMeta {
  /** Short label used in navigation and badges ("Scratch", "ОГЭ", "ЕГЭ"). */
  label: string;
  /** Emoji icon of the track. */
  icon: string;
  /** Accent colour as a CSS custom property. */
  accent: string;
  /** <h1> of the track landing page. */
  h1: string;
  /** Short intro of the track landing page. */
  lead: string;
  /** «Для кого» — target audience. */
  audience: string;
  /** <title> of the track landing page. */
  metaTitle: string;
}

export const TRACK_META: Record<TrackId, TrackMeta> = {
  scratch: {
    label: 'Scratch',
    icon: '🎮',
    accent: 'var(--color-accent-scratch)',
    h1: 'Scratch для детей 6–10 лет',
    lead: 'Первые игры и мультики, развитие логики и геймификация обучения — без скучной теории.',
    audience: 'Для дошкольников и младших школьников',
    metaTitle: 'Scratch для детей 6–10 лет — SmartChild',
  },
  oge: {
    label: 'ОГЭ',
    icon: '📘',
    accent: 'var(--color-accent-oge)',
    h1: 'Подготовка к ОГЭ по информатике',
    lead: 'Python, Roblox Studio и разбор реальных заданий ОГЭ — от базовых типов до циклов и алгоритмов.',
    audience: 'Для школьников 11–14 лет',
    metaTitle: 'Подготовка к ОГЭ по информатике — SmartChild',
  },
  ege: {
    label: 'ЕГЭ',
    icon: '🎓',
    accent: 'var(--color-accent-ege)',
    h1: 'Подготовка к ЕГЭ по информатике',
    lead: 'Продвинутый Python, Unity и системный разбор заданий ЕГЭ с видеоразборами каждой ошибки.',
    audience: 'Для старшеклассников 15–17 лет',
    metaTitle: 'Подготовка к ЕГЭ по информатике — SmartChild',
  },
};

export const TRACK_IDS = Object.keys(TRACK_META) as TrackId[];
