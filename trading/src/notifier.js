// Optional push notifications for signals and trades (Discord and/or Telegram).

async function post(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`[notify] ${res.status} from ${new URL(url).host}`);
  } catch (err) {
    console.warn(`[notify] failed: ${err.message}`);
  }
}

function createNotifier({ discordWebhookUrl, telegramBotToken, telegramChatId }) {
  const enabled = Boolean(discordWebhookUrl || (telegramBotToken && telegramChatId));
  return {
    enabled,
    async send(text) {
      const jobs = [];
      if (discordWebhookUrl) jobs.push(post(discordWebhookUrl, { content: text }));
      if (telegramBotToken && telegramChatId) {
        jobs.push(post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, { chat_id: telegramChatId, text }));
      }
      await Promise.all(jobs);
    },
  };
}

module.exports = { createNotifier };
