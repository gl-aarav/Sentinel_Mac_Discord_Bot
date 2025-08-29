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
  ],
  partials: [Partials.Channel],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
    chunks.push(message.slice(0, 2000));
    message = message.slice(2000);
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
        opt.setName("text")
          .setDescription("The new context for the AI.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("addrole")
      .setDescription("Assigns a role to a user.")
      .addRoleOption(option =>
        opt.setName("role")
          .setDescription("The role to add.")
          .setRequired(true)
      )
      .addUserOption(option =>
        opt.setName("user")
          .setDescription("The user to give the role to.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("removerole")
      .setDescription("Removes a role from a user.")
      .addRoleOption(option =>
        opt.setName("role")
          .setDescription("The role to remove.")
          .setRequired(true)
      )
      .addUserOption(option =>
        opt.setName("user")
          .setDescription("The user to remove the role from.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createrole")
      .setDescription("Creates a new role.")
      .addStringOption(option =>
        opt.setName("name")
          .setDescription("The name for the new role.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deleterole")
      .setDescription("Deletes a role.")
      .addRoleOption(option =>
        opt.setName("name")
          .setDescription("The role to delete.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("renamerole")
      .setDescription("Renames an existing role.")
      .addRoleOption(option =>
        opt.setName("old_name")
          .setDescription("The role to rename.")
          .setRequired(true)
      )
      .addStringOption(option =>
        opt.setName("new_name")
          .setDescription("The new name for the role.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createchannel")
      .setDescription("Creates a new text channel.")
      .addStringOption(option =>
        opt.setName("name")
          .setDescription("The name for the new channel.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("deletechannel")
      .setDescription("Deletes a text channel.")
      .addChannelOption(option =>
        opt.setName("channel")
          .setDescription("The channel to delete.")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("createprivatechannel")
      .setDescription("Creates a private text channel for a user and admins.")
      .addUserOption(option =>
        opt.setName("user")
          .setDescription("The user to create the private channel for.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("senddm")
      .setDescription("Sends a direct message to a user.")
      .addUserOption(option =>
        opt.setName("user")
          .setDescription("The user to send the DM to.")
          .setRequired(true)
      )
      .addStringOption(option =>
        opt.setName("message")
          .setDescription("The message to send.")
          .setRequired(true)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Adds the 'Students' role to a user.")
      .addUserOption(option =>
        opt.setName("usr")
          .setDescription("The user to add the role to.")
          .setRequired(true)
      )
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

Message Commands (Admin Only):
!help                          → Show this help message

Slash Commands (Admin Only, most are ephemeral):
/help                          → Show this help message
/setcontext <text>             → Update AI response behavior
/addrole <role> <user>         → Assign a role to a user
/removerole <role> <user>      → Remove a role from a user
/createrole <name>             → Create a new role
/deleterole <name>             → Delete a role
/renamerole <old_name> <new_name> → Rename a role
/createchannel <name>          → Create a text channel
/deletechannel <#channel>      → Delete a text channel
/createprivatechannel <user>   → Private channel for a user + Admins
/senddm <user> <message>       → Send a DM to a user
/delete <amount>               → Delete 1–100 recent messages
/deleteall                     → Purge recent messages
/verify usr                    → Add the "Students" role to a user
\`\`\`
`;
    return interaction.reply({ content: helpMessage, ephemeral: true });
  }

  // Admin-only slash commands
  if (!isUserAdmin) {
    const adminCommands = ["setcontext", "addrole", "removerole", "createrole", "deleterole", "renamerole", "createchannel", "deletechannel", "createprivatechannel", "senddm", "delete", "deleteall", "verify"];
    if (adminCommands.includes(interaction.commandName)) {
      return interaction.reply({ content: "❌ You don’t have permission to use this command.", ephemeral: true });
    }
  }

  switch (interaction.commandName) {
    case "setcontext": {
      const newContext = interaction.options.getString("text");
      contextPrompt = newContext;
      return interaction.reply({ content: "✅ AI context updated successfully!", ephemeral: true });
    }
    case "addrole": {
      const role = interaction.options.getRole("role");
      const member = interaction.options.getMember("user");
      if (!role || !member) return interaction.reply({ content: "❌ Role or user not found.", ephemeral: true });
      await member.roles.add(role);
      return interaction.reply({ content: `✅ Added ${role.name} to ${member.user.tag}.`, ephemeral: true });
    }
    case "removerole": {
      const role = interaction.options.getRole("role");
      const member = interaction.options.getMember("user");
      if (!role || !member) return interaction.reply({ content: "❌ Role or user not found.", ephemeral: true });
      await member.roles.remove(role);
      return interaction.reply({ content: `✅ Removed ${role.name} from ${member.user.tag}.`, ephemeral: true });
    }
    case "createrole": {
      const roleName = interaction.options.getString("name");
      await interaction.guild.roles.create({ name: roleName });
      return interaction.reply({ content: `✅ Role "${roleName}" created.`, ephemeral: true });
    }
    case "deleterole": {
      const role = interaction.options.getRole("name");
      await role.delete();
      return interaction.reply({ content: `✅ Role "${role.name}" deleted.`, ephemeral: true });
    }
    case "renamerole": {
      const oldRole = interaction.options.getRole("old_name");
      const newName = interaction.options.getString("new_name");
      await oldRole.setName(newName);
      return interaction.reply({ content: `✅ Renamed "${oldRole.name}" to "${newName}".`, ephemeral: true });
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

Message Commands (Admin Only):
!help                          → Show this help message

Slash Commands (Admin Only, most are ephemeral):
/help                          → Show this help message
/setcontext <text>             → Update AI response behavior
/addrole <role> <user>         → Assign a role to a user
/removerole <role> <user>      → Remove a role from a user
/createrole <name>             → Create a new role
/deleterole <name>             → Delete a role
/renamerole <old_name> <new_name> → Rename a role
/createchannel <name>          → Create a text channel
/deletechannel <#channel>      → Delete a text channel
/createprivatechannel <user>   → Private channel for a user + Admins
/senddm <user> <message>       → Send a DM to a user
/delete <amount>               → Delete 1–100 recent messages
/deleteall                     → Purge recent messages
/verify usr                    → Add the "Students" role to a user
\`\`\`
`;
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