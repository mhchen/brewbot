# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- Install dependencies: `bun install`
- Run the application: `bun run index.ts`
- TypeScript compilation uses Bun's built-in TypeScript support

## Architecture

This is a Discord bot called "BrewBot" that tracks coffee chat interactions in a specific Discord channel. The bot:

1. **Database**: Uses SQLite via Bun's built-in sqlite module to store coffee chat records
2. **Discord Integration**: Uses discord.js v14 to monitor messages and react to them
3. **Message Processing**: Detects messages containing "chat" with exactly one user mention, excluding self-mentions
4. **Data Storage**: Stores participant IDs and Discord message IDs for each coffee chat interaction

## Key Components

- **Database Schema**: `coffee_chats` table with participants and Discord message references
- **Message Parser**: Filters for "chat" keyword and single user mentions in designated channel
- **Environment Variables**: Requires `DISCORD_TOKEN` and `COFFEE_CHAT_CHANNEL_ID`

## Configuration

The bot requires a `.env` file with Discord bot token and target channel ID. Check `.env.example` for required variables.

## Database

The SQLite database (`coffee_chats.db`) is created automatically and stores all coffee chat interactions with timestamps.