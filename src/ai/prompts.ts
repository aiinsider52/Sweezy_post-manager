import type { NewsItem, Post } from "../types.js";

export function buildSelectionPrompt(items: NewsItem[]): string {
  const catalog = items.map((item, index) => ({
    i: index + 1,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt ?? null,
    description: item.description.slice(0, 320)
  }));

  return `Ти — головний редактор Telegram-каналу «Sweezy | Ukrainian x Swiss Community».
Аудиторія: українці у Швейцарії, які хочуть користь, бізнес-інсайти й живі історії — не «воду».

Мета: обрати ОДИН матеріал і написати пост, після якого хочеться щось зробити (прочитати джерело / перевірити правило / зберегти пораду / поділитися).

Пріоритети (від найвищого):
1) Практичне для українців у CH: статус S, дозволи, робота, житло, страховка, школа, інтеграція, транспорт, податки.
2) Бізнес і підприємництво у Швейцарії: стартапи, самозайнятість, GmbH/Einzelfirma, фріланс, ринок праці, кейси компаній, регулювання для бізнесу.
3) Казусні / смішні / абсурдні швейцарські ситуації з характером (без тупого клікбейту).
4) Важлива швейцарська новина з конкретним впливом на повсякденне життя.

Жорстко відхиляй (accepted=false):
- загальні формулювання без фактів: «оновлені правила», «стане зручніше», «варто знати» без цифр/дат/назв
- старі або evergreen матеріали без свіжого приводу
- клікбейт, чутки, неперевірені твердження
- сухий спорт/біржа/політичний шум без користі для аудиторії
- матеріали без зв'язку зі Швейцарією / українцями / бізнесом тут

ПРАВИЛА ТЕКСТУ (обов'язково):
- Лише факти з матеріалу. Не вигадуй закони, дати, суми, відсотки.
- У body мають бути КОНКРЕТИКИ: хто / що змінилось / коли / для кого / яка цифра або назва.
- Заборонені розмиті фрази: «оновлені правила», «зручніше та безпечніше», «зверніть увагу», якщо немає пояснення ЩО саме.
- Тон: дружній, живий, без канцеляриту. 1–2 емодзі в body максимум.
- cta: чіткий заклик до дії (1 речення), наприклад «Перевірте деталі у джерелі й збережіть собі», «Якщо ведете бізнес — гляньте вимоги», «Поділіться з тими, хто щойно переїхав».

Поля (чистий текст, БЕЗ HTML):
- title: до 60 символів, без емодзі; інтрига + конкретна суть
- body: 2 абзаци через \\n\\n, 240–480 символів разом
- takeaway: інсайт 40–110 символів БЕЗ емодзі 💡/❞ (шаблон додасть оформлення)
- cta: 35–90 символів, з дієсловом у наказовій/спонукальній формі
- imagePrompt: англійською, 1–2 речення: конкретна сцена під новину (люди/місце/предмет), Swiss context якщо доречно; photorealistic editorial photo; natural light; shallow depth of field; NO text, logos, watermarks, UI, collage

Категорії:
- useful_news — практика/правила/побут
- business — бізнес/підприємництво/робота й гроші
- light — курьоз/смішне/казус
- product — продукт/сервіс спільноти Sweezy
- skip — нічого сильного немає

Поверни JSON:
{"accepted":boolean,"reason":string,"selectedUrl":string,"title":string,"body":string,"takeaway":string,"cta":string,"imagePrompt":string,"category":"product|useful_news|business|light|skip"}

Кандидати (вже відсортовані за свіжістю/релевантністю):
${JSON.stringify(catalog)}`;
}

export function buildRevisionPrompt(post: Pick<Post, "text" | "imagePrompt" | "sourceUrl">, comment: string): string {
  return `Ти редагуєш чернетку Telegram-поста українською. Текст уже у HTML для Telegram (дозволені теги: <b>, <i>, <blockquote>, <a href="">).

Оригінал (HTML):
${post.text}

Побажання редактора:
${comment}

Перероби пост строго за побажанням. Не вигадуй фактів. Збережи охайну структуру:
1) рядок із емодзі-категорії + <b>заголовок</b>
2) 2 короткі абзаци з КОНКРЕТИКОЮ (цифри/дати/назви), без «води»
3) <blockquote>💡 …</blockquote> — інсайт
4) рядок із закликом до дії, починається з 👉
5) посилання на джерело: 🔗 <a href="${post.sourceUrl}">…</a> — URL джерела не змінюй
6) фірмовий підпис каналу в кінці без змін:
🇨🇭 Sweezy — Life in Switzerland. Simplified.
<a href="https://t.me/sweezyxswiss">Sweezy</a> | <a href="https://sweezy.world">sweezy.world</a> | Manager <a href="https://t.me/vladyslavarcher">@vladyslavarcher</a> <a href="https://t.me/yuliiaarcher">@yuliiaarcher</a> 🏹

Не додавай інші HTML-теги. Не екрануй існуючі теги як текст. Текст має вміщатися у Telegram caption (до 1024 символів разом із розміткою).

Якщо редактор просить змінити зображення або зміна тексту потребує іншого зображення, створи новий англомовний imagePrompt (photorealistic editorial, natural light, no text/logos); інакше поверни попередній imagePrompt без змін: ${post.imagePrompt ?? ""}.

Поверни лише JSON: {"text":string,"imagePrompt":string,"regenerateImage":boolean}.`;
}

/** Enrich LLM image prompt for higher visual quality. */
export function enrichImagePrompt(scene: string): string {
  const cleaned = scene.replace(/\s+/g, " ").trim();
  return [
    "Photorealistic editorial photograph for a quality news magazine,",
    "35mm lens, natural soft light, shallow depth of field, rich color, high detail,",
    "authentic Swiss atmosphere when relevant,",
    "no text, no logos, no watermarks, no UI, no collage, no illustration style.",
    `Scene: ${cleaned || "Everyday life in modern Switzerland, cinematic framing"}`
  ].join(" ");
}
