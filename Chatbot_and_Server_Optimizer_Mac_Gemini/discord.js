// ==================== Express / Webserver ====================
const express = require("express");
const app = express();
const path = require("path");

app.use(express.static("public"));

app.get("/run", (req, res) => {
  console.log("Run button clicked!");
  res.send("✅ Run action triggered!");
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ==================== Discord & Gemini Setup ====================
require("dotenv").config({ path: "./ai_bot.env" });
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  Partials,
} = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const ADMIN_ROLE = "Admin";

// Default AI context
let contextPrompt = "You are a helpful assistant that provides concise initial answers.";

// ==================== Helpers ====================
function isAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function splitMessage(message) {
  const chunks = [];
  while (message.length > 0) {
    let chunk = message.slice(0,1605);

    // Prefer to cut at the last newline if one exists in this chunk
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline !== -1 && message.length > 2000) {
      chunk = chunk.slice(0, lastNewline);
    }

    chunks.push(chunk);
    message = message.slice(chunk.length);
  }
  return chunks;
}

function getRole(guild, roleArg) {
  if (!roleArg) return null;
  const mentionMatch = roleArg.match(/^<@&(\d+)>$/);
  if (mentionMatch) return guild.roles.cache.get(mentionMatch[1]);
  return guild.roles.cache.find(
    (r) => r.name.toLowerCase() === roleArg.toLowerCase()
  );
}

function getMember(guild, userArg) {
  if (!userArg) return null;
  const mentionMatch = userArg.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return guild.members.cache.get(mentionMatch[1]);
  return guild.members.cache.find(
    (m) =>
      m.user.username.toLowerCase() === userArg.toLowerCase() ||
      (m.nickname && m.nickname.toLowerCase() === userArg.toLowerCase())
  );
}

function getChannel(guild, channelArg) {
  if (!channelArg) return null;
  const mentionMatch = channelArg.match(/^<#(\d+)>$/);
  if (mentionMatch) return guild.channels.cache.get(mentionMatch[1]);
  return guild.channels.cache.find(
    (c) => c.name.toLowerCase() === channelArg.toLowerCase()
  );
}

// Utility: check perms in a channel for the bot
function botPermsIn(channel) {
  return channel.guild.members.me.permissionsIn(channel);
}

// ==================== Bot Ready ====================
client.once("ready", async () => {
  console.log(`${client.user.tag} is online!`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName("delete")
      .setDescription("Delete a number of recent messages in this channel (1–100, <14 days)")
      .addIntegerOption(opt =>
        opt.setName("amount")
          .setDescription("Number of messages to delete (1–100)")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("getcontext")
      .setDescription("Displays the AI's current context.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deleteall")
      .setDescription("Delete all messages in this channel (handles 14-day limit; may nuke channel)")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Shows a list of all available commands.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("setcontext")
      .setDescription("Updates the AI's response behavior/context.")
      .addStringOption(option =>
        option.setName("text")
          .setDescription("The new context for the AI.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("addrole")
      .setDescription("Assigns a role to a user.")
      .addRoleOption(option =>
        option.setName("role")
          .setDescription("The role to add.")
          .setRequired(true)
      )
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to give the role to.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("removerole")
      .setDescription("Removes a role from a user.")
      .addRoleOption(option =>
        option.setName("role")
          .setDescription("The role to remove.")
          .setRequired(true)
      )
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to remove the role from.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createrole")
      .setDescription("Creates a new role.")
      .addStringOption(option =>
        option.setName("name")
          .setDescription("The name for the new role.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deleterole")
      .setDescription("Deletes a role.")
      .addRoleOption(option =>
        option.setName("name")
          .setDescription("The role to delete.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("renamerole")
      .setDescription("Renames an existing role.")
      .addRoleOption(option =>
        option.setName("old_name")
          .setDescription("The role to rename.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("new_name")
          .setDescription("The new name for the role.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createchannel")
      .setDescription("Creates a new text channel.")
      .addStringOption(option =>
        option.setName("name")
          .setDescription("The name for the new channel.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deletechannel")
      .setDescription("Deletes a text channel.")
      .addChannelOption(option =>
        option.setName("channel")
          .setDescription("The channel to delete.")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createprivatechannel")
      .setDescription("Creates a private text channel for a user and admins.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to create the private channel for.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("senddm")
      .setDescription("Sends a direct message to a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to send the DM to.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("message")
          .setDescription("The message to send.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Adds the 'Students' role to a user.")
      .addUserOption(option =>
        option.setName("usr")
          .setDescription("The user to add the role to.")
          .setRequired(true)
      )
      .toJSON(),
    // ➕ New Moderation Commands
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kicks a user from the server.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to kick.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the kick.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Bans a user from the server.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to ban.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the ban.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Times out a user for a specified duration.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to time out.")
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName("duration")
          .setDescription("Duration in minutes (e.g., 60 for 1 hour).")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the timeout.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("untimeout")
      .setDescription("Removes a timeout from a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to remove the timeout from.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Mutes a user (prevents them from sending messages).")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to mute.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("unmute")
      .setDescription("Unmutes a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to unmute.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Issues a warning to a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to warn.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the warning.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("nick")
      .setDescription("Changes a user's nickname.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to change the nickname of.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("nickname")
          .setDescription("The new nickname.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("slowmode")
      .setDescription("Sets the slowmode for the current channel.")
      .addIntegerOption(option =>
        option.setName("duration")
          .setDescription("Slowmode duration in seconds (0 to disable).")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("lock")
      .setDescription("Locks a channel, preventing non-admin users from sending messages.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Unlocks a channel, allowing non-admin users to send messages.")
      .toJSON(),

    // ➕ New AI Commands
    new SlashCommandBuilder()
      .setName("summarize")
      .setDescription("Summarizes a specified number of recent messages.")
      .addIntegerOption(option =>
        option.setName("amount")
          .setDescription("The number of messages to summarize (1-50).")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("askquestion")
      .setDescription("Ask the Gemini AI model a question with context.")
      .addStringOption(option =>
        option.setName("question")
          .setDescription("The question to ask Gemini.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Checks the bot's latency.")
      .toJSON(),

    // ➕ New Utility & Fun Commands
    new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Displays information about a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to get info about.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Displays information about the server.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("avatar")
      .setDescription("Gets the avatar of a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to get the avatar of.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("embed")
      .setDescription("Sends a custom embed message.")
      .addStringOption(option =>
        option.setName("title")
          .setDescription("The title of the embed.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("description")
          .setDescription("The description of the embed.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("color")
          .setDescription("The color of the embed (hex code, e.g., #0099ff).")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("poll")
      .setDescription("Creates a simple yes/no poll.")
      .addStringOption(option =>
        option.setName("question")
          .setDescription("The question for the poll.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("8ball")
      .setDescription("Answers a yes/no question with a magical 8-ball response.")
      .addStringOption(option =>
        option.setName("question")
          .setDescription("The question for the 8-ball.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("randomfact")
      .setDescription("Gets a random fun fact.")
      .toJSON(),
  ];

  try {
    const guilds = client.guilds.cache.map(g => g.id);
    for (const gid of guilds) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, gid), { body: commands });
      console.log(`✅ Registered slash commands in guild ${gid}`);
    }
  } catch (err) {
    console.error("Error registering slash commands:", err);
  }
});

client.on("guildCreate", async (guild) => {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName("delete")
      .setDescription("Delete a number of recent messages in this channel (1–100, <14 days)")
      .addIntegerOption(opt =>
        opt.setName("amount")
          .setDescription("Number of messages to delete (1–100)")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deleteall")
      .setDescription("Delete all messages in this channel (handles 14-day limit; may nuke channel)")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Shows a list of all available commands.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("setcontext")
      .setDescription("Updates the AI's response behavior/context.")
      .addStringOption(option =>
        option.setName("text")
          .setDescription("The new context for the AI.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("addrole")
      .setDescription("Assigns a role to a user.")
      .addRoleOption(option =>
        option.setName("role")
          .setDescription("The role to add.")
          .setRequired(true)
      )
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to give the role to.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("removerole")
      .setDescription("Removes a role from a user.")
      .addRoleOption(option =>
        option.setName("role")
          .setDescription("The role to remove.")
          .setRequired(true)
      )
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to remove the role from.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createrole")
      .setDescription("Creates a new role.")
      .addStringOption(option =>
        option.setName("name")
          .setDescription("The name for the new role.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deleterole")
      .setDescription("Deletes a role.")
      .addRoleOption(option =>
        option.setName("name")
          .setDescription("The role to delete.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("renamerole")
      .setDescription("Renames an existing role.")
      .addRoleOption(option =>
        option.setName("old_name")
          .setDescription("The role to rename.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("new_name")
          .setDescription("The new name for the role.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createchannel")
      .setDescription("Creates a new text channel.")
      .addStringOption(option =>
        option.setName("name")
          .setDescription("The name for the new channel.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deletechannel")
      .setDescription("Deletes a text channel.")
      .addChannelOption(option =>
        option.setName("channel")
          .setDescription("The channel to delete.")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createprivatechannel")
      .setDescription("Creates a private text channel for a user and admins.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to create the private channel for.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("senddm")
      .setDescription("Sends a direct message to a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to send the DM to.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("message")
          .setDescription("The message to send.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Adds the 'Students' role to a user.")
      .addUserOption(option =>
        option.setName("usr")
          .setDescription("The user to add the role to.")
          .setRequired(true)
      )
      .toJSON(),
    // ➕ New Moderation Commands
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kicks a user from the server.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to kick.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the kick.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Bans a user from the server.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to ban.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the ban.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Times out a user for a specified duration.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to time out.")
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName("duration")
          .setDescription("Duration in minutes (e.g., 60 for 1 hour).")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the timeout.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("untimeout")
      .setDescription("Removes a timeout from a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to remove the timeout from.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Mutes a user (prevents them from sending messages).")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to mute.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("unmute")
      .setDescription("Unmutes a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to unmute.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Issues a warning to a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to warn.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason")
          .setDescription("The reason for the warning.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("nick")
      .setDescription("Changes a user's nickname.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to change the nickname of.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("nickname")
          .setDescription("The new nickname.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("slowmode")
      .setDescription("Sets the slowmode for the current channel.")
      .addIntegerOption(option =>
        option.setName("duration")
          .setDescription("Slowmode duration in seconds (0 to disable).")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("lock")
      .setDescription("Locks a channel, preventing non-admin users from sending messages.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Unlocks a channel, allowing non-admin users to send messages.")
      .toJSON(),

    // ➕ New AI Commands
    new SlashCommandBuilder()
      .setName("summarize")
      .setDescription("Summarizes a specified number of recent messages.")
      .addIntegerOption(option =>
        option.setName("amount")
          .setDescription("The number of messages to summarize (1-50).")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("askquestion")
      .setDescription("Ask the Gemini AI model a question with context.")
      .addStringOption(option =>
        option.setName("question")
          .setDescription("The question to ask Gemini.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Checks the bot's latency.")
      .toJSON(),

    // ➕ New Utility & Fun Commands
    new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Displays information about a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to get info about.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Displays information about the server.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("avatar")
      .setDescription("Gets the avatar of a user.")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("The user to get the avatar of.")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("embed")
      .setDescription("Sends a custom embed message.")
      .addStringOption(option =>
        option.setName("title")
          .setDescription("The title of the embed.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("description")
          .setDescription("The description of the embed.")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("color")
          .setDescription("The color of the embed (hex code, e.g., #0099ff).")
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("poll")
      .setDescription("Creates a simple yes/no poll.")
      .addStringOption(option =>
        option.setName("question")
          .setDescription("The question for the poll.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("8ball")
      .setDescription("Answers a yes/no question with a magical 8-ball response.")
      .addStringOption(option =>
        option.setName("question")
          .setDescription("The question for the 8-ball.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("randomfact")
      .setDescription("Gets a random fun fact.")
      .toJSON(),
  ];
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
    console.log(`✅ Registered slash commands in new guild ${guild.id}`);
  } catch (err) {
    console.error(`Error registering slash commands in guild ${guild.id}:`, err);
  }
});

// ==================== Forum Post Auto-Responder ====================
client.on("threadCreate", async (thread) => {
  try {
    if (thread.parent?.name.toLowerCase() !== "questions") return;

    await thread.join();

    const messages = await thread.messages.fetch({ limit: 1 });
    const firstMessage = messages.first();
    if (!firstMessage) return;

    const prompt = `${contextPrompt}\n\nUser asked: ${firstMessage.content}`;
    const result = await model.generateContent(prompt);
    const response = await result.response.text();

    await thread.send(
      `${firstMessage.author}, **AI Response** *(an instructor will respond with a full response within 1 business day)*:\n\n${response}`
    );
  } catch (err) {
    console.error("Error handling forum post:", err);
  }
});

// ==================== Slash Commands Handler ====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "❌ This command can only be used in servers.", ephemeral: true });
  }

  const channel = interaction.channel;
  const perms = botPermsIn(channel);
  const isUserAdmin = isAdmin(interaction.member);

  // Help Command
  if (interaction.commandName === "help") {
    const helpMessage = `
\`\`\`
📘 Available Commands

AI:
!chat <message>                → Ask AI via Gemini (no context)
/setcontext <text>             → Update AI response behavior (Admin)
/getcontext                    → Get AI context (Admin)
/summarize <amount>            → Summarize recent messages (Admin)
/askquestion <question>          → Ask Gemini a question

Moderation (Admin Only):
/kick <user> [reason]          → Kick a user
/ban <user> [reason]           → Ban a user
/timeout <user> <duration>     → Time out a user for a duration
/untimeout <user>              → Remove a timeout
/mute <user>                   → Mute a user
/unmute <user>                 → Unmute a user
/warn <user> <reason>          → Warn a user
/nick <user> <nickname>        → Change a user's nickname
/slowmode <duration>           → Set channel slowmode
/lock                          → Lock a channel
/unlock                        → Unlock a channel
/delete <amount>               → Delete 1–100 recent messages
/deleteall                     → Purge recent messages
/addrole <role> <user>         → Assign a role to a user
/removerole <role> <user>      → Remove a role from a user
/createrole <name>             → Create a new role
/deleterole <name>             → Delete a role
/renamerole <old> <new>        → Rename a role
/createchannel <name>          → Create a text channel
/deletechannel <#channel>      → Delete a text channel
/createprivatechannel <user>   → Private channel for a user + Admins
/senddm <user> <message>       → Send a DM to a user
/verify usr                    → Add the "Students" role to a user \`\`\`
\`\`\`
Utility & Fun:
!help                          → Show this help message
/ping                          → Check bot latency
/userinfo [user]               → Display user info
/serverinfo                    → Display server info
/avatar [user]                 → Get a user's avatar
/embed <title> <desc> [color]  → Send a custom embed
/poll <question>               → Create a yes/no poll
/8ball <question>              → Ask the 8-ball
/randomfact                    → Get a random fact
\`\`\`
`;
    // Fix: Defer reply and split the message to avoid character limit issues
    await interaction.deferReply({ ephemeral: true });
    const helpChunks = splitMessage(helpMessage);
    await interaction.editReply({ content: helpChunks[0] });
    for (let i = 1; i < helpChunks.length; i++) {
        await interaction.followUp({ content: helpChunks[i], ephemeral: true });
    }
    return;
  }

  // Admin-only slash commands
  const adminCommands = ["setcontext", "getcontext", "kick", "ban", "timeout", "untimeout", "mute", "unmute", "warn", "nick", "slowmode", "lock", "unlock", "delete", "deleteall", "addrole", "removerole", "createrole", "deleterole", "renamerole", "createchannel", "deletechannel", "createprivatechannel", "senddm", "verify", "summarize"];
  if (adminCommands.includes(interaction.commandName) && !isUserAdmin) {
    return interaction.reply({ content: "❌ You don’t have permission to use this command.", ephemeral: true });
  }

  switch (interaction.commandName) {
    // Existing commands
    case "setcontext": {
      const newContext = interaction.options.getString("text");
      contextPrompt = newContext;
      return interaction.reply({ content: "✅ AI context updated successfully!", ephemeral: true });
    }
    case "getcontext": {
  if (!isUserAdmin) {
    return interaction.reply({ content: "❌ You don’t have permission to use this command.", ephemeral: true });
  }
  return interaction.reply({ content: `✅ The current AI context is:\n\`\`\`${contextPrompt}\`\`\``, ephemeral: true });
}
    case "addrole": {
      const role = interaction.options.getRole("role");
      const member = interaction.options.getMember("user");
      if (!role || !member) return interaction.reply({ content: "❌ Role or user not found.", ephemeral: true });
      if (interaction.member.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply({ content: "❌ You cannot add a role higher or equal to your own.", ephemeral: true });
      }
      try {
        await member.roles.add(role);
        return interaction.reply({ content: `✅ Added ${role.name} to ${member.user.tag}.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: `❌ Failed to add the role to ${member.user.tag}.`, ephemeral: true });
      }
    }
    case "removerole": {
      const role = interaction.options.getRole("role");
      const member = interaction.options.getMember("user");
      if (!role || !member) return interaction.reply({ content: "❌ Role or user not found.", ephemeral: true });
      if (interaction.member.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply({ content: "❌ You cannot remove a role higher or equal to your own.", ephemeral: true });
      }
      try {
        await member.roles.remove(role);
        return interaction.reply({ content: `✅ Removed ${role.name} from ${member.user.tag}.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: `❌ Failed to remove the role from ${member.user.tag}.`, ephemeral: true });
      }
    }
    case "createrole": {
      const roleName = interaction.options.getString("name");
      try {
        await interaction.guild.roles.create({ name: roleName });
        return interaction.reply({ content: `✅ Role "${roleName}" created.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to create role.", ephemeral: true });
      }
    }
    case "deleterole": {
      const role = interaction.options.getRole("name");
      if (interaction.member.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply({ content: "❌ You cannot delete a role higher or equal to your own.", ephemeral: true });
      }
      try {
        await role.delete();
        return interaction.reply({ content: `✅ Role "${role.name}" deleted.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: `❌ Failed to delete role "${role.name}".`, ephemeral: true });
      }
    }
    case "renamerole": {
      const oldRole = interaction.options.getRole("old_name");
      const newName = interaction.options.getString("new_name");
      if (interaction.member.roles.highest.comparePositionTo(oldRole) <= 0) {
        return interaction.reply({ content: "❌ You cannot rename a role higher or equal to your own.", ephemeral: true });
      }
      try {
        await oldRole.setName(newName);
        return interaction.reply({ content: `✅ Renamed "${oldRole.name}" to "${newName}".`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to rename the role.", ephemeral: true });
      }
    }
    case "createchannel": {
      const name = interaction.options.getString("name");
      try {
        const ch = await interaction.guild.channels.create({
          name,
          type: ChannelType.GuildText,
        });
        return interaction.reply({ content: `✅ Channel created: ${ch.toString()}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to create channel.", ephemeral: true });
      }
    }
    case "deletechannel": {
      const ch = interaction.options.getChannel("channel");
      try {
        await ch.delete();
        return interaction.reply({ content: `✅ Channel deleted: ${ch.name}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to delete channel.", ephemeral: true });
      }
    }
    case "createprivatechannel": {
      const user = interaction.options.getMember("user");
      const adminRole = interaction.guild.roles.cache.find((r) => r.name === ADMIN_ROLE);
      const overwrites = [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ];
      if (adminRole) {
        overwrites.push({
          id: adminRole.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels,
          ],
        });
      }

      try {
        const privateCh = await interaction.guild.channels.create({
          name: `${user.user.username}-private`,
          type: ChannelType.GuildText,
          permissionOverwrites: overwrites,
        });
        return interaction.reply({ content: `✅ Private channel created: ${privateCh.toString()}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to create private channel.", ephemeral: true });
      }
    }
    case "senddm": {
      const member = interaction.options.getMember("user");
      const dmMessage = interaction.options.getString("message");
      try {
        await member.send(dmMessage);
        return interaction.reply({ content: `✅ Sent DM to ${member.user.tag}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: `❌ Could not send DM to ${member.user.tag}. They might have DMs disabled.`, ephemeral: true });
      }
    }
    case "delete": {
      if (!perms.has(PermissionsBitField.Flags.ManageMessages) || !perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        return interaction.reply({
          content: "❌ I need **Manage Messages** and **Read Message History** in this channel.",
          ephemeral: true,
        });
      }
      const amount = interaction.options.getInteger("amount");
      if (amount < 1 || amount > 100) {
        return interaction.reply({
          content: "⚠️ Please provide a number between **1** and **100**.",
          ephemeral: true,
        });
      }
      try {
        const deleted = await channel.bulkDelete(amount, true);
        await interaction.reply({
          content: `✅ Deleted **${deleted.size}** message(s) in ${channel}.`,
          ephemeral: true,
        });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: "❌ Failed to delete messages.", ephemeral: true });
      }
      break;
    }
    case "deleteall": {
      if (!perms.has(PermissionsBitField.Flags.ManageMessages) || !perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        return interaction.reply({
          content: "❌ I need **Manage Messages** and **Read Message History** in this channel.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
      let totalDeleted = 0;

      try {
        while (true) {
          const batch = await channel.messages.fetch({ limit: 100 });
          if (!batch.size) break;
          const now = Date.now();
          const deletable = batch.filter(msg => now - msg.createdTimestamp < FOURTEEN_DAYS);
          if (deletable.size === 0) break;
          const result = await channel.bulkDelete(deletable, true);
          totalDeleted += result.size;
          await new Promise(r => setTimeout(r, 750));
        }

        const leftover = await channel.messages.fetch({ limit: 1 });
        if (leftover.size === 0) {
          return interaction.editReply(`✅ Purged **${totalDeleted}** recent message(s). Channel is now empty.`);
        }

        if (!perms.has(PermissionsBitField.Flags.ManageChannels)) {
          return interaction.editReply(
            `✅ Purged **${totalDeleted}** recent message(s).\n` +
            `⚠️ I can't remove older messages (>14 days). Grant **Manage Channels** if you want me to recreate the channel (nuke).`
          );
        }

        const position = channel.position;
        const parent = channel.parent;
        const newChannel = await channel.clone({
          name: channel.name,
          reason: "Nuke channel to clear messages older than 14 days",
        });

        if (parent) await newChannel.setParent(parent.id, { lockPermissions: true });
        await newChannel.setPosition(position);
        await channel.delete("Nuked to clear messages older than 14 days");
        return interaction.editReply(
          `✅ Purged **${totalDeleted}** recent message(s).\n` +
          `🧨 Older messages couldn't be bulk-deleted, so I **recreated the channel**.\n` +
          `➡️ New channel: ${newChannel}`
        );
      } catch (err) {
        console.error(err);
        return interaction.editReply("❌ Failed to delete all messages (purge or nuke step errored).");
      }
    }
    case "verify": {
      const member = interaction.options.getMember("usr");
      const roleName = "Students";
      const role = interaction.guild.roles.cache.find(r => r.name === roleName);
      if (!role) {
        await interaction.reply({ content: `❌ Role "**${roleName}**" not found.`, ephemeral: true });
        return;
      }
      if (!member) {
        await interaction.reply({ content: `❌ User not found.`, ephemeral: true });
        return;
      }
      try {
        await member.roles.add(role);
        await interaction.reply({ content: `✅ Added the "**Students**" role to ${member.user.username}.` });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: `❌ Failed to add the role to ${member.user.username}.`, ephemeral: true });
      }
      break;
    }

    // ➕ New Moderation Commands
    case "kick": {
      const user = interaction.options.getMember("user");
      const reason = interaction.options.getString("reason") || "No reason provided.";
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      if (user.id === interaction.user.id) return interaction.reply({ content: "❌ You can't kick yourself.", ephemeral: true });
      if (user.roles.highest.position >= interaction.member.roles.highest.position) return interaction.reply({ content: "❌ You cannot kick a user with a higher or equal role.", ephemeral: true });
      try {
        await user.kick(reason);
        return interaction.reply({ content: `✅ Kicked ${user.user.tag}. Reason: ${reason}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to kick user.", ephemeral: true });
      }
    }
    case "ban": {
      const user = interaction.options.getMember("user");
      const reason = interaction.options.getString("reason") || "No reason provided.";
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      if (user.id === interaction.user.id) return interaction.reply({ content: "❌ You can't ban yourself.", ephemeral: true });
      if (user.roles.highest.position >= interaction.member.roles.highest.position) return interaction.reply({ content: "❌ You cannot ban a user with a higher or equal role.", ephemeral: true });
      try {
        await user.ban({ reason });
        return interaction.reply({ content: `✅ Banned ${user.user.tag}. Reason: ${reason}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to ban user.", ephemeral: true });
      }
    }
    case "timeout": {
      const user = interaction.options.getMember("user");
      const duration = interaction.options.getInteger("duration");
      const reason = interaction.options.getString("reason") || "No reason provided.";
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      if (user.id === interaction.user.id) return interaction.reply({ content: "❌ You can't time out yourself.", ephemeral: true });
      if (user.roles.highest.position >= interaction.member.roles.highest.position) return interaction.reply({ content: "❌ You cannot time out a user with a higher or equal role.", ephemeral: true });
      if (duration < 1 || duration > 28 * 24 * 60) return interaction.reply({ content: "❌ Duration must be between 1 minute and 28 days.", ephemeral: true });
      try {
        await user.timeout(duration * 60 * 1000, reason);
        return interaction.reply({ content: `✅ Timed out ${user.user.tag} for ${duration} minutes. Reason: ${reason}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to time out user.", ephemeral: true });
      }
    }
    case "untimeout": {
      const user = interaction.options.getMember("user");
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      try {
        await user.timeout(null);
        return interaction.reply({ content: `✅ Removed timeout from ${user.user.tag}.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to remove timeout.", ephemeral: true });
      }
    }
    case "mute": {
      const user = interaction.options.getMember("user");
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      try {
        const role = await interaction.guild.roles.cache.find(r => r.name === "Muted");
        if (!role) return interaction.reply({ content: "❌ 'Muted' role not found. Please create it first.", ephemeral: true });
        await user.roles.add(role);
        return interaction.reply({ content: `✅ Muted ${user.user.tag}.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to mute user.", ephemeral: true });
      }
    }
    case "unmute": {
      const user = interaction.options.getMember("user");
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      try {
        const role = await interaction.guild.roles.cache.find(r => r.name === "Muted");
        if (!role) return interaction.reply({ content: "❌ 'Muted' role not found.", ephemeral: true });
        await user.roles.remove(role);
        return interaction.reply({ content: `✅ Unmuted ${user.user.tag}.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to unmute user.", ephemeral: true });
      }
    }
    case "warn": {
      const user = interaction.options.getMember("user");
      const reason = interaction.options.getString("reason");
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      try {
        // You would typically store warnings in a database. For this example, we'll send a DM.
        await user.send(`⚠️ You have been warned in ${interaction.guild.name}. Reason: ${reason}`);
        return interaction.reply({ content: `✅ Warned ${user.user.tag}. Reason: ${reason}`, ephemeral: true });
      } catch (err) {
                console.error(err);
        return interaction.reply({ content: "❌ Failed to warn user. They may have DMs disabled.", ephemeral: true });
      }
    }
    case "nick": {
      const user = interaction.options.getMember("user");
      const newNickname = interaction.options.getString("nickname");
      if (!user) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
      if (user.roles.highest.position >= interaction.member.roles.highest.position) return interaction.reply({ content: "❌ You cannot change the nickname of a user with a higher or equal role.", ephemeral: true });
      try {
        await user.setNickname(newNickname);
        return interaction.reply({ content: `✅ Changed ${user.user.tag}'s nickname to "${newNickname}".`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to change nickname.", ephemeral: true });
      }
    }
    case "slowmode": {
      const duration = interaction.options.getInteger("duration");
      if (duration < 0 || duration > 21600) return interaction.reply({ content: "❌ Duration must be between 0 and 21600 seconds.", ephemeral: true });
      try {
        await channel.setRateLimitPerUser(duration);
        if (duration > 0) {
          return interaction.reply({ content: `✅ Slowmode set to ${duration} seconds.`, ephemeral: true });
        } else {
          return interaction.reply({ content: `✅ Slowmode disabled.`, ephemeral: true });
        }
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to set slowmode.", ephemeral: true });
      }
    }
    case "lock": {
      const everyoneRole = interaction.guild.roles.cache.find(r => r.name === "@everyone");
      try {
        await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false });
        return interaction.reply({ content: "✅ Channel locked.", ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to lock channel.", ephemeral: true });
      }
    }
    case "unlock": {
      const everyoneRole = interaction.guild.roles.cache.find(r => r.name === "@everyone");
      try {
        await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: true });
        return interaction.reply({ content: "✅ Channel unlocked.", ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ Failed to unlock channel.", ephemeral: true });
      }
    }

    // ➕ New AI Commands
    case "summarize": {
      await interaction.deferReply();
      const amount = interaction.options.getInteger("amount");
      if (amount < 1 || amount > 50) return interaction.editReply({ content: "❌ Please specify an amount between 1 and 50 messages.", ephemeral: true });
      try {
        const messages = await channel.messages.fetch({ limit: amount });
        const textToSummarize = messages.map(msg => `${msg.author.tag}: ${msg.content}`).reverse().join('\n');
        const prompt = `Summarize the following conversation concisely:\n\n${textToSummarize}`;
        const result = await model.generateContent(prompt);
        const response = await result.response.text();
        splitMessage(response).forEach((chunk) => interaction.editReply(chunk));
      } catch (err) {
        console.error("Error summarizing messages:", err);
        return interaction.editReply({ content: "❌ Failed to summarize messages.", ephemeral: true });
      }
      break;
    }
    case "getcontext": {
      if (!isUserAdmin) {
        return interaction.reply({ content: "❌ You don’t have permission to use this command.", ephemeral: true });
      }
      return interaction.reply({ content: `✅ The current AI context is:\n\`\`\`${contextPrompt}\`\`\``, ephemeral: true });
    }
    case "askquestion": {
      await interaction.deferReply();
      const question = interaction.options.getString("question");
      try {
        const result = await model.generateContent(contextPrompt + `\n\nQuestion: ${question}`);
        const response = await result.response.text();
        interaction.editReply(response);
      } catch (err) {
        console.error("Error asking Gemini:", err);
        interaction.editReply({ content: "❌ An error occurred while asking Gemini.", ephemeral: true });
      }
      break;
    }
    case "ping": {
      const latency = Math.round(client.ws.ping);
      interaction.reply(`🏓 Pong! Latency is ${latency}ms.`);
      break;
    }

    // ➕ New Utility & Fun Commands
    case "userinfo": {
      const user = interaction.options.getMember("user") || interaction.member;
      const embed = {
        color: 0x0099ff,
        title: `${user.user.username}'s Info`,
        thumbnail: { url: user.user.displayAvatarURL({ dynamic: true }) },
        fields: [
          { name: "👤 User", value: `${user.user.tag}`, inline: true },
          { name: "🆔 ID", value: `${user.id}`, inline: true },
          { name: "🗓️ Joined Discord", value: `<t:${Math.floor(user.user.createdTimestamp / 1000)}:f>`, inline: true },
          { name: "🗓️ Joined Server", value: `<t:${Math.floor(user.joinedTimestamp / 1000)}:f>`, inline: true },
          { name: "📝 Roles", value: user.roles.cache.map(r => r.toString()).join(" "), inline: false },
        ],
        footer: { text: `Requested by ${interaction.user.tag}`, icon_url: interaction.user.displayAvatarURL({ dynamic: true }) },
        timestamp: new Date(),
      };
      interaction.reply({ embeds: [embed] });
      break;
    }
    case "serverinfo": {
      const guild = interaction.guild;
      const owner = await guild.fetchOwner();
      const embed = {
        color: 0x0099ff,
        title: `${guild.name} Info`,
        thumbnail: { url: guild.iconURL({ dynamic: true }) },
        fields: [
          { name: "👑 Owner", value: `${owner.user.tag}`, inline: true },
          { name: "🆔 ID", value: `${guild.id}`, inline: true },
          { name: "🗓️ Created On", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:f>`, inline: true },
          { name: "👥 Members", value: `${guild.memberCount}`, inline: true },
          { name: "💬 Channels", value: `${guild.channels.cache.size}`, inline: true },
          { name: "🎭 Roles", value: `${guild.roles.cache.size}`, inline: true },
        ],
        footer: { text: `Requested by ${interaction.user.tag}`, icon_url: interaction.user.displayAvatarURL({ dynamic: true }) },
        timestamp: new Date(),
      };
      interaction.reply({ embeds: [embed] });
      break;
    }
    case "avatar": {
      const user = interaction.options.getUser("user") || interaction.user;
      const embed = {
        title: `${user.username}'s Avatar`,
        color: 0x0099ff,
        image: { url: user.displayAvatarURL({ dynamic: true, size: 1024 }) },
        footer: { text: `Requested by ${interaction.user.tag}`, icon_url: interaction.user.displayAvatarURL({ dynamic: true }) },
        timestamp: new Date(),
      };
      interaction.reply({ embeds: [embed] });
      break;
    }
    case "embed": {
      const title = interaction.options.getString("title");
      const description = interaction.options.getString("description");
      const color = interaction.options.getString("color") || "#0099ff";
      const embed = {
        color: parseInt(color.replace(/^#/, ''), 16),
        title,
        description,
        footer: { text: `Sent by ${interaction.user.tag}`, icon_url: interaction.user.displayAvatarURL({ dynamic: true }) },
        timestamp: new Date(),
      };
      interaction.reply({ embeds: [embed] });
      break;
    }
    case "poll": {
      const question = interaction.options.getString("question");
      const embed = {
        color: 0x0099ff,
        title: "📊 Poll",
        description: `**${question}**\n\n👍 Yes\n👎 No`,
        footer: { text: `Poll by ${interaction.user.tag}`, icon_url: interaction.user.displayAvatarURL({ dynamic: true }) },
        timestamp: new Date(),
      };
      const message = await interaction.reply({ embeds: [embed], fetchReply: true });
      await message.react("👍");
      await message.react("👎");
      break;
    }
    case "8ball": {
      const question = interaction.options.getString("question");
      const responses = [
        "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes, definitely.", "You may rely on it.",
        "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.", "Signs point to yes.",
        "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
        "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."
      ];
      const response = responses[Math.floor(Math.random() * responses.length)];
      interaction.reply(`🎱 **${question}**\n${response}`);
      break;
    }
    case "randomfact": {
      const facts = [
        "A group of flamingos is called a 'flamboyance'.",
        "The shortest war in history was between Britain and Zanzibar on August 27, 1896. Zanzibar surrendered after 38 minutes.",
        "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still edible.",
        "Cows don’t have upper front teeth.",
        "The average person walks the equivalent of five times around the world in their lifetime.",
        "The total weight of all the ants on Earth is estimated to be about the same as the total weight of all the humans on Earth.",
        "The electric eel is not an eel; it's a type of knifefish.",
      ];
      const fact = facts[Math.floor(Math.random() * facts.length)];
      interaction.reply(`💡 **Random Fact:** ${fact}`);
      break;
    }
  }
});

// ==================== Message Commands Handler ====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.type === ChannelType.DM) {
    try {
      const prompt = `${message.content}`;
      const result = await model.generateContent(prompt);
      const response = await result.response.text();
      splitMessage(response).forEach((chunk) => message.channel.send(chunk));
    } catch (err) {
      console.error("Error handling DM:", err);
      message.channel.send("❌ Sorry, something went wrong with the AI.");
    }
    return;
  }

  const args = message.content.trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  const isCommandAllowed = isAdmin(message.member);
  
  if (command !== "!chat" && command !== "!help" && command?.startsWith("!")) {
    if (!isCommandAllowed) {
      return;
    }
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/` instead.");
    return;
  }

  // Help
  if (command === "!help") {
    let helpMessage = `
\`\`\`
📘 Available Commands

AI:
!chat <message>                → Ask AI via Gemini (no context)
/setcontext <text>             → Update AI response behavior (Admin)
/getcontext                    → Get AI context (Admin)
/summarize <amount>            → Summarize recent messages (Admin)
/askquestion <question>          → Ask Gemini a question

Moderation (Admin Only):
/kick <user> [reason]          → Kick a user
/ban <user> [reason]           → Ban a user
/timeout <user> <duration>     → Time out a user for a duration
/untimeout <user>              → Remove a timeout
/mute <user>                   → Mute a user
/unmute <user>                 → Unmute a user
/warn <user> <reason>          → Warn a user
/nick <user> <nickname>        → Change a user's nickname
/slowmode <duration>           → Set channel slowmode
/lock                          → Lock a channel
/unlock                        → Unlock a channel
/delete <amount>               → Delete 1–100 recent messages
/deleteall                     → Purge recent messages
/addrole <role> <user>         → Assign a role to a user
/removerole <role> <user>      → Remove a role from a user
/createrole <name>             → Create a new role
/deleterole <name>             → Delete a role
/renamerole <old> <new>        → Rename a role
/createchannel <name>          → Create a text channel
/deletechannel <#channel>      → Delete a text channel
/createprivatechannel <user>   → Private channel for a user + Admins
/senddm <user> <message>       → Send a DM to a user
/verify usr                    → Add the "Students" role to a user

Utility & Fun:
!help                          → Show this help message
/ping                          → Check bot latency
/userinfo [user]               → Display user info
/serverinfo                    → Display server info
/avatar [user]                 → Get a user's avatar
/embed <title> <desc> [color]  → Send a custom embed
/poll <question>               → Create a yes/no poll
/8ball <question>              → Ask the 8-ball
/randomfact                    → Get a random fact
\`\`\`
`;
    // Fix: Use the existing splitMessage helper to break the long string.
    splitMessage(helpMessage).forEach((msg) => message.channel.send(msg));
  }

  // Chat via Gemini (Corrected)
  if (command === "!chat") {
    const userMention = message.mentions.users.first();
    const channelMention = message.mentions.channels.first();
    
    const prompt = args.filter(arg => !arg.startsWith('<@') && !arg.startsWith('<#')).join(' ');
    
    if (!prompt) {
      return message.channel.send("Usage: !chat <message> [#channel] [@user]");
    }
    const targetChannel = channelMention || message.channel;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response.text();
      let reply = userMention ? `${userMention}, ${response}` : response;
      splitMessage(reply).forEach((chunk) => targetChannel.send(chunk));
    } catch (err) {
      console.error(err);
      message.channel.send("❌ Error while executing AI chat.");
    }
  }

  // Role Commands
  if (command === "!addrole") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/addrole` instead.");
  }

  if (command === "!removerole") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/removerole` instead.");
  }

  if (command === "!createrole") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/createrole` instead.");
  }

  if (command === "!deleterole") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/deleterole` instead.");
  }

  if (command === "!renamerole") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/renamerole` instead.");
  }

  // Channel Commands
  if (command === "!createchannel") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/createchannel` instead.");
  }

  if (command === "!deletechannel") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/deletechannel` instead.");
  }

  // Private Channel
  if (command === "!createprivatechannel") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/createprivatechannel` instead.");
  }

  // Send DM (corrected logic)
  if (command === "!senddm") {
    message.channel.send("❌ This `!` command has been moved to a slash command. Use `/senddm` instead.");
  }
});

// ==================== Login ====================
client.login(process.env.DISCORD_BOT_TOKEN);