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
} = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const ADMIN_ROLE = "Founder/Admin";

// Default AI context
let contextPrompt = "You are a helpful assistant that provides concise initial answers.";

// ==================== Bot Ready ====================
client.once("ready", () => console.log(`${client.user.tag} is online!`));

// ==================== Helpers ====================
function isAdmin(member) {
  return member.roles.cache.some((r) => r.name === ADMIN_ROLE);
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

// ==================== Command Handler ====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // -------------------- Command Permissions --------------------
  const isCommandAllowed = isAdmin(message.member);
  if (!isCommandAllowed && command.startsWith("!")) return;

  // -------------------- Help Command --------------------
  if (command === "!help") {
  let helpMessage = `
\`\`\`
📘 Available Commands (Founder/Admin Only)

__General Commands__
!help                  → Show this help message
Forum auto-response    → Any user can post in the 'questions' forum and get an AI response automatically

__Admin Commands__
!setcontext <text>     → Update AI response behavior/context
!addrole <role> <user> → Assign a role to a user
!removerole <role> <user> → Remove a role from a user
!createrole <name>     → Create a new role
!deleterole <name>     → Delete a role
!renamerole <oldName> <newName> → Rename a role
!createchannel <name>  → Create a text channel
!deletechannel <#channel> → Delete a text channel
!createprivatechannel @user → Create a private channel for a user + Admins
!sendDM <message> @user → Send a DM to a user

__AI Commands__
!chat <question>       → Ask AI via Gemini in a channel (does NOT use context)
\`\`\`
`;
  splitMessage(helpMessage).forEach((msg) => message.channel.send(msg));
}


  // -------------------- Set AI Context --------------------
  if (command === "!setcontext") {
    const newContext = args.join(" ");
    if (!newContext) return message.channel.send("Usage: !setcontext <new context>");
    contextPrompt = newContext;
    message.channel.send("✅ AI context updated successfully!");
  }

  // -------------------- AI Chat Command --------------------
if (command === "!chat") {
  const userMention = message.mentions.users.first();
  const channelMention = message.mentions.channels.first();

  // Remove mentions from args to get the prompt
  const prompt = args
    .filter((a) => !a.startsWith("<@") && !a.startsWith("<#"))
    .join(" ");

  if (!prompt)
    return message.channel.send(
      "Usage: !chat <message> [#channel/channel-name] [@user]"
    );

  const targetChannel = channelMention || message.channel;

  try {
    // Send prompt directly to Gemini without context
    const result = await model.generateContent(prompt);
    const response = await result.response.text();

    let reply = userMention ? `${userMention}, ${response}` : response;
    splitMessage(reply).forEach((chunk) => targetChannel.send(chunk));
  } catch (err) {
    console.error(err);
    message.channel.send("❌ Error while executing AI chat.");
  }
}


  // -------------------- Role Commands --------------------
  if (command === "!addrole") {
    const roleArg = args[0];
    const userArg = args.slice(1).join(" ");
    const role = getRole(message.guild, roleArg);
    const member = getMember(message.guild, userArg);
    if (!role || !member) return message.channel.send("Usage: !addrole <role> <user>");
    await member.roles.add(role);
    message.channel.send(`✅ Added ${role.name} to ${member.user.tag}`);
  }

  if (command === "!removerole") {
    const roleArg = args[0];
    const userArg = args.slice(1).join(" ");
    const role = getRole(message.guild, roleArg);
    const member = getMember(message.guild, userArg);
    if (!role || !member) return message.channel.send("Usage: !removerole <role> <user>");
    await member.roles.remove(role);
    message.channel.send(`✅ Removed ${role.name} from ${member.user.tag}`);
  }

  if (command === "!createrole") {
    const roleName = args.join(" ");
    if (!roleName) return message.channel.send("Usage: !createrole <name>");
    await message.guild.roles.create({ name: roleName });
    message.channel.send(`✅ Role "${roleName}" created`);
  }

  if (command === "!deleterole") {
    const role = getRole(message.guild, args.join(" "));
    if (!role) return message.channel.send("Role not found");
    await role.delete();
    message.channel.send(`✅ Role "${role.name}" deleted`);
  }

  if (command === "!renamerole") {
    const oldName = args[0];
    const newName = args.slice(1).join(" ");
    const role = getRole(message.guild, oldName);
    if (!role || !newName) return message.channel.send("Usage: !renamerole <oldName> <newName>");
    await role.setName(newName);
    message.channel.send(`✅ Renamed "${oldName}" to "${newName}"`);
  }

  // -------------------- Channel Commands --------------------
  if (command === "!createchannel") {
    const name = args.join("-");
    if (!name) return message.reply("Usage: !createchannel <name>");
    try {
      const ch = await message.guild.channels.create({ name, type: ChannelType.GuildText });
      message.reply(`✅ Channel created: ${ch.toString()}`);
    } catch (err) {
      console.error(err);
      message.reply("❌ Failed to create channel.");
    }
  }

  if (command === "!deletechannel") {
    const channelArg = args.join(" ");
    const ch = getChannel(message.guild, channelArg);
    if (!ch) return message.channel.send(`❌ Channel not found.`);
    try {
      await ch.delete();
      message.channel.send(`✅ Channel deleted: ${ch.name}`);
    } catch (err) {
      console.error(err);
      message.channel.send("❌ Failed to delete channel.");
    }
  }

  if (command === "!deleteall") {
    const channelArg = args.join(" ");
    const channel = getChannel(message.guild, channelArg) || message.channel;
    let fetched;
    do {
      fetched = await channel.messages.fetch({ limit: 100 });
      await channel.bulkDelete(fetched, true).catch(console.error);
    } while (fetched.size >= 2);
    message.channel.send("✅ Deleted all messages in this channel");
  }

  // -------------------- Private Channel --------------------
  if (command === "!createprivatechannel") {
    const user = message.mentions.members.first();
    if (!user) return message.reply("Usage: !createprivatechannel @user");

    const adminRole = message.guild.roles.cache.find((r) => r.name === ADMIN_ROLE);
    const overwrites = [
      { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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
      const privateCh = await message.guild.channels.create({
        name: `${user.user.username}-private`,
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
      });
      message.reply(`✅ Private channel created: ${privateCh.toString()}`);
    } catch (err) {
      console.error(err);
      message.reply("❌ Failed to create private channel.");
    }
  }

  
  // -------------------- Send DM --------------------
  if (command === "!senddm") {
    const member = message.mentions.members.first();
    const dmMessage = args.filter((a) => !a.startsWith("<@")).join(" ");
    if (!member || !dmMessage) return message.channel.send("Usage: !sendDM <message> @user");

    try {
      await member.send(dmMessage);
      message.channel.send(`✅ Sent DM to ${member.user.tag}`);
    } catch (err) {
      console.error(err);
      message.channel.send(
        `❌ Could not send DM to ${member.user.tag}. They might have DMs disabled.`
      );
    }
  }
});

// ==================== Login ====================
client.login(process.env.DISCORD_BOT_TOKEN);
