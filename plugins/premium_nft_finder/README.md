# Premium NFT Finder — AyuGram plugin

Android plugin for AyuGram / exteraGram. It adds **“Проверить Premium / NFT”** to the context menu of an individual message.

## What it does
- Checks only the message you explicitly select.
- Shows one of three text-match labels: **100% — direct claim**, **Сомнительно**, or **Не подтверждено**.
- Does not scan chat history, enumerate members, collect usernames, create a user list, save matches, or message anyone.
- “100%” means the message contains a direct phrase; it does **not** verify that the person currently owns Premium or an NFT.

## Install
1. In AyuGram, open **Settings → Plugins → Repositories**.
2. Add: `https://github.com/zefut-creator/Premium-NFT-Finder`
3. Refresh the repository and install **Premium NFT Message Check**.
4. Open a message, open its context menu, and tap **Проверить Premium / NFT**.

Requires a plugin-enabled AyuGram/exteraGram build compatible with SDK 1.4.4.3 and app version 12.5.1+.

## Development
The installable file is `plugins/premium_nft_finder/premium_nft_finder.plugin`.
The repository index is `extera-plugins.json`.
