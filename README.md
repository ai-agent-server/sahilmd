# ZAINU-MD 🔥⚜️

WhatsApp Multi-Device Bot

## Heroku Deploy (Important)

### 1. Create app & deploy code from GitHub

### 2. Add Postgres (recommended – sessions survive restarts)
```
heroku addons:create heroku-postgresql:essential-0
```
Or from Heroku Dashboard → Resources → Add **Heroku Postgres**.

`DATABASE_URL` will be set automatically.

### 3. Config Vars (Settings → Config Vars)
| Key | Value |
|-----|--------|
| `OWNER_NUMBER` | `923128520558` |
| `OWNER_NAME` | `ZAINU` |
| `BOT_NAME` | `ZAINU-MD 🔥⚜️` |
| `PREFIX` | `.` |
| `CHANNEL_JIDS` | `120363409737585957@newsletter,https://whatsapp.com/channel/0029VbDMne82kNFhp1gyAh2P` |

### 4. Deploy & open app URL
- Pair with **QR** or **Pairing Code**
- Bot name: **ZAINU-MD 🔥⚜️**

### Without Postgres
Bot still starts (file-based sessions). Sessions may reset on dyno restart/sleep.

## Local
```bash
npm install
cp .env.example .env
node server.js
```

© POWERED BY ZAINU-MD 🔥⚜️
