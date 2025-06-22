import { Client, GatewayIntentBits, Message } from 'discord.js';
import { Database } from 'bun:sqlite';

const db = new Database('coffee_chats.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS coffee_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    participant_1_user_id TEXT NOT NULL,
    participant_2_user_id TEXT NOT NULL,
    discord_message_id TEXT NOT NULL
  )
`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const insertCoffeeChat = db.prepare(`
  INSERT INTO coffee_chats (participant_1_user_id, participant_2_user_id, discord_message_id)
  VALUES (?, ?, ?)
`);

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
  console.log(1);
  if (message.author.bot) return;
  console.log(2);

  if (message.channelId !== process.env.COFFEE_CHAT_CHANNEL_ID) return;
  console.log({
    channelId: message.channelId,
    coffeeChatChannelId: process.env.COFFEE_CHAT_CHANNEL_ID,
  });
  console.log(3);

  const parsed = parseMessage(message);
  if (!parsed) return;

  try {
    insertCoffeeChat.run(message.author.id, parsed.mentionedUserId, message.id);

    await message.react('☕');
  } catch (error) {
    console.error('Error tracking coffee chat:', error);
  }
});

console.log(process.env.DISCORD_TOKEN);
client.login(process.env.DISCORD_TOKEN);
