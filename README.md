# Telegram Support Bot

Minimal Node.js Telegram support bot for a moderator workflow.

## Setup

1. Install dependencies:
   npm install
2. Copy `.env.example` to `.env` and fill actual values.
3. Start the bot:
   npm start

## Features

- Private user questions are forwarded to the moderator group.
- Moderators can answer via a reply in the group.
- Moderators can ban users with the group command or inline button.
- Group moderation commands are available only in the moderator group.
- Media and other message types are forwarded as-is.
