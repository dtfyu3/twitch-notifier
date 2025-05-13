const { createHmac } = require('crypto');
const axios = require('axios');

const config = {
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    webhookSecret: process.env.TWITCH_WEBHOOK_SECRET,
    streamerId: process.env.TWITCH_STREAMER_ID,
    targetGame: process.env.GAME_NAME, 
    keywords: ["Amazing", "Free", "RP"] 
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  }
};

// Проверка подписи Twitch
function verifySignature(body, signature) {
  const hmac = createHmac('sha256', config.twitch.webhookSecret);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}` === signature;
}

// Отправка в Telegram
async function sendTelegramAlert(title, game, vodUrl) {
  const message = `
    🎮 **Новый стрим!**  
    **Игра:** ${game}  
    **Название:** ${title}  
    [Смотреть VOD](${vodUrl})
  `;
  await axios.post(
    `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
    { chat_id: config.telegram.chatId, text: message, parse_mode: "Markdown" }
  );
}

// Получение access_token для Twitch API
async function getTwitchAccessToken() {
  const { data } = await axios.post(
    `https://id.twitch.tv/oauth2/token?client_id=${config.twitch.clientId}&client_secret=${config.twitch.clientSecret}&grant_type=client_credentials`
  );
  return data.access_token;
}

// Проверка игры и названия стрима
async function checkStreamConditions() {
  const token = await getTwitchAccessToken();
  const { data } = await axios.get(
    `https://api.twitch.tv/helix/videos?user_id=${config.twitch.streamerId}&first=1`,
    { headers: { 'Client-ID': config.twitch.clientId, 'Authorization': `Bearer ${token}` } }
  );

  if (data.data?.length > 0) {
    const vod = data.data[0];
    const isGameMatch = vod.game_name === config.twitch.targetGame;
    const isTitleMatch = config.twitch.keywords.some(keyword => vod.title.toLowerCase().includes(keyword));
    
    if (isGameMatch && isTitleMatch) {
      return { 
        shouldNotify: true, 
        title: vod.title, 
        game: vod.game_name, 
        vodUrl: `https://twitch.tv/videos/${vod.id}` 
      };
    }
  }
  return { shouldNotify: false };
}

// Обработчик вебхука
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  
  try {
    const body = req.body;
    const signature = req.headers['twitch-eventsub-message-signature'];
    
    // Проверка подписи
    if (!verifySignature(JSON.stringify(body), signature)) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    // Проверка события "стрим окончен"
    if (body.subscription?.type === "stream.offline") {
      const { shouldNotify, title, game, vodUrl } = await checkStreamConditions();
      if (shouldNotify) {
        await sendTelegramAlert(title, game, vodUrl);
      }
    }

    res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};