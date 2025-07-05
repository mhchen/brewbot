import { Client, GatewayIntentBits, Message } from 'discord.js';
import { Client as PgClient } from 'pg';

const db = new PgClient({
  connectionString: process.env.DATABASE_URL,
});

db.connect();

db.query(`
  CREATE TABLE IF NOT EXISTS coffee_chats (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    participant_1_user_id TEXT NOT NULL,
    participant_2_user_id TEXT NOT NULL,
    discord_message_id TEXT NOT NULL
  )
`);

db.query(`
  CREATE TABLE IF NOT EXISTS discord_users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    username TEXT NOT NULL
  )
`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const upsertDiscordUser = async (
  userId: string,
  displayName: string,
  username: string
) => {
  await db.query(
    'INSERT INTO discord_users (user_id, display_name, username) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET display_name = $2, username = $3',
    [userId, displayName, username]
  );
};

const checkCoffeeChatExists = async (
  participant1: string,
  participant2: string
): Promise<boolean> => {
  const result = await db.query(
    'SELECT 1 FROM coffee_chats WHERE (participant_1_user_id = $1 AND participant_2_user_id = $2) OR (participant_1_user_id = $2 AND participant_2_user_id = $1) LIMIT 1',
    [participant1, participant2]
  );
  return result.rows.length > 0;
};

const insertCoffeeChat = async (
  participant1: string,
  participant2: string,
  messageId: string
) => {
  const exists = await checkCoffeeChatExists(participant1, participant2);
  if (exists) {
    console.log(`Coffee chat already exists between users ${participant1} and ${participant2}, skipping duplicate`);
    return false;
  }
  
  await db.query(
    'INSERT INTO coffee_chats (participant_1_user_id, participant_2_user_id, discord_message_id) VALUES ($1, $2, $3)',
    [participant1, participant2, messageId]
  );
  return true;
};

function parseMessage(message: Message): { mentionedUserId: string } | null {
  const content = message.content.toLowerCase();

  if (!content.includes('chat')) {
    return null;
  }

  const mentions = message.mentions.users;
  if (mentions.size !== 1) {
    return null;
  }

  const mentionedUserId = mentions.first()!.id;

  if (mentionedUserId === message.author.id) {
    return null;
  }

  return { mentionedUserId };
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;

  if (message.channelId !== process.env.COFFEE_CHAT_CHANNEL_ID) return;

  const parsed = parseMessage(message);
  if (!parsed) return;

  try {
    const mentionedUser = message.mentions.users.first()!;

    await upsertDiscordUser(
      message.author.id,
      message.author.displayName || message.author.username,
      message.author.username
    );

    await upsertDiscordUser(
      mentionedUser.id,
      mentionedUser.displayName || mentionedUser.username,
      mentionedUser.username
    );

    const inserted = await insertCoffeeChat(
      message.author.id,
      parsed.mentionedUserId,
      message.id
    );

    if (inserted) {
      await message.react('☕');
    }
  } catch (error) {
    console.error('Error tracking coffee chat:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);
