import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { Agent } from "node:https";
import { Bot, InlineKeyboard } from "grammy";

setDefaultResultOrder("ipv4first");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USERS = (process.env.ALLOWED_USERS?.split(",") ?? [])
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
const LOCAL_API = process.env.LOCAL_API ?? "http://localhost:3000";
const ARTICLE_PREVIEW_LENGTH = 500;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN 환경변수가 없습니다. Telegram bot token을 설정하세요.");
}

if (ALLOWED_USERS.length === 0) {
  throw new Error("ALLOWED_USERS 환경변수가 없습니다. 허용할 Telegram user id를 설정하세요.");
}

// WSL2 환경에서 api.telegram.org의 IPv6 주소로 SYN이 빠져나가지 못해 ETIMEDOUT으로
// 죽는 케이스가 있다. family: 4를 강제해 socket이 무조건 IPv4로만 열리게 한다.
const ipv4Agent = new Agent({ family: 4, keepAlive: true });

const bot = new Bot(BOT_TOKEN, {
  client: {
    baseFetchConfig: { agent: ipv4Agent, compress: true },
  },
});

function formatArticlePreview(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }

  const trimmed = content.trim();
  if (trimmed.length <= ARTICLE_PREVIEW_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, ARTICLE_PREVIEW_LENGTH)}...`;
}

function formatArticleMessage(title: unknown, content: unknown): string {
  const safeTitle = typeof title === "string" && title.trim().length > 0 ? title.trim() : "제목 없음";
  const preview = formatArticlePreview(content);
  return preview ? `${safeTitle}\n\n${preview}` : safeTitle;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replyWithTopicCards(ctx: any, suggestions: any[]) {
  for (const s of suggestions) {
    const keywords = Array.isArray(s.keywords) ? s.keywords.join(", ") : s.keywords;
    const articleCount = s.articles?.length ?? s.articleIds?.length ?? s.article_ids?.length ?? 0;
    const text = `*${s.topic}*\n키워드: ${keywords}\n관련 기사: ${articleCount}개`;
    const keyboard = new InlineKeyboard()
      .text("기사 생성", `approve:${s.id}`)
      .text("거절", `reject:${s.id}`);
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

bot.catch((err) => {
  console.error("Telegram bot 처리 중 오류:", err.error);
});

// update 수신 여부 확인
bot.use(async (ctx, next) => {
  console.log("Telegram update 수신:", {
    updateId: ctx.update.update_id,
    message: ctx.message?.text,
    callbackQuery: ctx.callbackQuery?.data,
    from: ctx.from?.id,
  });
  await next();
});

// 허용된 사용자만 접근
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (!userId || !ALLOWED_USERS.includes(userId)) {
    console.log("ALLOWED_USERS 차단:", userId ?? "unknown", "allowed:", ALLOWED_USERS);
    await ctx.reply("접근 권한이 없습니다.");
    return;
  }
  await next();
});

// /start
bot.command("start", async (ctx) => {
  console.log("/start 진입:", ctx.from?.id);
  await ctx.reply(
    "EDM Star News 봇입니다.\n\n" +
    "/collect - RSS 수집\n" +
    "/suggest - 토픽 제안\n" +
    "/topics - 제안된 토픽 목록\n" +
    "/articles - 기사 초안 목록"
  );
});

// /collect
bot.command("collect", async (ctx) => {
  console.log("/collect 진입:", ctx.from?.id);
  const msg = await ctx.reply("RSS 수집 중...");
  try {
    const res = await fetch(`${LOCAL_API}/api/collect`, { method: "POST" });
    const data = await res.json();
    const collected = data.collected ?? 0;
    const failed = data.failures?.length ?? 0;
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `수집 완료\n새 기사: ${collected}개${failed > 0 ? `\n실패 소스: ${failed}개` : ""}`
    );
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// /suggest
bot.command("suggest", async (ctx) => {
  const msg = await ctx.reply("토픽 제안 생성 중... (시간이 걸릴 수 있어요)");
  try {
    const res = await fetch(`${LOCAL_API}/api/suggest-clusters`, { method: "POST" });
    const data = await res.json();
    const suggestions = data.suggestions ?? [];

    if (suggestions.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "제안된 토픽이 없습니다.");
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `토픽 제안 ${suggestions.length}개 생성됨`
    );

    // 각 제안을 카드로 표시
    await replyWithTopicCards(ctx, suggestions);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// /topics
bot.command("topics", async (ctx) => {
  console.log("/topics 진입:", ctx.from?.id);
  const msg = await ctx.reply("제안된 토픽 목록 불러오는 중...");
  try {
    const res = await fetch(`${LOCAL_API}/api/suggest-clusters?status=pending`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(`토픽 목록 조회 실패 (status ${res.status}): ${data.error ?? res.statusText}`);
    }

    const suggestions = data.suggestions ?? [];

    if (suggestions.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "제안된 토픽이 없습니다.");
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `제안된 토픽 ${suggestions.length}개`
    );
    await replyWithTopicCards(ctx, suggestions);
  } catch (e) {
    console.error("토픽 목록 조회 실패:", e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// 기사 생성 버튼
bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
  const msg = await ctx.reply("기사 생성 중...");
  let approved = false;

  try {
    // 1. approved 상태로 변경 + suggestion row를 응답에서 직접 사용 (admin과 동일한 데이터 출처)
    const approveRes = await fetch(`${LOCAL_API}/api/suggest-clusters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    const approveData = await approveRes.json().catch(() => ({}));
    console.log("PATCH approve 응답:", approveRes.status, approveData);
    if (!approveRes.ok || approveData.error) {
      throw new Error(
        `제안 승인 실패 (status ${approveRes.status}): ${approveData.error ?? approveRes.statusText}`
      );
    }
    approved = true;

    const suggestion = approveData.suggestion;
    const topic = typeof suggestion?.topic === "string" ? suggestion.topic.trim() : "";
    const keywords = Array.isArray(suggestion?.keywords) ? suggestion.keywords : [];
    const articleIds = Array.isArray(suggestion?.article_ids) ? suggestion.article_ids : [];

    if (!topic) {
      throw new Error("제안 데이터에 topic이 없습니다.");
    }
    if (articleIds.length === 0 && keywords.length === 0) {
      throw new Error("제안 데이터에 articleIds와 keywords가 모두 없습니다.");
    }

    // 2. 클러스터 생성 (admin과 동일: matchMode 생략 → API 기본값 'or')
    const clusterRes = await fetch(`${LOCAL_API}/api/cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, keywords, articleIds }),
    });
    const clusterData = await clusterRes.json().catch(() => ({}));
    console.log("POST cluster 응답:", clusterRes.status, clusterData);
    if (!clusterRes.ok || !clusterData.success) {
      throw new Error(
        `클러스터 생성 실패 (status ${clusterRes.status}): ${clusterData.error ?? clusterRes.statusText}`
      );
    }
    const clusterId = clusterData.clusterId;
    if (!clusterId) {
      throw new Error(`클러스터 생성 실패: clusterId가 응답에 없습니다. payload=${JSON.stringify(clusterData)}`);
    }

    // 3. 기사 생성
    const genRes = await fetch(`${LOCAL_API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clusterIds: [clusterId] }),
    });
    const genData = await genRes.json().catch(() => ({}));
    console.log("POST generate 응답:", genRes.status, genData);
    if (!genRes.ok) {
      throw new Error(
        `기사 생성 실패 (status ${genRes.status}): ${genData.error ?? genRes.statusText}`
      );
    }

    const genResult = genData.results?.[0];
    if (!genResult?.success) {
      throw new Error(`기사 생성 실패: ${genResult?.error ?? "알 수 없는 오류"}`);
    }
    const articleId = genResult.article?.id;
    if (!articleId) {
      throw new Error("기사 생성 실패: article id가 없습니다.");
    }

    // 4. suggested_clusters 상태 published로 + clusterId 연결 (admin과 동일하게 camelCase)
    const publishRes = await fetch(`${LOCAL_API}/api/suggest-clusters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published", clusterId }),
    });
    const publishData = await publishRes.json().catch(() => ({}));
    console.log("PATCH published 응답:", publishRes.status, publishData);
    if (!publishRes.ok || publishData.error) {
      throw new Error(
        `제안 published 처리 실패 (status ${publishRes.status}): ${publishData.error ?? publishRes.statusText}`
      );
    }

    const keyboard = new InlineKeyboard()
      .text("게시", `publish:${articleId}`)
      .text("삭제", `delete:${articleId}`);

    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `기사 생성 완료\n\n${formatArticleMessage(genResult.article?.title, genResult.article?.content)}`,
      { reply_markup: keyboard }
    );
  } catch (e) {
    if (approved) {
      await fetch(`${LOCAL_API}/api/suggest-clusters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      }).catch((resetError) => {
        console.error("제안 상태 pending 복구 실패:", resetError);
      });
    }
    console.error("기사 생성 버튼 처리 실패:", e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// 거절 버튼
bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  await fetch(`${LOCAL_API}/api/suggest-clusters/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "rejected" }),
  });
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
  await ctx.reply("거절됨");
});

// /articles
bot.command("articles", async (ctx) => {
  try {
    const res = await fetch(`${LOCAL_API}/api/articles?published=false`);
    const data = await res.json();
    const articles = data.articles ?? [];

    if (articles.length === 0) {
      await ctx.reply("게시 대기 중인 기사가 없습니다.");
      return;
    }

    await ctx.reply(`기사 초안 ${articles.length}개`);

    for (const a of articles.slice(0, 10)) {
      const keyboard = new InlineKeyboard()
        .text("게시", `publish:${a.id}`)
        .text("삭제", `delete:${a.id}`);
      await ctx.reply(formatArticleMessage(a.title, a.content), { reply_markup: keyboard });
    }
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

// 게시 버튼
bot.callbackQuery(/^publish:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  try {
    await fetch(`${LOCAL_API}/api/articles/${id}/publish`, { method: "PATCH" });
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply("게시 완료");
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

// 삭제 버튼
bot.callbackQuery(/^delete:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  try {
    await fetch(`${LOCAL_API}/api/articles/${id}`, { method: "DELETE" });
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply("삭제 완료");
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

async function main() {
  try {
    const me = await bot.api.getMe();
    console.log(`Telegram bot token 확인됨: @${me.username}`);

    await bot.start({
      onStart: (botInfo) => {
        console.log(`투아라 (Today Artist Life) 봇 시작됨: @${botInfo.username}`);
      },
    });
  } catch (e) {
    console.error("Telegram bot 시작 실패:", e);
    process.exit(1);
  }
}

void main();
