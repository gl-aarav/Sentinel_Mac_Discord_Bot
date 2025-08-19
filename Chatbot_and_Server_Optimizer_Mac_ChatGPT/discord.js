// ==================== Express / Webserver ====================
const express = require("express");
const app = express();
const path = require("path");

app.use(express.static("public"));

app.get("/run", (req, res) => {
  console.log("Run button clicked!");
  // Here you can trigger bot actions if desired
  res.send("✅ Run action triggered!");
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ==================== Discord & OpenAI Setup ====================
require("dotenv").config({ path: "./ai_bot.env" });
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");
const { OpenAI } = require("openai");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ADMIN_ROLE = "Founder/Admin";
const INSTRUCTOR_ROLE = "Instructor";

function isInstructor(member) {
  return member.roles.cache.some((r) => r.name === INSTRUCTOR_ROLE);
}


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

// ==================== Command Handler ====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  const INSTRUCTOR_ROLE = "Instructor";

  function isInstructor(member) {
    return member.roles.cache.some((r) => r.name === INSTRUCTOR_ROLE);
  }


  // -------------------- Founder/Admin commands --------------------
  if (!isAdmin(message.member)) return;

  if (command === "!help") {
    return message.channel.send(`**Available Commands:**  
  \`\`\`
  **Admin & Instructor Commands:**
    ✅ !help - Show this help message
    🎓 !verify [@user] - Give the Students role to a mentioned user (Admin & Instructor only)

  **Admin Commands:**
    ➕ !addrole <role> <user> - Add a role to a user
    ➖ !removerole <role> <user> - Remove a role from a user
    🆕 !createrole <name> - Create a new role
    ❌ !deleterole <name> - Delete an existing role
    ✏️ !renamerole <oldName> <newName> - Rename a role
    🥾 !kick @user - Kick a user from the server
    🔨 !ban @user - Ban a user from the server
    🔓 !unban <userID> - Unban a user by ID
    🧹 !deleteall [#channel/channel-name] - Delete all messages in a channel
    📝 !createchannel <name> - Create a text channel
    🗑️ !deletechannel [#channel/channel-name] - Delete a text channel
    🔒 !createprivatechannel @user - Create a private channel for a user + Admins
    ✉️ !sendDM <message> @user - Send a private DM to a user
    🤖 !chat <message> [#channel/channel-name] [@user] - Chat via AI in current or specified channel
  \`\`\``);
  }

  // -------------------- Role Commands --------------------
  if (command === "!addrole") {
    const roleArg = args[0];
    const userArg = args.slice(1).join(" ");

    const role = getRole(message.guild, roleArg);
    const member = getMember(message.guild, userArg);

    if (!role || !member)
      return message.channel.send("Usage: !addrole <role> <user>");

    await member.roles.add(role);
    message.channel.send(`✅ Added ${role.name} to ${member.user.tag}`);
  }

  if (command === "!removerole") {
    const roleArg = args[0];
    const userArg = args.slice(1).join(" ");

    const role = getRole(message.guild, roleArg);
    const member = getMember(message.guild, userArg);

    if (!role || !member)
      return message.channel.send("Usage: !removerole <role> <user>");

    await member.roles.remove(role);
    message.channel.send(`✅ Removed ${role.name} from ${member.user.tag}`);
  }

  if (command === "!createrole") {
    const roleName = args.join(" ");
    if (!roleName) return message.channel.send("Usage: !createrole <name>");
    await message.guild.roles.create({ name: roleName });
    message.channel.send(`✅ Role "${roleName}" created`);
  }

  if (command === "!verify") {
    // Only allow Admins or Instructors
    if (!isAdmin(message.member) && !isInstructor(message.member))
      return message.channel.send("❌ You don’t have permission to use this command.");

    const member = message.mentions.members.first();
    if (!member) return message.channel.send("Usage: !verify @user");

    const studentRole = message.guild.roles.cache.find(r => r.name === "Students");
    if (!studentRole) return message.channel.send("❌ 'Students' role not found.");

    await member.roles.add(studentRole);
    message.channel.send(`✅ ${member.user.tag} has been verified and given the Students role!`);
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
    if (!role || !newName)
      return message.channel.send("Usage: !renamerole <oldName> <newName>");
    await role.setName(newName);
    message.channel.send(`✅ Renamed "${oldName}" to "${newName}"`);
  }

  // -------------------- Channel Commands --------------------
  if (command === "!createchannel") {
    const name = args.join("-");
    if (!name) return message.reply("Usage: !createchannel <name>");
    try {
      const ch = await message.guild.channels.create({
        name,
        type: ChannelType.GuildText,
      });
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

    const adminRole = message.guild.roles.cache.find(
      (r) => r.name === ADMIN_ROLE
    );
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

  // -------------------- Kick/Ban --------------------
  if (command === "!kick") {
    const member = message.mentions.members.first();
    if (!member) return message.channel.send("Usage: !kick @user");
    await member.kick();
    message.channel.send(`✅ Kicked ${member.user.tag}`);
  }

  if (command === "!ban") {
    const member = message.mentions.members.first();
    if (!member) return message.channel.send("Usage: !ban @user");
    await member.ban();
    message.channel.send(`✅ Banned ${member.user.tag}`);
  }

  if (command === "!unban") {
    const userId = args[0];
    if (!userId) return message.channel.send("Usage: !unban <userID>");
    await message.guild.members.unban(userId);
    message.channel.send(`✅ Unbanned user ID ${userId}`);
  }

  // -------------------- AI Chat --------------------
    if (command === "!chat") {
    const userMention = message.mentions.users.first();
    const channelMention = message.mentions.channels.first(); // <-- fix

    // Remove mentions from args to get prompt
    const prompt = args
      .filter((a) => !a.startsWith("<@") && !a.startsWith("<#"))
      .join(" ");

    if (!prompt)
      return message.channel.send(
        "Usage: !chat <message> [#channel/channel-name] [@user]"
      );

    const targetChannel = channelMention || message.channel;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });

      let reply = response.choices[0].message.content;
      if (userMention) reply = `${userMention}, ${reply}`;

      splitMessage(reply).forEach((chunk) => targetChannel.send(chunk));
    } catch (err) {
      console.error(err);
      message.channel.send("❌ Error while executing AI chat.");
    }
  }

  // -------------------- Send DM --------------------
  if (command === "!senddm") {
    const member = message.mentions.members.first();
    const dmMessage = args.filter((a) => !a.startsWith("<@")).join(" ");
    if (!member || !dmMessage)
      return message.channel.send("Usage: !sendDM <message> @user");

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
