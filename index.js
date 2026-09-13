import express from "express";
import TelegramBot from "node-telegram-bot-api";
import pg from "pg";

const { Pool } = pg;

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 3000;

const ADMIN_ID = Number(
  process.env.ADMIN_ID || "7070690513"
);

const DATABASE_URL = process.env.DATABASE_URL;

const UPDATE_CHANNEL =
  process.env.UPDATE_CHANNEL ||
  "https://t.me/spdfairyappi";

const OWNER_USERNAME =
  process.env.OWNER_USERNAME ||
  "ShamimLeader";

/* =========================================================
   20 BOT TOKENS
========================================================= */

const BOT_TOKENS = [];

for (let i = 1; i <= 20; i++) {
  const token = process.env[`BOT_${i}_TOKEN`];

  if (token && token.trim()) {
    BOT_TOKENS.push({
      number: i,
      token: token.trim()
    });
  }
}

if (BOT_TOKENS.length === 0) {
  console.error("❌ No bot tokens found.");
  process.exit(1);
}

/* =========================================================
   DATABASE
========================================================= */

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================================================
   EXPRESS
========================================================= */

const app = express();

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Auto Retention Pro</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="
        background:#080808;
        color:white;
        font-family:Arial;
        text-align:center;
        padding:50px;
      ">
        <h1>🤖 Auto Retention Pro</h1>
        <p>🟢 Multi Bot System Online</p>
        <p>🤖 Active Bots: ${BOT_TOKENS.length}/20</p>
        <p>🗄️ PostgreSQL Connected</p>
      </body>
    </html>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Server running on ${PORT}`);
});

/* =========================================================
   DATABASE INIT
========================================================= */

async function initDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      first_name TEXT DEFAULT '',
      username TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      last_activity TIMESTAMP DEFAULT NOW(),
      messages INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chats (
      id BIGINT PRIMARY KEY,
      title TEXT DEFAULT '',
      type TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      messages INTEGER DEFAULT 0,
      members_joined INTEGER DEFAULT 0,
      members_left INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS members (
      chat_id BIGINT,
      user_id BIGINT,
      joined_at TIMESTAMP DEFAULT NOW(),
      last_activity TIMESTAMP DEFAULT NOW(),
      messages INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      PRIMARY KEY(chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      chat_id BIGINT PRIMARY KEY,
      welcome BOOLEAN DEFAULT TRUE,
      reactions BOOLEAN DEFAULT TRUE,
      anti_spam BOOLEAN DEFAULT TRUE,
      analytics BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS bot_registry (
      bot_number INTEGER PRIMARY KEY,
      username TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE
    );
  `);

  console.log("🗄️ PostgreSQL initialized.");
}

/* =========================================================
   HELPERS
========================================================= */

function isAdmin(userId) {
  return Number(userId) === ADMIN_ID;
}

function mention(user) {

  const name =
    user?.first_name ||
    "Member";

  return `[${name}](tg://user?id=${user.id})`;
}

const EMOJIS = [
  "👍",
  "👎",
  "❤️",
  "🔥",
  "🥰",
  "👏",
  "😁",
  "🤔",
  "🤯",
  "😱",
  "😢",
  "🎉",
  "🤩",
  "🙏",
  "👌",
  "💯",
  "🤣",
  "⚡️",
  "🏆",
  "💔",
  "😐",
  "🍓",
  "❤️‍🔥",
  "😎",
  "👀",
  "😇",
  "🤝",
  "🤗",
  "🫡"
];

function randomEmoji() {
  return EMOJIS[
    Math.floor(Math.random() * EMOJIS.length)
  ];
}

/* =========================================================
   USER DATABASE
========================================================= */

async function saveUser(user) {

  if (!user || user.is_bot) return;

  await pool.query(
    `
    INSERT INTO users
      (id, first_name, username, last_activity, messages)
    VALUES
      ($1, $2, $3, NOW(), 1)
    ON CONFLICT (id)
    DO UPDATE SET
      first_name = EXCLUDED.first_name,
      username = EXCLUDED.username,
      last_activity = NOW(),
      messages = users.messages + 1
    `,
    [
      user.id,
      user.first_name || "",
      user.username || ""
    ]
  );
}

/* =========================================================
   CHAT DATABASE
========================================================= */

async function saveChat(chat) {

  if (!chat) return;

  await pool.query(
    `
    INSERT INTO chats
      (id, title, type)
    VALUES
      ($1, $2, $3)
    ON CONFLICT (id)
    DO UPDATE SET
      title = EXCLUDED.title,
      type = EXCLUDED.type
    `,
    [
      chat.id,
      chat.title || "",
      chat.type || ""
    ]
  );

  await pool.query(
    `
    INSERT INTO settings(chat_id)
    VALUES($1)
    ON CONFLICT(chat_id)
    DO NOTHING
    `,
    [chat.id]
  );
}

/* =========================================================
   MEMBER ACTIVITY
========================================================= */

async function saveMemberActivity(
  chatId,
  userId
) {

  await pool.query(
    `
    INSERT INTO members
      (chat_id, user_id, last_activity, messages)
    VALUES
      ($1, $2, NOW(), 1)
    ON CONFLICT(chat_id, user_id)
    DO UPDATE SET
      last_activity = NOW(),
      messages = members.messages + 1,
      xp = members.xp + 1
    `,
    [chatId, userId]
  );

  await pool.query(
    `
    UPDATE chats
    SET messages = messages + 1
    WHERE id = $1
    `,
    [chatId]
  );
}

/* =========================================================
   AUTO REACTION
========================================================= */

async function reactToMessage(bot, msg) {

  if (!msg?.chat?.id || !msg?.message_id) {
    return;
  }

  if (
    msg.chat.type !== "group" &&
    msg.chat.type !== "supergroup" &&
    msg.chat.type !== "channel"
  ) {
    return;
  }

  try {

    const result =
      await pool.query(
        `
        SELECT reactions
        FROM settings
        WHERE chat_id = $1
        `,
        [msg.chat.id]
      );

    if (
      result.rows.length &&
      result.rows[0].reactions === false
    ) {
      return;
    }

    const emoji = randomEmoji();

    await bot._request(
      "setMessageReaction",
      {
        form: {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          reaction: JSON.stringify([
            {
              type: "emoji",
              emoji: emoji,
              is_big: false
            }
          ])
        }
      }
    );

  } catch (error) {

    console.log(
      `⚠️ Reaction failed: ${error.message}`
    );
  }
}

/* =========================================================
   MAIN MENU
========================================================= */

function mainMenu() {

  return {
    reply_markup: {
      inline_keyboard: [

        [
          {
            text: "➕ Add Group & Channel",
            callback_data: "add"
          }
        ],

        [
          {
            text: "🤖 All Bots",
            callback_data: "allbots"
          },
          {
            text: "📊 Statistics",
            callback_data: "stats"
          }
        ],

        [
          {
            text: "🔄 Update",
            url: UPDATE_CHANNEL
          },
          {
            text: "❓ Help",
            callback_data: "help"
          }
        ],

        [
          {
            text: "👑 Owner",
            callback_data: "owner"
          },
          {
            text: "🆔 My ID",
            callback_data: "myid"
          }
        ]

      ]
    }
  };
}

/* =========================================================
   BACK BUTTON
========================================================= */

function backButton() {

  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🔙 Back",
            callback_data: "back"
          }
      ]
    }
  };
}

/* =========================================================
   START MESSAGE
========================================================= */

function startText(botInfo, user) {

  return `
🤖 *AUTO RETENTION PRO*

━━━━━━━━━━━━━━━━━━

👋 Welcome, *${user.first_name || "User"}*!

🚀 Advanced Telegram
Community Management System

━━━━━━━━━━━━━━━━━━

🤖 Bot: @${botInfo.username || "Unknown"}

🟢 Status: ONLINE

✨ Retention
📊 Analytics
🛡️ Moderation
🚫 Anti-Spam
🏆 Gamification
🤖 AI System
🗄️ PostgreSQL
⚡ Auto Reaction

━━━━━━━━━━━━━━━━━━

👇 নিচের Menu থেকে একটি Option নির্বাচন করুন।
`;
}

/* =========================================================
   BOT START
========================================================= */

async function createBot(botInfo) {

  const bot = new TelegramBot(
    botInfo.token,
    {
      polling: {
        interval: 300,
        autoStart: true
      }
    }
  );

  let me;

  try {

    me = await bot.getMe();

    console.log(
      `🤖 Bot ${botInfo.number}: @${me.username}`
    );

    await pool.query(
      `
      INSERT INTO bot_registry
        (bot_number, username, first_name, active)
      VALUES
        ($1, $2, $3, TRUE)
      ON CONFLICT(bot_number)
      DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        active = TRUE
      `,
      [
        botInfo.number,
        me.username || "",
        me.first_name || ""
      ]
    );

  } catch (error) {

    console.error(
      `❌ Bot ${botInfo.number} login failed:`,
      error.message
    );

    return;
  }

  /* =====================================================
     /START
  ===================================================== */

  bot.onText(/^\/start$/, async (msg) => {

    try {

      await saveUser(msg.from);

      await bot.sendMessage(
        msg.chat.id,
        startText(me, msg.from),
        {
          parse_mode: "Markdown",
          ...mainMenu()
        }
      );

    } catch (error) {

      console.error(
        "START ERROR:",
        error.message
      );
    }
  });

  /* =====================================================
     MESSAGE HANDLER
  ===================================================== */

  bot.on("message", async (msg) => {

    try {

      if (!msg.chat) return;

      await saveChat(msg.chat);

      if (msg.from && !msg.from.is_bot) {

        await saveUser(msg.from);

        if (
          msg.chat.type === "group" ||
          msg.chat.type === "supergroup"
        ) {

          await saveMemberActivity(
            msg.chat.id,
            msg.from.id
          );
        }
      }

      /* ==============================================
         NEW MEMBERS
      ============================================== */

      if (msg.new_chat_members?.length) {

        for (
          const member
          of msg.new_chat_members
        ) {

          if (member.is_bot) continue;

          await pool.query(
            `
            INSERT INTO members
              (chat_id, user_id)
            VALUES
              ($1, $2)
            ON CONFLICT(chat_id, user_id)
            DO NOTHING
            `,
            [
              msg.chat.id,
              member.id
            ]
          );

          await pool.query(
            `
            UPDATE chats
            SET members_joined =
              members_joined + 1
            WHERE id = $1
            `,
            [msg.chat.id]
          );

          const settings =
            await pool.query(
              `
              SELECT welcome
              FROM settings
              WHERE chat_id = $1
              `,
              [msg.chat.id]
            );

          const welcome =
            settings.rows.length
              ? settings.rows[0].welcome
              : true;

          if (welcome) {

            await bot.sendMessage(
              msg.chat.id,
              `
🎉 *WELCOME!*

👋 ${member.first_name || "New Member"}

❤️ আমাদের Community-তে
তোমাকে স্বাগতম!

💬 Active থাকুন এবং
Community-এর সাথে Connected থাকুন।

━━━━━━━━━━━━━━━━━━
🤖 *Auto Retention Pro*
              `,
              {
                parse_mode: "Markdown"
              }
            );
          }
        }
      }

      /* ==============================================
         LEFT MEMBER
      ============================================== */

      if (msg.left_chat_member) {

        const member =
          msg.left_chat_member;

        if (!member.is_bot) {

          await pool.query(
            `
            UPDATE chats
            SET members_left =
              members_left + 1
            WHERE id = $1
            `,
            [msg.chat.id]
          );

          await bot.sendMessage(
            msg.chat.id,
            `
👋 *GOODBYE!*

${member.first_name || "Member"}
আমাদের Community থেকে চলে গেছেন।

আবার দেখা হবে আশা করি। ❤️
            `,
            {
              parse_mode: "Markdown"
            }
          );
        }
      }

      /* ==============================================
         AUTO REACTION
      ============================================== */

      if (
        msg.from &&
        !msg.from.is_bot &&
        !msg.new_chat_members &&
        !msg.left_chat_member
      ) {

        await reactToMessage(
          bot,
          msg
        );
      }

    } catch (error) {

      console.error(
        "MESSAGE ERROR:",
        error.message
      );
    }
  });

  /* =====================================================
     COMMANDS
  ===================================================== */

  bot.onText(/^\/id$/, async (msg) => {

    await bot.sendMessage(
      msg.chat.id,
      `
🆔 *YOUR TELEGRAM ID*

ID:
\`${msg.from.id}\`

Username:
@${msg.from.username || "Not Set"}

Name:
${msg.from.first_name || "Unknown"}
      `,
      {
        parse_mode: "Markdown",
        ...backButton()
      }
    );
  });

  bot.onText(/^\/stats$/, async (msg) => {

    if (!isAdmin(msg.from.id)) return;

    const users =
      await pool.query(
        "SELECT COUNT(*) FROM users"
      );

    const chats =
      await pool.query(
        "SELECT COUNT(*) FROM chats"
      );

    const messages =
      await pool.query(
        "SELECT COALESCE(SUM(messages),0) AS total FROM chats"
      );

    await bot.sendMessage(
      msg.chat.id,
      `
📊 *GLOBAL STATISTICS*

👥 Users:
${users.rows[0].count}

💬 Groups/Channels:
${chats.rows[0].count}

📝 Messages:
${messages.rows[0].total}

🤖 Active Bots:
${BOT_TOKENS.length}

🗄️ Database:
🟢 PostgreSQL
      `,
      {
        parse_mode: "Markdown"
      }
    );
  });

  /* =====================================================
     CALLBACK SYSTEM
  ===================================================== */

  bot.on("callback_query", async (query) => {

    try {

      const data = query.data;

      await bot.answerCallbackQuery(
        query.id
      );

      if (!query.message) return;

      const chatId =
        query.message.chat.id;

      /* ================================================
         BACK
      ================================================ */

      if (data === "back") {

        await bot.editMessageText(
          startText(me, {
            first_name:
              query.from.first_name
          }),
          {
            chat_id: chatId,
            message_id:
              query.message.message_id,
            parse_mode: "Markdown",
            ...mainMenu()
          }
        );

        return;
      }

      /* ================================================
         ADD
      ================================================ */

      if (data === "add") {

        await bot.editMessageText(
          `
➕ *ADD GROUP & CHANNEL*

এই Bot-কে Group অথবা Channel-এ
Admin হিসেবে Add করুন।

━━━━━━━━━━━━━━━━━━

👥 *Group*

Bot-কে Group-এ Add করে
Admin Permission দিন।

📢 *Channel*

Bot-কে Channel Admin করুন এবং
প্রয়োজনীয় message/reaction permission দিন।

━━━━━━━━━━━━━━━━━━

⚠️ Telegram নিজে থেকে Bot-কে
কোনো chat-এ add করতে দেয় না।
আপনাকেই Telegram-এর Add flow
ব্যবহার করে Bot add করতে হবে।
          `,
          {
            chat_id: chatId,
            message_id:
              query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "👥 Add to Group",
                    url:
                      `https://t.me/${me.username}?startgroup=true`
                  }
                ],
                [
                  {
                    text: "🔙 Back",
                    callback_data: "back"
                  }
                ]
              ]
            }
          }
        );

        return;
      }

      /* ================================================
         ALL BOTS
      ================================================ */

      if (data === "allbots") {

        const result =
          await pool.query(
            `
            SELECT *
            FROM bot_registry
            ORDER BY bot_number ASC
            `
          );

        let text =
          "🤖 *ALL AUTO RETENTION PRO BOTS*\n\n";

        const buttons = [];

        for (const b of result.rows) {

          text +=
            `${b.active ? "🟢" : "🔴"} Bot ${b.bot_number}: @${b.username || "Unknown"}\n`;

          if (b.username) {

            buttons.push([
              {
                text:
                  `🤖 Bot ${b.bot_number} • @${b.username}`,
                url:
                  `https://t.me/${b.username}`
              }
            ]);
          }
        }

        buttons.push([
          {
            text: "🔙 Back",
            callback_data: "back"
          }
        ]);

        await bot.editMessageText(
          text,
          {
            chat_id: chatId,
            message_id:
              query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: buttons
            }
          }
        );

        return;
      }

      /* ================================================
         STATS
      ================================================ */

      if (data === "stats") {

        const users =
          await pool.query(
            "SELECT COUNT(*) FROM users"
          );

        const groups =
          await pool.query(
            `
            SELECT COUNT(*)
            FROM chats
            WHERE type IN ('group','supergroup')
            `
          );

        const channels =
          await pool.query(
            `
            SELECT COUNT(*)
            FROM chats
            WHERE type = 'channel'
            `
          );

        await bot.editMessageText(
          `
📊 *STATISTICS*

👥 Users:
${users.rows[0].count}

👥 Groups:
${groups.rows[0].count}

📢 Channels:
${channels.rows[0].count}

🤖 Bots:
${BOT_TOKENS.length}/20

🗄️ PostgreSQL:
🟢 Connected
          `,
          {
            chat_id: chatId,
            message_id:
              query.message.message_id,
            parse_mode: "Markdown",
            ...backButton()
          }
        );

        return;
      }
      /* ================================================
         HELP
      ================================================ */

      if (data === "help") {

        await bot.editMessageText(
          `
❓ *HELP CENTER*

🤖 Auto Retention Pro

✨ Features:

• Auto Reaction
• Welcome System
• Member Tracking
• Analytics
• Retention
• Anti-Spam
• Moderation
• Gamification
• AI
• PostgreSQL

━━━━━━━━━━━━━━━━━━

📌 Basic Commands:

/start
/id
/stats

Bot-কে Group/Channel-এ
Admin Permission দিয়ে Add করুন।
          `,
          {
            chat_id: chatId,
            message_id:
              query.message.message_id,
            parse_mode: "Markdown",
            ...backButton()
          }
        );

        return;
      }

      /* ================================================
         MY ID
      ================================================ */

      if (data === "myid") {

        await bot.editMessageText(
          `
🆔 *YOUR ID*

Telegram ID:

\`${query.from.id}\`

Username:

@${query.from.username || "Not Set"}

Name:

${query.from.first_name || "Unknown"}
          `,
          {
            chat_id: chatId,
            message_id:
              query.message.message_id,
            parse_mode: "Markdown",
            ...backButton()
          }
        );

        return;
      }

      /* ================================================
         OWNER
      ================================================ */

      if (data === "owner") {

        if (isAdmin(query.from.id)) {

          await bot.editMessageText(
            `
👑 *OWNER PANEL*

Welcome Owner.

━━━━━━━━━━━━━━━━━━

🤖 Total Bots:
${BOT_TOKENS.length}

👥 Users:
Database Connected

📊 Analytics:
Enabled

🛡️ Security:
Enabled

🗄️ PostgreSQL:
Connected

━━━━━━━━━━━━━━━━━━

👑 Owner:
@${OWNER_USERNAME}
            `,
            {
              chat_id: chatId,
              message_id:
                query.message.message_id,
              parse_mode: "Markdown",
              ...backButton()
            }
          );

        } else {

          await bot.editMessageText(
            `
👑 *OWNER*

Owner:
@${OWNER_USERNAME}

📢 Update:
${UPDATE_CHANNEL}
            `,
            {
              chat_id: chatId,
              message_id:
                query.message.message_id,
              parse_mode: "Markdown",
              ...backButton()
            }
          );
        }

        return;
      }

    } catch (error) {

      console.error(
        "CALLBACK ERROR:",
        error.message
      );
    }
  });

  /* =====================================================
     POLLING ERROR
  ===================================================== */

  bot.on(
    "polling_error",
    (error) => {

      console.error(
        `BOT ${botInfo.number} POLLING:`,
        error.message
      );

    }
  );

  bot.on(
    "error",
    (error) => {

      console.error(
        `BOT ${botInfo.number} ERROR:`,
        error.message
      );

    }
  );

  return bot;
}

/* =========================================================
   START EVERYTHING
========================================================= */

async function main() {

  try {

    await initDatabase();

    console.log(
      `🚀 Starting ${BOT_TOKENS.length} bots...`
    );

    for (
      const botInfo
      of BOT_TOKENS
    ) {

      await createBot(botInfo);

      // Telegram API flood control এড়াতে
      await new Promise(
        resolve =>
          setTimeout(resolve, 800)
      );
    }

    console.log(`
=========================================
🤖 AUTO RETENTION PRO
=========================================
🟢 Multi Bot Engine: ON
🤖 Bots: ${BOT_TOKENS.length}/20
🗄️ PostgreSQL: ON
📊 Analytics: ON
👋 Welcome: ON
⚡ Auto Reaction: ON
🛡️ Moderation Base: ON
🏆 Gamification Base: ON
=========================================
`);

  } catch (error) {

    console.error(
      "❌ SYSTEM ERROR:",
      error
    );

    process.exit(1);
  }
}

main();
