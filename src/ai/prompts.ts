import type { NewsItem, Post } from "../types.js";

export function buildSelectionPrompt(items: NewsItem[]): string {
  return `Ти — головний редактор Telegram-каналу «Sweezy | Ukrainian x Swiss Community».
Обери ОДИН свіжий матеріал, корисний українцям у Швейцарії, важливий для життя у Швейцарії або легкий абсурдний швейцарський сюжет. Відхиляй клікбейт, неперевірені твердження, дублікати й матеріали без чіткого зв'язку зі Швейцарією.

Напиши пост українською у структурованому вигляді (НЕ HTML — лише чистий текст у полях):
- title: короткий чіткий заголовок (до 60 символів), без емодзі
- body: 2 короткі абзаци через \\n\\n. Дружній природний тон, жива мова, без канцеляриту. 1–2 доречні емодзі максимум. Без вигаданих фактів. body загалом 280–520 символів.
- takeaway: одна практична думка (до 100 символів). Для laws/міграції — обережне застереження перевіряти офіційні умови. Для light-тем — коротка іронічна ремарка. Може бути порожнім рядком.
- imagePrompt: англомовний опис зображення без тексту, логотипів і водяних знаків; editorial photo style, natural light, Switzerland context where relevant.

Категорії:
- useful_news — практичне/важливе
- light — легкий/абсурдний сюжет
- product — продукт/сервіс спільноти
- skip — якщо нічого не підходить (accepted=false)

Поверни JSON:
{"accepted":boolean,"reason":string,"selectedUrl":string,"title":string,"body":string,"takeaway":string,"imagePrompt":string,"category":"product|useful_news|light|skip"}

Матеріали:
${JSON.stringify(items)}`;
}

export function buildRevisionPrompt(post: Pick<Post, "text" | "imagePrompt" | "sourceUrl">, comment: string): string {
  return `Ти редагуєш чернетку Telegram-поста українською. Текст уже у HTML для Telegram (дозволені теги: <b>, <i>, <blockquote>, <a href="">).

Оригінал (HTML):
${post.text}

Побажання редактора:
${comment}

Перероби пост строго за побажанням. Не вигадуй фактів. Збережи охайну структуру:
1) рядок із емодзі-категорії + <b>заголовок</b>
2) 2–3 короткі абзаци
3) за потреби <blockquote>💡 …</blockquote>
4) фінальне посилання: 🔗 <a href="${post.sourceUrl}">…</a> — URL джерела не змінюй.

Не додавай інші HTML-теги. Не екрануй існуючі теги як текст. Текст має вміщатися у Telegram caption (до 1024 символів разом із розміткою).

Якщо редактор просить змінити зображення або зміна тексту потребує іншого зображення, створи новий англомовний imagePrompt; інакше поверни попередній imagePrompt без змін: ${post.imagePrompt ?? ""}.

Поверни лише JSON: {"text":string,"imagePrompt":string,"regenerateImage":boolean}.`;
}
