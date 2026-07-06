# YTTransfer

*hewwo!! teto here!! ♪*

ok so you wanna move your entire youtube life to another account?? likes, playlists, subscriptions, the WHOLE thing?? bestie i got you. this lil cli tool does exactly that using the official youtube data api v3 and it will NOT lose your progress if youtube's quota decides to be rude to you mid-import ٩(◕‿◕｡)۶

---

## before you do ANYTHING — set up google cloud

### step 1: create a project

1. go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. click **Select a project** → **New Project**
3. name it something cute like `yttransfer` and click **Create**

### step 2: enable the youtube api

1. in your project, go to **APIs & Services** → **Library**
2. search for **YouTube Data API v3**
3. click it and hit **Enable**

### step 3: create oauth2 credentials

1. go to **APIs & Services** → **Credentials**
2. click **+ Create Credentials** → **OAuth client ID**
3. if it asks you to configure the consent screen first:
   - choose **External**
   - fill in app name (anything), your email for support and developer contact
   - click through the scopes screen (no need to add scopes here)
   - add yourself as a **Test user** (add the email of BOTH accounts you'll be transferring)
   - save and go back to creating credentials
4. for application type choose **Desktop app**
5. name it anything and click **Create**
6. click **Download JSON** on the popup (or the download icon next to your new credential)
7. rename the file to `credentials.json` and put it in the root of this project

it should look roughly like this:
```json
{
  "installed": {
    "client_id": "123456789-abc.apps.googleusercontent.com",
    "project_id": "yttransfer",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "client_secret": "GOCSPX-xxxxx",
    "redirect_uris": ["http://localhost"]
  }
}
```

if yours looks like that: PERFECT!! if not: go back and make sure you chose **Desktop app** !!

---

## installation

you need **Node.js 18+**. then:

```bash
npm install
```

optionally if you want to use `yttransfer` as a global command:
```bash
npm link
```

otherwise just use `node src/index.js` instead of `yttransfer` in all commands below.

---

## usage

### 1. log in to both accounts

```bash
npx yttransfer login source
```

this opens your browser!! log into the account you're transferring FROM. approve the permissions. done!!

```bash
npx yttransfer login dest
```

same thing but log into the account you're transferring TO. tokens are saved to `auth/source.json` and `auth/dest.json`.

### 2. export everything from source

```bash
npx yttransfer export
```

fetches all your liked videos, subscriptions, and playlists (including every video in each playlist). saves them as json files in `data/`:
- `data/likes.json`
- `data/subscriptions.json`
- `data/playlists.json`

### 3. import to destination

```bash
npx yttransfer import likes
npx yttransfer import subscriptions
npx yttransfer import playlists
```

run them in any order!! each one reads from the json files and imports to your dest account.

> **Watch Later cannot be migrated.** YouTube's API explicitly blocks access to the Watch Later playlist — it can't be read or written via the API regardless of OAuth scope. You can, however, copy all the videos in your Watch Later playlist to another playlist using YouTube's 'Add all to...' action [on the Watch Later page](https://www.youtube.com/playlist?list=WL) before running the export.

> **Some liked videos can't be liked back.** If a video's owner has disabled ratings, the API returns a `videoRatingDisabled` error and liking is impossible. instead of failing, the tool automatically creates a private playlist called **"Failed to Like (ratings disabled)"** on the dest account and adds those videos there so you don't lose track of them!!

---

## the smart part: resumable imports ✨

each item in the data files has an `"imported": false` field. when something gets successfully imported it gets marked `"imported": true` and the file is saved immediately.

so if youtube rate limits you mid-import (rude!!), just wait until your quota resets (midnight pacific time) and run the same import command again. it will skip everything already done and pick up from where it left off!!

---

## quota stuff (important!!)

youtube data api v3 has a daily quota of **10,000 units** per project. some operations cost more than others:

| operation | cost |
|---|---|
| export likes/subscriptions | ~1 unit per 50 items |
| export playlists | ~1 unit per 50 items + 1 per playlist to fetch videos |
| import like a video | 50 units |
| import subscribe to channel | 50 units |
| import create playlist | 50 units |
| import add video to playlist | 50 units |

for accounts with lots of liked videos or big playlists, you might hit the quota. the tool will tell you clearly when that happens and exit gracefully. just come back tomorrow!!

if you're doing a big transfer and want more quota, you can request a quota increase in google cloud console but honestly just be patient bby ♡
---

## troubleshooting

### `NO YOUTUBE CHANNEL` error on import playlists

you get this if the dest Google account has no YouTube channel. subscribing works without a channel, but creating playlists and liking videos require one!!

you need to **manually create a channel**:

1. open [youtube.com](https://www.youtube.com) in your browser
2. sign in with the **dest** account
3. click your avatar → **Create a channel**
4. fill in the name and confirm

once the channel exists, run the import again. you don't need to re-run `yttransfer login dest`.

---

## file structure

```
YTTransfer/
├── credentials.json     ← you provide this from google cloud console
├── auth/
│   ├── source.json      ← source account tokens (auto-created)
│   └── dest.json        ← dest account tokens (auto-created)
├── data/
│   ├── likes.json       ← exported + import progress tracked here
│   ├── subscriptions.json
│   └── playlists.json
└── src/
    ├── index.js
    ├── auth.js
    ├── youtube.js
    ├── export.js
    └── import.js
```

---

*teto out!! good luck with your transfer!! ♪♪ (ﾉ◕ヮ◕)ﾉ*
