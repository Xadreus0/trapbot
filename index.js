import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
} from "discord.js";
import sqlite3 from "sqlite3";
import path from "path";

// ---------- ENV ----------
const TOKEN = process.env.DISCORD_TOKEN;
const SWEEP_INTERVAL_SECONDS = parseInt(
  process.env.SWEEP_INTERVAL_SECONDS ?? "30",
  10
);

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

// ---------- DISCORD ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

// ---------- SQLITE ----------
const dbPath = path.join("data", "trapbot.sqlite");
const db = new sqlite3.Database(dbPath);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

db.serialize(() => {
  // Added: announce_channel_id
  db.run(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      default_role_id TEXT,
      trap_role_id TEXT,
      log_channel_id TEXT,
      announce_channel_id TEXT,
      check_delay_seconds INTEGER DEFAULT 180,
      dry_run INTEGER DEFAULT 1,
      mod_role_ids TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pending (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
});

const nowSec = () => Math.floor(Date.now() / 1000);

function parseCsvIds(s) {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function hasAnyRole(member, roleIds) {
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

async function getGuildConfig(guildId) {
  return await dbGet(`SELECT * FROM guild_config WHERE guild_id=?`, [guildId]);
}

async function upsertGuildConfig(guildId, patch) {
  const cur =
    (await getGuildConfig(guildId)) || {
      guild_id: guildId,
      default_role_id: null,
      trap_role_id: null,
      log_channel_id: null,
      announce_channel_id: null,
      check_delay_seconds: 180,
      dry_run: 1,
      mod_role_ids: "",
    };

  const merged = { ...cur, ...patch };

  await dbRun(
    `INSERT INTO guild_config
     (guild_id, default_role_id, trap_role_id, log_channel_id, announce_channel_id, check_delay_seconds, dry_run, mod_role_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       default_role_id=excluded.default_role_id,
       trap_role_id=excluded.trap_role_id,
       log_channel_id=excluded.log_channel_id,
       announce_channel_id=excluded.announce_channel_id,
       check_delay_seconds=excluded.check_delay_seconds,
       dry_run=excluded.dry_run,
       mod_role_ids=excluded.mod_role_ids`,
    [
      guildId,
      merged.default_role_id,
      merged.trap_role_id,
      merged.log_channel_id,
      merged.announce_channel_id,
      merged.check_delay_seconds,
      merged.dry_run,
      merged.mod_role_ids,
    ]
  );

  return merged;
}

async function sendToChannelId(guild, channelId, msg) {
  if (!channelId) return;
  try {
    const ch = await guild.channels.fetch(channelId);
    if (ch && ch.isTextBased()) await ch.send(msg);
  } catch (e) {
    console.error("SEND FAIL:", guild?.id, e?.rawError?.message ?? e?.message ?? e);
  }
}

async function logToGuild(guild, cfg, msg) {
  // "log" channel, if configured
  await sendToChannelId(guild, cfg?.log_channel_id, msg);
}

async function announceToGuild(guild, cfg, msg) {
  // "announce" channel, if configured
  await sendToChannelId(guild, cfg?.announce_channel_id, msg);
}

// ---------- COMMANDS (GUILD-SCOPED) ----------
async function registerCommandsForGuild(guildId) {
  const commands = [
    {
      name: "trapbot",
      description: "Configure TrapBot for this server",
      options: [
        { type: 1, name: "status", description: "Show current config" },
        {
          type: 1,
          name: "pending-count",
          description: "Show number of pending entries for this server",
        },
        {
          type: 1,
          name: "purge-pending",
          description: "Delete ALL pending entries for this server (manual reset)",
        },
        {
          type: 1,
          name: "set-default",
          description: "Set the default (human) role",
          options: [{ type: 8, name: "role", description: "Role", required: true }],
        },
        {
          type: 1,
          name: "set-trap",
          description: "Set the trap role",
          options: [{ type: 8, name: "role", description: "Role", required: true }],
        },
        {
          type: 1,
          name: "set-log",
          description: "Set the log channel",
          options: [{ type: 7, name: "channel", description: "Channel", required: true }],
        },
        {
          type: 1,
          name: "set-announce",
          description: "Set the admin announce channel (startup/recovery notices)",
          options: [{ type: 7, name: "channel", description: "Channel", required: true }],
        },
        {
          type: 1,
          name: "set-delay",
          description: "Set delay before enforcement (seconds)",
          options: [
            {
              type: 4,
              name: "seconds",
              description: "Seconds",
              required: true,
              min_value: 10,
              max_value: 86400,
            },
          ],
        },
        {
          type: 1,
          name: "set-dryrun",
          description: "Enable/disable dry-run",
          options: [
            {
              type: 5,
              name: "enabled",
              description: "true=log only, false=enforce",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "add-mod",
          description: "Add a mod-exempt role (never ban/remove)",
          options: [{ type: 8, name: "role", description: "Role", required: true }],
        },
        {
          type: 1,
          name: "remove-mod",
          description: "Remove a mod-exempt role",
          options: [{ type: 8, name: "role", description: "Role", required: true }],
        },
      ],
    },
  ];

  await client.application.commands.set(commands, guildId);
}

function isAllowed(interaction) {
  return (
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
    interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

// ---------- PENDING HELPERS ----------
async function setPending(guildId, userId, ts) {
  await dbRun(
    "INSERT OR REPLACE INTO pending (guild_id, user_id, joined_at) VALUES (?, ?, ?)",
    [guildId, userId, ts]
  );
}

async function clearPending(guildId, userId) {
  await dbRun("DELETE FROM pending WHERE guild_id=? AND user_id=?", [guildId, userId]);
}

async function pendingCountForGuild(guildId) {
  const row = await dbGet("SELECT COUNT(*) AS c FROM pending WHERE guild_id=?", [guildId]);
  return row?.c ?? 0;
}

async function purgePendingForGuild(guildId) {
  await dbRun("DELETE FROM pending WHERE guild_id=?", [guildId]);
}

// ---------- READY ----------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Register commands in each guild (instant)
  try {
    await client.application.fetch();
    for (const gid of client.guilds.cache.keys()) {
      try {
        await registerCommandsForGuild(gid);
      } catch (e) {
        console.error("Command register failed for guild", gid, e?.message ?? e);
      }
    }
    console.log("Slash commands registered (guild-scoped).");
  } catch (e) {
    console.error("Command registration error:", e?.message ?? e);
  }

  console.log(`Sweep interval: ${SWEEP_INTERVAL_SECONDS}s`);

  // Announce "I'm back online" to each configured guild announce channel
  for (const [gid, guild] of client.guilds.cache) {
    try {
      const cfg = await getGuildConfig(gid);
      if (!cfg?.announce_channel_id) continue;

      const msg =
        `**TrapBot online** for **${guild.name}**\n` +
        `• Sweep: ${Math.max(10, SWEEP_INTERVAL_SECONDS)}s\n` +
        `• Delay: ${(cfg.check_delay_seconds ?? 180)}s\n` +
        `• Dry-run: ${(cfg.dry_run ?? 1) ? "ON" : "OFF"}`;

      await announceToGuild(guild, cfg, msg);
    } catch (e) {
      console.error("announce error:", gid, e?.message ?? e);
    }
  }
});

// ---------- INTERACTIONS ----------
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "trapbot") return;

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (!isAllowed(interaction)) {
      await interaction.reply({
        content: "You need Manage Server (Manage Guild) or Administrator to configure TrapBot.",
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const gid = guild.id;
    const cur = await getGuildConfig(gid);

    if (sub === "status") {
      const cfg = cur || {};
      const mods =
        parseCsvIds(cfg.mod_role_ids).map((id) => `<@&${id}>`).join(", ") || "None";
      await interaction.reply({
        ephemeral: true,
        content:
          `**TrapBot status**\n` +
          `Guild: \`${guild.name}\` (${gid})\n` +
          `Default role: ${cfg.default_role_id ? `<@&${cfg.default_role_id}>` : "Not set"}\n` +
          `Trap role: ${cfg.trap_role_id ? `<@&${cfg.trap_role_id}>` : "Not set"}\n` +
          `Log channel: ${cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : "Not set"}\n` +
          `Announce channel: ${cfg.announce_channel_id ? `<#${cfg.announce_channel_id}>` : "Not set"}\n` +
          `Delay: ${cfg.check_delay_seconds ?? 180}s\n` +
          `Dry-run: ${(cfg.dry_run ?? 1) ? "ON" : "OFF"}\n` +
          `Mod-exempt roles: ${mods}`,
      });
      return;
    }

    if (sub === "pending-count") {
      const cfg = cur || {};
      const c = await pendingCountForGuild(gid);
      await interaction.reply({
        ephemeral: true,
        content: `Pending entries for this server: **${c}**`,
      });
      // Optional: also log it
      if (cfg?.log_channel_id) {
        await logToGuild(guild, cfg, `Pending count (manual): **${c}**`);
      }
      return;
    }

    if (sub === "purge-pending") {
      const cfg = cur || {};
      const before = await pendingCountForGuild(gid);
      await purgePendingForGuild(gid);
      await interaction.reply({
        ephemeral: true,
        content: `Purged pending entries for this server. Removed **${before}** rows.`,
      });

      const note = `Pending purged by <@${interaction.user.id}> — removed **${before}** entries.`;
      if (cfg?.log_channel_id) await logToGuild(guild, cfg, note);
      if (cfg?.announce_channel_id) await announceToGuild(guild, cfg, note);
      return;
    }

    if (sub === "set-default") {
      const role = interaction.options.getRole("role", true);
      const cfg = await upsertGuildConfig(gid, { default_role_id: role.id });
      await interaction.reply({ ephemeral: true, content: `Default role set to <@&${cfg.default_role_id}>.` });
      return;
    }

    if (sub === "set-trap") {
      const role = interaction.options.getRole("role", true);
      const cfg = await upsertGuildConfig(gid, { trap_role_id: role.id });
      await interaction.reply({ ephemeral: true, content: `Trap role set to <@&${cfg.trap_role_id}>.` });
      return;
    }

    if (sub === "set-log") {
      const channel = interaction.options.getChannel("channel", true);
      const cfg = await upsertGuildConfig(gid, { log_channel_id: channel.id });
      await interaction.reply({ ephemeral: true, content: `Log channel set to <#${cfg.log_channel_id}>.` });
      await logToGuild(guild, cfg, `TrapBot logging configured for this server.`);
      return;
    }

    if (sub === "set-announce") {
      const channel = interaction.options.getChannel("channel", true);
      const cfg = await upsertGuildConfig(gid, { announce_channel_id: channel.id });
      await interaction.reply({ ephemeral: true, content: `Announce channel set to <#${cfg.announce_channel_id}>.` });
      await announceToGuild(guild, cfg, `TrapBot will post startup/recovery notices here.`);
      return;
    }

    if (sub === "set-delay") {
      const seconds = interaction.options.getInteger("seconds", true);
      const cfg = await upsertGuildConfig(gid, { check_delay_seconds: seconds });
      await interaction.reply({ ephemeral: true, content: `Delay set to ${cfg.check_delay_seconds}s.` });
      return;
    }

    if (sub === "set-dryrun") {
      const enabled = interaction.options.getBoolean("enabled", true);
      const cfg = await upsertGuildConfig(gid, { dry_run: enabled ? 1 : 0 });
      await interaction.reply({
        ephemeral: true,
        content: `Dry-run is now ${cfg.dry_run ? "ON (log-only)" : "OFF (enforcing)"} for this server.`,
      });
      return;
    }

    if (sub === "add-mod") {
      const role = interaction.options.getRole("role", true);
      const cfg0 = cur || (await upsertGuildConfig(gid, {}));
      const mods = new Set(parseCsvIds(cfg0.mod_role_ids));
      mods.add(role.id);
      await upsertGuildConfig(gid, { mod_role_ids: [...mods].join(",") });
      await interaction.reply({ ephemeral: true, content: `Added mod-exempt role <@&${role.id}>.` });
      return;
    }

    if (sub === "remove-mod") {
      const role = interaction.options.getRole("role", true);
      const cfg0 = cur || (await upsertGuildConfig(gid, {}));
      const mods = new Set(parseCsvIds(cfg0.mod_role_ids));
      mods.delete(role.id);
      await upsertGuildConfig(gid, { mod_role_ids: [...mods].join(",") });
      await interaction.reply({ ephemeral: true, content: `Removed mod-exempt role <@&${role.id}>.` });
      return;
    }

    await interaction.reply({ ephemeral: true, content: "Unknown subcommand." });
  } catch (e) {
    console.error("interaction error:", e);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ ephemeral: true, content: `Error: ${e?.message ?? e}` });
      }
    } catch {}
  }
});

// ---------- JOIN: record pending baseline ----------
client.on("guildMemberAdd", async (member) => {
  try {
    const cfg = await getGuildConfig(member.guild.id);
    if (!cfg) return;

    await setPending(member.guild.id, member.user.id, nowSec());
    await logToGuild(member.guild, cfg, `JOIN tracked: <@${member.user.id}> (${member.user.id})`);
  } catch (e) {
    console.error("guildMemberAdd error:", e?.message ?? e);
  }
});

// ---------- ROLE CHANGE DETECTION ----------
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const gid = newMember.guild.id;
    const cfg = await getGuildConfig(gid);
    if (!cfg?.trap_role_id || !cfg?.default_role_id) return;

    const trapId = cfg.trap_role_id;
    const defId = cfg.default_role_id;

    const hadTrap = oldMember.roles.cache.has(trapId);
    const hasTrap = newMember.roles.cache.has(trapId);
    const hadDef = oldMember.roles.cache.has(defId);
    const hasDef = newMember.roles.cache.has(defId);

    // Trap role JUST added => reset timer from now (delayed click protection)
    if (!hadTrap && hasTrap) {
      await setPending(gid, newMember.user.id, nowSec());
      await logToGuild(newMember.guild, cfg, `TRAP role detected — timer started for <@${newMember.user.id}>`);
    }

    // Default role JUST added => remove trap immediately (or dry-run), then clear pending
    if (!hadDef && hasDef && hasTrap) {
      if (cfg.dry_run) {
        await logToGuild(newMember.guild, cfg, `DRY-RUN: would remove trap role from <@${newMember.user.id}> (default role acquired)`);
      } else {
        try {
          await newMember.roles.remove(trapId, "Default role acquired — removing trap role");
          await logToGuild(newMember.guild, cfg, `VERIFIED: removed trap role from <@${newMember.user.id}> (default role acquired)`);
        } catch (e) {
          await logToGuild(newMember.guild, cfg, `Failed to remove trap role from <@${newMember.user.id}>: ${e?.message ?? e}`);
        }
      }
      await clearPending(gid, newMember.user.id);
      return;
    }

    // Trap role removed => clear pending
    if (hadTrap && !hasTrap) {
      await clearPending(gid, newMember.user.id);
    }
  } catch (e) {
    console.error("guildMemberUpdate error:", e?.message ?? e);
  }
});

// ---------- SWEEP ----------
async function sweepOnce() {
  const now = nowSec();
  const rows = await dbAll(
    "SELECT guild_id, user_id, joined_at FROM pending ORDER BY joined_at ASC LIMIT 200"
  );

  for (const r of rows) {
    const cfg = await getGuildConfig(r.guild_id);
    if (!cfg || !cfg.trap_role_id || !cfg.default_role_id) {
      await clearPending(r.guild_id, r.user_id);
      continue;
    }

    const delay = cfg.check_delay_seconds ?? 180;
    if (now - r.joined_at < delay) continue;

    const guild = client.guilds.cache.get(r.guild_id);
    if (!guild) {
      await clearPending(r.guild_id, r.user_id);
      continue;
    }

    let member;
    try {
      member = await guild.members.fetch(r.user_id);
    } catch {
      await clearPending(r.guild_id, r.user_id);
      continue;
    }

    // Exempt roles
    const modRoles = parseCsvIds(cfg.mod_role_ids);
    if (modRoles.length && hasAnyRole(member, modRoles)) {
      await clearPending(r.guild_id, r.user_id);
      await logToGuild(guild, cfg, `EXEMPT (mod role): <@${member.user.id}>`);
      continue;
    }

    const hasDefault = member.roles.cache.has(cfg.default_role_id);
    const hasTrap = member.roles.cache.has(cfg.trap_role_id);
    const dryRun = !!cfg.dry_run;

    if (hasDefault) {
      // If default role, remove trap if present (backup)
      if (hasTrap) {
        if (dryRun) {
          await logToGuild(guild, cfg, `DRY-RUN: would remove trap role from <@${member.user.id}> (sweep)`);
        } else {
          try {
            await member.roles.remove(cfg.trap_role_id, "Verified (has default role) — removing trap role");
            await logToGuild(guild, cfg, `VERIFIED: removed trap role from <@${member.user.id}> (sweep)`);
          } catch (e) {
            await logToGuild(guild, cfg, `Failed to remove trap role from <@${member.user.id}>: ${e?.message ?? e}`);
          }
        }
      }
      await clearPending(r.guild_id, r.user_id);
      continue;
    }

    if (hasTrap) {
      if (dryRun) {
        await logToGuild(guild, cfg, `DRY-RUN: would BAN <@${member.user.id}> (trap + no default after ${delay}s)`);
      } else {
        await logToGuild(guild, cfg, `BANNING: <@${member.user.id}> (trap + no default after ${delay}s)`);
        try {
          await guild.members.ban(member.user.id, { reason: "Auto-ban: trap role + no default after delay" });
        } catch (e) {
          await logToGuild(guild, cfg, `Failed to ban <@${member.user.id}>: ${e?.message ?? e}`);
        }
      }
      await clearPending(r.guild_id, r.user_id);
      continue;
    }

    await clearPending(r.guild_id, r.user_id);
  }
}

setInterval(() => {
  sweepOnce().catch((e) => console.error("sweep error:", e?.message ?? e));
}, Math.max(10, SWEEP_INTERVAL_SECONDS) * 1000);

// ---------- START ----------
client.login(TOKEN);
