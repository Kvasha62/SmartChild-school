# SmartChild

Образовательный блог для детей 6–17 лет и их родителей: Scratch, Python, Unity,
Roblox и подготовка к ОГЭ/ЕГЭ по информатике.

Стек: **Astro 7 + TypeScript + Content Collections**. Сайт полностью статический,
клиентский JavaScript не используется.

## Команды

| Команда            | Что делает                                        |
| ------------------ | ------------------------------------------------- |
| `npm install`      | Установка зависимостей (Node >= 22.12)            |
| `npm run dev`      | Dev-сервер на http://localhost:4321               |
| `npm run build`    | Сборка статики в `dist/`                          |
| `npm run preview`  | Локальный просмотр собранного сайта               |
| `npm run check`    | Проверка типов и разметки (`astro check`)         |

## Структура

```
src/
├── content.config.ts        # схема коллекций scratch / oge / ege (Astro 5+)
├── content/
│   ├── scratch/*.md         # материалы трека Scratch
│   ├── oge/*.md             # материалы трека ОГЭ
│   └── ege/*.md             # материалы трека ЕГЭ
├── components/
│   ├── Header.astro         # sticky-шапка, CSS-only гамбургер-меню
│   ├── Footer.astro
│   ├── TrackCard.astro      # карточка направления обучения
│   └── ArticleCard.astro    # карточка статьи
├── layouts/
│   └── BaseLayout.astro     # <html>-обёртка, мета-теги, глобальные стили
├── lib/
│   └── tracks.ts            # общие метаданные треков (id, иконки, акценты)
├── pages/
│   ├── index.astro          # главная страница
│   ├── [track].astro        # /scratch, /oge, /ege
│   └── [track]/[slug].astro # страница статьи
└── styles/
    └── global.css           # дизайн-токены (CSS Custom Properties) + примитивы
```

`docs/screenshots/` содержит скриншоты главной страницы, треков и статьи
(десктоп / планшет / мобильные).

## Заметки по реализации

- Цветовая схема вынесена в CSS Custom Properties в `src/styles/global.css`,
  компоненты используют только переменные.
- Мобильное меню в шапке работает на CSS («checkbox hack») — без клиентского JS.
- Плавная прокрутка к блоку `#tracks` — нативный `scroll-behavior: smooth`
  (отключается при `prefers-reduced-motion`).
- Форма лид-магнита пока не отправляет данные: `data-form="lead-magnet"`,
  `action=""` — точка интеграции помечена `TODO` в `src/pages/index.astro`.
- Контакты в футере — плейсхолдеры.
