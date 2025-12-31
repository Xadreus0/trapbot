# TrapBot – Role-Based Anti-Bot Enforcement

TrapBot is a lightweight Discord moderation bot designed to detect and remove automated or suspicious accounts during server onboarding. It uses role-based detection with time-delayed enforcement rather than message scanning, allowing it to reliably catch auto-click bots while giving legitimate users an opportunity to recover from mistakes.

The bot is multi-server capable and designed to run continuously with minimal resource usage.

Invite link:  
https://discord.com/oauth2/authorize?client_id=1454329885219618958&scope=bot%20applications.commands&permissions=1099780066438

---

## How the Onboarding Trap Works

Many automated onboarding systems do not reason about intent. Instead, they operate through an API-driven process that evaluates available onboarding options.

Commonly observed behaviour includes:

- Scanning available options for known or expected keywords  
- Avoiding options that contain terms associated with enforcement or rejection  
- When no option clearly matches expectations, defaulting to a positional selection rather than semantic intent  

If neither option appears clearly classifiable, these systems often select the first available option presented by the interface.

TrapBot takes advantage of this fallback behaviour using Discord’s onboarding role assignments.

---

## Core Behaviour

TrapBot operates on three primary signals:

1. **Member join**  
   When a user joins a server, they are recorded as pending review.

2. **Trap role assignment**  
   If a user receives the configured trap role at any time, the enforcement timer starts or resets from that moment.

3. **Default role assignment**  
   If a user receives the default (human or verified) role, the trap role is removed and the user is cleared from pending review.

A periodic background sweep evaluates pending users and applies enforcement after the configured delay.

---

## Enforcement Logic

After the configured delay for a server:

- If a user has the trap role and does not have the default role, the bot bans the user.
- If a user has the default role, the trap role is removed if present.
- If a user has neither role, no action is taken.

A dry-run mode is available to log actions without enforcing them.

---

## Channels: Log vs Announce

TrapBot uses two separate channels with different purposes.

### Log Channel

Intended for moderators.  
Receives detailed operational logs such as joins, role changes, enforcement decisions, and manual actions.  
This channel can be high volume and is primarily for auditing and debugging.

### Announce Channel

Intended for administrators.  
Receives low-volume lifecycle messages such as startup notifications, reconnects, and confirmation of administrative actions like pending purges.

Using separate channels is strongly recommended.

---

## Onboarding Design Notes

TrapBot’s effectiveness depends heavily on how the server’s onboarding flow is designed.

Key considerations:

- Both onboarding choices should appear structurally valid but obvious to a user.
- Descriptions can be used to clarify intent for legitimate users, as bots tend to ignore descriptive text.
- Non-explicit language is still advised when writing both options.
- If an automated system cannot confidently classify either option, it is more likely to fall back to a positional selection.
- In Discord’s onboarding UI, this commonly results in the left-most option being selected.

For this reason, the trap role should be assigned to the left-most option during onboarding.

Discord’s onboarding descriptions provide an opportunity to explain outcomes to real users without exposing explicit signals to automated systems.

TrapBot does not inspect onboarding content. Its reliability is determined entirely by how the onboarding flow is designed.

---

## Administrator Responsibility

This system assumes that server administrators provide a clear recovery path for legitimate users.

Server staff are responsible for ensuring that:

- Users understand that an incorrect onboarding choice can be corrected.
- Instructions exist explaining how to obtain the correct role.
- This information is visible through onboarding descriptions, Channels & Roles, verification channels, or pinned messages.

TrapBot is intentionally forgiving, but it relies on onboarding design to distinguish automation from human behaviour.

---

## Slash Commands (Guild-Scoped)

All commands are scoped per server and require either Administrator or Manage Server permission.

### `/trapbot status`

Displays the current configuration for the server, including roles, channels, delay, dry-run state, and mod-exempt roles.

### `/trapbot set-default role:<role>`

Sets the default (human or verified) role.

### `/trapbot set-trap role:<role>`

Sets the trap role used for automated detection.

### `/trapbot set-log channel:<channel>`

Sets the log channel for operational messages.

### `/trapbot set-announce channel:<channel>`

Sets the announce channel for lifecycle notifications.

### `/trapbot set-delay seconds:<number>`

Sets the enforcement delay for the server.

### `/trapbot set-dryrun enabled:<true|false>`

Enables or disables dry-run mode.

### `/trapbot pending-count`

Displays the number of users currently pending enforcement.

### `/trapbot purge-pending`

Clears all pending enforcement entries for the server.

### `/trapbot add-mod role:<role>`

Adds a role to the mod-exempt list.

### `/trapbot remove-mod role:<role>`

Removes a role from the mod-exempt list.

---

## Startup and Recovery Behaviour

- The bot runs continuously, typically in Docker.
- On restart or reconnection:
  - Pending checks resume automatically.
  - A notification is sent to the announce channel if configured.

---

## Permissions Required

TrapBot requires:

- Manage Roles  
- Ban Members  
- View Channel  
- Send Messages  

Administrator permission is optional but simplifies setup.

---

## Recommended Setup Order

1. Design the onboarding flow so the left-most option assigns the trap role.
2. Ensure legitimate users can obtain the correct role through visible recovery paths.
3. Set the log channel.
4. Set the announce channel.
5. Set the default role.
6. Set the trap role.
7. Set the delay.
8. Enable dry-run mode.
9. Test onboarding behaviour.
10. Disable dry-run mode when satisfied.

---

## License

This project is licensed under the MIT License.  
See the [LICENSE](./LICENSE) file for details.

---
