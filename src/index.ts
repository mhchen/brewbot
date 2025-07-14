import {
  Client,
  GatewayIntentBits,
  Message,
  User,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
  MessageFlags,
  GuildMemberRoleManager,
} from 'discord.js';
import { Pool } from 'pg';
import { stringify } from 'csv-stringify';
import { writeFileSync } from 'fs';

const MIKE_USER_ID = '356482549549236225';
const BREWBOT_USER_ID = '1386052929072398366';

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 0,
  ssl: {
    rejectUnauthorized: false,
  },
});

db.query(
  `
  CREATE TABLE IF NOT EXISTS coffee_chats (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    participant_1_user_id TEXT NOT NULL,
    participant_2_user_id TEXT NOT NULL,
    discord_message_id TEXT NOT NULL
  )
`
).catch(console.error);

db.query(
  `
  CREATE TABLE IF NOT EXISTS discord_users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    username TEXT NOT NULL
  )
`
).catch(console.error);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('brewbot')
    .setDescription('BrewBot commands')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('report')
        .setDescription('Generate a CSV report of coffee chat statistics')
    ),
];

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
    console.log(
      `Coffee chat already exists between users ${participant1} and ${participant2}, skipping duplicate`
    );
    return false;
  }

  await db.query(
    'INSERT INTO coffee_chats (participant_1_user_id, participant_2_user_id, discord_message_id) VALUES ($1, $2, $3)',
    [participant1, participant2, messageId]
  );
  return true;
};

const getCoffeeChatStats = async () => {
  const query = `
    SELECT 
      u.user_id,
      u.username,
      u.display_name,
      COUNT(*) as chat_count
    FROM discord_users u
    JOIN (
      SELECT participant_1_user_id as user_id FROM coffee_chats
      UNION ALL
      SELECT participant_2_user_id as user_id FROM coffee_chats
    ) c ON u.user_id = c.user_id
    GROUP BY u.user_id, u.username, u.display_name
    ORDER BY chat_count DESC, u.username ASC
  `;

  const result = await db.query(query);
  return result.rows;
};

function parseMessage(message: Message): { mentionedUser: User } | null {
  const mentions = message.mentions.users;
  // Get unique user IDs to deduplicate mentions of the same user
  const uniqueUserIds = Array.from(new Set(mentions.keys()));
  
  if (uniqueUserIds.length !== 2) {
    return null;
  }


  const wasBrewbotMentioned = uniqueUserIds.includes(BREWBOT_USER_ID);
  if (!wasBrewbotMentioned) {
    return null;
  }

  const otherUserId = uniqueUserIds.find((userId) => userId !== BREWBOT_USER_ID);
  if (!otherUserId || otherUserId === message.author.id) {
    return null;
  }

  const otherUser = mentions.get(otherUserId);
  if (!otherUser) {
    return null;
  }

  return { mentionedUser: otherUser };
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}!`);

  try {
    console.log('Started refreshing application (/) commands.');

    await client.application?.commands.set(commands);

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error refreshing commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'brewbot') {
    if (interaction.options.getSubcommand() === 'report') {
      const member = interaction.member;
      const isMod = (member?.roles as GuildMemberRoleManager).cache.has(
        process.env.MODS_ROLE_ID!
      );
      const isMike = interaction.user.id === MIKE_USER_ID;

      if (!isMod && !isMike) {
        await interaction.reply({
          content: 'You do not have permission to generate reports.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const stats = await getCoffeeChatStats();

        if (stats.length === 0) {
          await interaction.editReply('No coffee chats found in the database.');
          return;
        }

        const csvData = [
          ['Username', 'Display name', '# coffee chats', 'User ID'],
          ...stats.map((row) => [
            row.username,
            row.display_name,
            row.chat_count,
            row.user_id,
          ]),
        ];

        const csvString = await new Promise<string>((resolve, reject) => {
          stringify(csvData, (err, output) => {
            if (err) reject(err);
            else resolve(output);
          });
        });

        writeFileSync('/tmp/coffee_chats_report.csv', csvString);

        const attachment = new AttachmentBuilder(
          '/tmp/coffee_chats_report.csv',
          {
            name: 'coffee_chats_report.csv',
          }
        );

        await interaction.editReply({
          content: `Generated report with ${stats.length} users who have participated in coffee chats.`,
          files: [attachment],
        });
      } catch (error) {
        console.error('Error generating report:', error);
        await interaction.editReply(
          'Error generating report. Please try again.'
        );
      }
    }
  }
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;

  if (message.channelId !== process.env.COFFEE_CHAT_CHANNEL_ID) return;

  const wasBrewbotMentioned = message.mentions.users.has(BREWBOT_USER_ID);

  const parsed = parseMessage(message);
  if (!parsed) {
    if (wasBrewbotMentioned) {
      await message.react('❌');
    }
    return;
  }

  try {
    const mentionedUser = parsed.mentionedUser;

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
      parsed.mentionedUser.id,
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
