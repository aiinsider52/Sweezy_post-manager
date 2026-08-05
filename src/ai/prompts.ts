import type { NewsItem, Post } from "../types.js";

export function buildSelectPrompt(items: NewsItem[], recentTitles: string[] = []): string {
  const catalog = items.map((item, index) => ({
    i: index + 1,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt ?? null,
    description: item.description.slice(0, 280)
  }));

  const recentBlock = recentTitles.length
    ? `Останні теми (НЕ ПОВТОРЮЙ схожий сюжет):
${recentTitles.map((title, i) => `${i + 1}. ${title}`).join("\n")}

Якщо останні пости про транспорт / «правила» / статус S — обери ІНШУ тему.`
    : `Різноманіття: не зациклюйся на транспорті й «правилах».`;

  return `Ти — головний редактор Telegram-каналу «Sweezy | Ukrainian x Swiss Community».
Обери ОДИН найкращий матеріал зі списку (ще НЕ пиши пост — лише вибір).

Аудиторія: українці у Швейцарії — користь, бізнес, живі історії.

${recentBlock}

Пріоритети (з ротацією):
1) Практика для UA у CH: статус S, дозволи, робота, житло, страховка, школа, транспорт, податки
2) Бізнес / стартапи / самозайнятість / ринок праці
3) Казус / смішне / абсурд зі швейцарським характером
4) Важлива CH-новина з конкретним впливом на життя

Відхиляй (accepted=false): повтори теми, клікбейт, спорт/біржа без користі, матеріали без CH/UA/бізнес-зв'язку, «вода» без фактів.

Поверни JSON:
{"accepted":boolean,"reason":string,"selectedUrl":string,"category":"product|useful_news|business|light|skip"}

Кандидати:
${JSON.stringify(catalog)}`;
}

export function buildWritePrompt(item: NewsItem, articleText: string | null, sourceUrl: string): string {
  const articleBlock = articleText
    ? `Повний/розширений текст статті (витягнуто з URL, використовуй лише факти звідси):
"""
${articleText.slice(0, 6500)}
"""`
    : `Повний текст статті недоступний. Пиши ОБЕРЕЖНО лише з title/description нижче. Не вигадуй цифри/дати/закони. Якщо фактів мало — accepted логічно все одно пиши пост, але без вигаданих деталей.`;

  return `Ти пишеш пост для Telegram-каналу «Sweezy | Ukrainian x Swiss Community» українською.

Джерело: ${item.source}
Заголовок новини: ${item.title}
Опис RSS: ${item.description.slice(0, 400)}
URL: ${sourceUrl}

${articleBlock}

МЕТА ПОСТА: корисно + цікаво. Після прочитання людина має зрозуміти ЩО змінилось і ЩО їй зробити.

ПРАВИЛА:
- Лише факти з матеріалу. Не вигадуй.
- Більш інформативно: 3 абзаци body, конкретні цифри/дати/назви/хто-для-кого.
- Заголовок (title) — ЦЕПЛЯЮЧИЙ: інтрига + конкретна вигода/наслідки, без клікбейту-брехні. До 70 символів, без емодзі.
- У body виділи ключові факти розміткою:
  **жирний** для важливих чисел, дат, назв змін
  __підкреслення__ для того, що треба запам'ятати / перевірити
  *курсив* для короткого акценту (рідко)
- 2–4 виділення на пост максимум. Не розмічай цілі абзаци.
- Тон: живий, дружній, без канцеляриту. 1–2 емодзі в body максимум.
- takeaway: практичний інсайт 50–120 символів, без 💡 і лапок
- cta: чітка дія 40–100 символів
- imagePrompt: англійською, 1–2 речення — WOW editorial scene: dramatic natural light, strong composition, emotional/human moment or striking Swiss detail tied to the story; photorealistic; NO text/logos/UI/collage

Поля (текст із ** __ * маркерами, БЕЗ HTML-тегів):
- title
- body: 3 абзаци через \\n\\n, разом 420–720 символів (без маркерів у підрахунку орієнтовно)
- takeaway
- cta
- imagePrompt
- category: useful_news|business|light|product

Поверни JSON:
{"title":string,"body":string,"takeaway":string,"cta":string,"imagePrompt":string,"category":"product|useful_news|business|light"}`;
}

/** @deprecated use buildSelectPrompt + buildWritePrompt */
export function buildSelectionPrompt(items: NewsItem[], recentTitles: string[] = []): string {
  return buildSelectPrompt(items, recentTitles);
}

export function buildRevisionPrompt(post: Pick<Post, "text" | "imagePrompt" | "sourceUrl">, comment: string): string {
  return `Ти редагуєш чернетку Telegram-поста українською. Текст уже у HTML для Telegram (дозволені теги: <b>, <i>, <u>, <blockquote>, <a href="">).

Оригінал (HTML):
${post.text}

Побажання редактора:
${comment}

Перероби пост строго за побажанням. Не вигадуй фактів. Збережи структуру:
1) емодзі-категорії + <b>цепляючий заголовок</b>
2) 3 інформативні абзаци з конкретикою; використовуй <b>, <i>, <u> для ключових фактів (помірно)
3) ОБОВ'ЯЗКОВО <blockquote>💡 …</blockquote>
4) 👉 заклик до дії
5) 🔗 <a href="${post.sourceUrl}">…</a> — URL не змінюй
6) підпис без змін:
🇨🇭 Sweezy — Life in Switzerland. Simplified.
<a href="https://t.me/sweezyxswiss">Sweezy</a> | <a href="https://sweezy.world">sweezy.world</a> | Manager <a href="https://t.me/vladyslavarcher">@vladyslavarcher</a> <a href="https://t.me/yuliiaarcher">@yuliiaarcher</a> 🏹

До 1024 символів разом із розміткою.

Якщо потрібна нова картинка — новий англомовний WOW imagePrompt (dramatic light, strong composition, photorealistic, no text/logos); інакше попередній: ${post.imagePrompt ?? ""}.

JSON: {"text":string,"imagePrompt":string,"regenerateImage":boolean}.`;
}

/** Enrich LLM image prompt for higher visual impact. */
export function enrichImagePrompt(scene: string): string {
  const cleaned = scene.replace(/\s+/g, " ").trim();
  return [
    "Award-winning photorealistic editorial photograph, magazine cover energy,",
    "shot on 35mm, cinematic dramatic lighting, rich contrast, shallow depth of field,",
    "strong focal subject, emotional or striking moment, authentic Swiss atmosphere when relevant,",
    "high detail, natural color grade, no text, no logos, no watermarks, no UI, no collage, no illustration.",
    `Scene: ${cleaned || "Cinematic everyday life moment in modern Switzerland"}`
  ].join(" ");
}
