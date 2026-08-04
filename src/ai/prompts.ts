import type { NewsItem, Post } from "../types.js";

export function buildSelectionPrompt(items: NewsItem[]): string {
  const catalog = items.map((item, index) => ({
    i: index + 1,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt ?? null,
    description: item.description.slice(0, 280)
  }));

  return `Ти — головний редактор Telegram-каналу «Sweezy | Ukrainian x Swiss Community».
Мета: обрати ОДИН матеріал, який хочеться відкрити й обговорити — свіжий, конкретний, з характером.

Пріоритети (від найвищого):
1) Практичне для українців у Швейцарії: статус S, дозволи, робота, житло, страховка, школа, інтеграція, транспорт, податки.
2) Важлива швейцарська новина, що реально впливає на повсякденне життя.
3) Легкий/курйозний швейцарський сюжет з вау-ефектом (без тупого клікбейту).

Жорстко відхиляй:
- старі або «вічнозелені» матеріали без свіжого приводу
- клікбейт, чутки, неперевірені твердження
- сухий спорт/біржу/політичний шум без практичної цінності для аудиторії
- дублікати теми, яку вже всі бачили в загальних новинах без нового кута
- матеріали без чіткого зв'язку зі Швейцарією чи життям українців тут

Якщо в списку немає нічого справді сильного — accepted=false.

Напиши пост українською у структурованому вигляді (НЕ HTML — лише чистий текст у полях):
- title: короткий чіткий заголовок (до 60 символів), без емодзі; інтрига + ясність
- body: 2 короткі абзаци через \\n\\n. Дружній природний тон, жива мова, без канцеляриту. 1–2 доречні емодзі максимум. Без вигаданих фактів. body загалом 240–450 символів.
- takeaway: обов'язкова коротка практична думка або м'який висновок (40–100 символів), БЕЗ емодзі 💡/❞ — їх додасть шаблон. Для laws/міграції — обережне застереження перевіряти офіційні умови. Для light-тем — коротка іронічна ремарка. Порожній рядок лише у виняткових випадках.
- imagePrompt: англомовний опис зображення без тексту, логотипів і водяних знаків; editorial photo style, natural light, Switzerland context where relevant.

Категорії:
- useful_news — практичне/важливе
- light — легкий/абсурдний сюжет
- product — продукт/сервіс спільноти
- skip — якщо нічого не підходить (accepted=false)

Поверни JSON:
{"accepted":boolean,"reason":string,"selectedUrl":string,"title":string,"body":string,"takeaway":string,"imagePrompt":string,"category":"product|useful_news|light|skip"}

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
2) 2 короткі абзаци
3) блок-цитата у форматі <blockquote>💡 … ❞</blockquote> (майже завжди потрібна)
4) посилання на джерело: 🔗 <a href="${post.sourceUrl}">…</a> — URL джерела не змінюй
5) фірмовий підпис каналу в кінці без змін:
<a href="https://t.me/sweezyxswiss">Sweezy</a> | <a href="https://sweezy.world">sweezy.world</a> | Manager <a href="https://t.me/vladyslavarcher">@vladyslavarcher</a> <a href="https://t.me/yuliiaarcher">@yuliiaarcher</a> 🏹

Не додавай інші HTML-теги. Не екрануй існуючі теги як текст. Текст має вміщатися у Telegram caption (до 1024 символів разом із розміткою).

Якщо редактор просить змінити зображення або зміна тексту потребує іншого зображення, створи новий англомовний imagePrompt; інакше поверни попередній imagePrompt без змін: ${post.imagePrompt ?? ""}.

Поверни лише JSON: {"text":string,"imagePrompt":string,"regenerateImage":boolean}.`;
}
