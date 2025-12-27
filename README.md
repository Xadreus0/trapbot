# TrapBot – Role-Based Anti-Bot Enforcement

TrapBot is a lightweight Discord moderation bot designed to detect and remove automated or suspicious accounts during server onboarding. It uses **role-based detection and time-delayed enforcement**, rather than message scanning, to reliably catch auto-click bots while allowing real users to recover from mistakes.

The bot is multi-server capable and is designed to run with minimal resource usage.

---

## How the Onboarding Trap Works

Many automated Discord bots use a simple heuristic during onboarding:  
they **immediately click the left-most or first available button** when joining a server.  
In many servers, this button is traditionally “Agree to rules” or a similar confirmation.

TrapBot takes advantage of this behaviour by **reversing the expected button order** in the onboarding process and assigning a **custom trap role** to the option that bots are most likely to click automatically.

This causes a significant number of auto-click bots to reliably identify themselves by receiving the trap role.

To prevent false positives:

- The bot does **not** ban immediately
- A configurable **hold delay** is applied
- If a legitimate user misclicks but later selects the correct option and receives the default role **before the delay expires**, they are not banned and the trap role is removed

### Important Administrator Responsibility

This approach assumes that server administrators provide **clear guidance** for genuine users who may misclick during onboarding.

It is the responsibility of the server staff to ensure that:

- Legitimate users are informed that an incorrect onboarding choice can be corrected
- Clear instructions exist explaining **where and how to obtain the correct role**
- This is typically done using visible systems such as **Channels & Roles**, verification channels, or pinned onboarding messages

TrapBot is intentionally forgiving, but it relies on the server’s onboarding design to give real users a clear recovery path.

---

## Core Behaviour

TrapBot operates on three primary signals:

1. **Member join**
   - When a user joins a server, they are recorded as pending review

2. **Trap role assignment**
   - If a user receives the configured trap role at any time (immediately or hours later), the enforcement timer starts or resets from that moment

3. **Default role assignment**
   - If a user receives the default (human/verified) role, the trap role is removed and the user is cleared from pending review

A periodic sweep runs in the background to enforce rules after the configured delay.

---

## Enforcement Logic

After the configured delay for a server:

- If the user has the **trap role** and does **not** have the **default role**, the bot bans the user
- If the user has the **default role**, the trap role is removed (if present)
- If the user has neither role, no action is taken

A dry-run mode is available to log actions without enforcing them.

---

## Channels: Log vs Announce (Important Difference)

TrapBot uses **two different channels** with distinct purposes.

### Log Channel

- Intended for moderators
- Receives detailed operational logs:
  - Join tracking
  - Trap role detection
  - Role removals
  - Ban actions
  - Pending counts
  - Manual purges
- High volume
- Useful for auditing and debugging

### Announce Channel

- Intended for administrators
- Receives **state and lifecycle messages**, not per-user logs:
  - Bot startup notifications
  - Bot restart or reconnect messages
  - Manual purge confirmations
- Low volume
- Useful for monitoring outages and confirming the bot is running correctly

Using separate channels is strongly recommended.

---

## Slash Commands (Guild-Scoped)

All commands are scoped per server and require either:

- Administrator permission, or
- Manage Server permission

### `/trapbot status`

Displays the current configuration for the server:

- Default role
- Trap role
- Log channel
- Announce channel
- Delay time
- Dry-run state
- Mod-exempt roles

---

### `/trapbot set-default role:<role>`

Sets the default (human/verified) role.  
Users with this role are considered legitimate.

---

### `/trapbot set-trap role:<role>`

Sets the trap role.  
Users who retain this role past the delay without the default role will be banned.

---

### `/trapbot set-log channel:<channel>`

Sets the log channel.  
All operational logs and enforcement messages are sent here.

---

### `/trapbot set-announce channel:<channel>`

Sets the announce channel.  
Startup, restart, and administrative notifications are sent here.

---

### `/trapbot set-delay seconds:<number>`

Sets the enforcement delay for this server.

Each server can have a different delay (for example, 60 seconds on one server and 300 seconds on another).

---

### `/trapbot set-dryrun enabled:<true|false>`

Enables or disables dry-run mode.

- When enabled, actions are logged but not enforced
- When disabled, the bot performs actual role removals and bans

Dry-run mode is recommended during initial testing.

---

### `/trapbot pending-count`

Displays the number of users currently pending enforcement for this server.

Useful for monitoring backlog after outages or raids.

---

### `/trapbot purge-pending`

Deletes all pending enforcement entries for this server.

Use cases:

- After a bot outage or restart
- After testing configuration changes
- After large raids where a clean slate is desired

This command does not ban or modify any users.

---

### `/trapbot add-mod role:<role>`

Adds a role to the mod-exempt list.  
Users with this role are never automatically banned or modified.

---

### `/trapbot remove-mod role:<role>`

Removes a role from the mod-exempt list.

---

## Startup and Recovery Behaviour

- The bot runs continuously in Docker
- On reboot, restart, or internet outage recovery:
  - The bot reconnects automatically
  - Periodic sweeps resume
  - A notification is sent to the announce channel (if configured)

---

## Permissions Required

The bot requires:

- Manage Roles
- Ban Members
- View Channel (for configured channels)
- Send Messages (for configured channels)

Administrator permission is optional but simplifies setup.

---

## Recommended Setup Order (Per Server)

1. **Design the onboarding flow**
   - Configure Discord onboarding buttons so that the automated “default click” option assigns the trap role
   - Ensure legitimate users can later obtain the correct role via Channels & Roles or another visible method

2. Set the log channel

3. Set the announce channel

4. Set the default role

5. Set the trap role

6. Set the delay

7. Enable dry-run mode

8. Test onboarding behaviour with test accounts

9. Disable dry-run mode when satisfied
