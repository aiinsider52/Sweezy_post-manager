import type { NewsItem, Post } from "../types.js";

export function buildSelectionPrompt(items: NewsItem[]): string {
  return `Ти — редактор Telegram-каналу «Sweezy | Ukrainian x Swiss Community».
Обери ОДИН свіжий матеріал, корисний українцям у Швейцарії, важливий для життя у Швейцарії або легкий абсурдний швейцарський сюжет. Відхиляй клікбейт, неперевірені твердження, дублікати й матеріали без чіткого зв'язку зі Швейцарією.

Створи український пост: 500–900 знаків, короткі абзаци, дружній природний тон, 2–5 доречних емодзі, без вигаданих фактів. Заверши рядком «Джерело: <URL>». Для законів/міграції додай обережне застереження перевіряти офіційні умови. Склади англомовний imagePrompt без тексту, логотипів і водяних знаків.

Поверни JSON: {"accepted":boolean,"reason":string,"selectedUrl":string,"text":string,"imagePrompt":string,"category":"product|useful_news|light|skip"}.

Матеріали:
${JSON.stringify(items)}`;
}

export function buildRevisionPrompt(post: Pick<Post, "text" | "imagePrompt" | "sourceUrl">, comment: string): string {
  return `Ти редагуєш чернетку Telegram-поста українською мовою.

Оригінал:
${post.text}

Побажання редактора:
${comment}

Перероби текст строго за побажанням. Не вигадуй фактів. Збережи коректне посилання на джерело: ${post.sourceUrl}. Текст має вміщатися у Telegram caption (до 1024 символів). Якщо редактор просить змінити зображення або зміна тексту потребує іншого зображення, створи новий англомовний imagePrompt; інакше поверни попередній imagePrompt без змін: ${post.imagePrompt ?? ""}.

Поверни лише JSON: {"text":string,"imagePrompt":string,"regenerateImage":boolean}.`;
}
